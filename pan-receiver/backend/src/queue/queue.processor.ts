import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { BaiduPanService } from '../baidu-pan/baidu-pan.service';
import { QueueService } from './queue.service';
import * as fs from 'fs';
import * as path from 'path';

@Processor('upload')
export class UploadProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private baiduPan: BaiduPanService,
    private queue: QueueService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { fileId, localPath, submitterUserId, taskId } = job.data;
    const fileRecord = await this.prisma.submissionFile.findUnique({ where: { id: fileId } });
    if (!fileRecord) return;

    try {
      const client = await this.baiduPan.getClient(submitterUserId);
      const panPath = `/apps/网盘收件助手/submissions/${taskId}/${fileRecord.submissionId}/${fileRecord.fileName}`;
      await client.createFolder(path.dirname(panPath));
      await client.uploadFile(localPath, panPath);

      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { submitterPanPath: panPath, transferStatus: 'uploaded_to_pan' },
      });

      fs.unlinkSync(localPath);

      await this.queue.addShareJob({ submissionId: fileRecord.submissionId, submitterUserId, taskId });
    } catch (err: any) {
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { transferStatus: 'failed', errorMessage: err.message },
      });
      throw err;
    }
  }
}

@Processor('share')
export class ShareProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private baiduPan: BaiduPanService,
    private queue: QueueService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { submissionId, submitterUserId, taskId } = job.data;
    const files = await this.prisma.submissionFile.findMany({
      where: { submissionId, transferStatus: { in: ['uploaded_to_pan', 'selected'] } },
    });
    if (files.length === 0) return;

    try {
      const client = await this.baiduPan.getClient(submitterUserId);
      const fsids = files.map((f) => Number(f.submitterPanFsId || 0)).filter(Boolean);
      if (fsids.length === 0) {
        const metaList = await Promise.all(
          files.map((f) => client.listFiles(path.dirname(f.submitterPanPath || '')).then((items: any[]) =>
            items.find((i) => i.path === f.submitterPanPath),
          )),
        );
        for (let i = 0; i < files.length; i++) {
          if (metaList[i]) {
            fsids.push(metaList[i].fs_id);
            await this.prisma.submissionFile.update({
              where: { id: files[i].id },
              data: { submitterPanFsId: String(metaList[i].fs_id) },
            });
          }
        }
      }

      if (fsids.length === 0) throw new Error('No valid fsids found');

      const shareRes = await client.createShare(fsids);
      const shareUrl = shareRes.shortlink || shareRes.link || '';

      for (const f of files) {
        await this.prisma.submissionFile.update({
          where: { id: f.id },
          data: { shareId: String(shareRes.shareid || ''), shareUrl, transferStatus: 'shared' },
        });

        const task = await this.prisma.receiveTask.findUnique({ where: { id: taskId } });
        if (task) {
          await this.queue.addTransferJob({
            fileId: f.id,
            ownerUserId: task.ownerUserId,
            targetPath: task.targetPath,
          });
        }
      }
    } catch (err: any) {
      for (const f of files) {
        await this.prisma.submissionFile.update({
          where: { id: f.id },
          data: { transferStatus: 'failed', errorMessage: err.message },
        });
      }
      throw err;
    }
  }
}

@Processor('transfer')
export class TransferProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private baiduPan: BaiduPanService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { fileId, ownerUserId, targetPath } = job.data;
    const fileRecord = await this.prisma.submissionFile.findUnique({
      where: { id: fileId },
      include: { submission: { include: { submitter: true } } },
    });
    if (!fileRecord || !fileRecord.shareUrl) return;

    try {
      const client = await this.baiduPan.getClient(ownerUserId);
      const quota = await client.getQuota();
      const freeSpace = (quota.total || 0) - (quota.used || 0);
      if (freeSpace < fileRecord.fileSize) {
        await this.prisma.submissionFile.update({
          where: { id: fileId },
          data: { transferStatus: 'waiting_owner_space', errorMessage: 'Owner space insufficient' },
        });
        return;
      }

      const submitter = await this.prisma.user.findUnique({ where: { id: fileRecord.submitterUserId } });
      const fromUk = submitter?.baiduUk || '';

      const folderName = `${fileRecord.submission.submitter.baiduNickname || '未知用户'}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
      const ownerPath = `${targetPath}/${folderName}`;
      await client.createFolder(ownerPath);
      await client.transferFromShare(fileRecord.shareUrl, ownerPath, fromUk);

      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { ownerTargetPath: `${ownerPath}/${fileRecord.fileName}`, transferStatus: 'transferred' },
      });

      await this.prisma.submission.update({
        where: { id: fileRecord.submissionId },
        data: {
          successCount: { increment: 1 },
          status: 'processing',
        },
      });

      await this.updateSubmissionStatus(fileRecord.submissionId);
    } catch (err: any) {
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { transferStatus: 'failed', errorMessage: err.message },
      });
      await this.updateSubmissionStatus(fileRecord.submissionId);
      throw err;
    }
  }

  private async updateSubmissionStatus(submissionId: string) {
    const files = await this.prisma.submissionFile.findMany({ where: { submissionId } });
    const allDone = files.every((f) =>
      ['transferred', 'failed', 'waiting_owner_space'].includes(f.transferStatus),
    );
    if (!allDone) return;

    const successCount = files.filter((f) => f.transferStatus === 'transferred').length;
    const failedCount = files.filter((f) => f.transferStatus === 'failed').length;
    const waitingCount = files.filter((f) => f.transferStatus === 'waiting_owner_space').length;

    let status = 'success';
    if (successCount > 0 && (failedCount > 0 || waitingCount > 0)) status = 'partial_success';
    if (successCount === 0 && failedCount > 0) status = 'failed';
    if (successCount === 0 && waitingCount > 0) status = 'waiting_owner_space';

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status, successCount, failedCount },
    });
  }
}
