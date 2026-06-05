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

    const submitter = await this.prisma.user.findUnique({
      where: { id: submitterUserId },
      select: { baiduUid: true, baiduNickname: true },
    });
    const submitterBaiduBound = !!submitter?.baiduUid;

    try {
      let panPath: string;
      let transferUserId: string;
      if (submitterBaiduBound) {
        transferUserId = submitterUserId;
        panPath = `/网盘收件助手/submissions/${taskId}/${fileRecord.submissionId}/${fileRecord.fileName}`;
      } else {
        const task = await this.prisma.receiveTask.findUnique({ where: { id: taskId } });
        if (!task) throw new Error('Task not found');
        const submitterName = submitter?.baiduNickname || '匿名';
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        panPath = `${task.targetPath}/direct_submissions/${submitterName}_${dateStr}/${fileRecord.fileName}`;
        transferUserId = task.ownerUserId;
      }

      const client = await this.baiduPan.getClient(transferUserId);
      await client.ensureFolder(path.dirname(panPath));
      await client.uploadFile(localPath, panPath);

      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { submitterPanPath: panPath, transferStatus: 'uploaded_to_pan' },
      });

      try { fs.unlinkSync(localPath); } catch (_) {}

      if (submitterBaiduBound) {
        await this.queue.addShareJob({ submissionId: fileRecord.submissionId, submitterUserId, taskId });
      } else {
        await this.prisma.submissionFile.update({
          where: { id: fileId },
          data: { ownerTargetPath: panPath, transferStatus: 'transferred' },
        });
      }
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
      }

      await this.updateSubmissionStatus(submissionId);
    } catch (err: any) {
      for (const f of files) {
        await this.prisma.submissionFile.update({
          where: { id: f.id },
          data: { transferStatus: 'failed', errorMessage: err.message },
        });
      }
      await this.updateSubmissionStatus(submissionId);
      throw err;
    }
  }

  private async updateSubmissionStatus(submissionId: string) {
    const files = await this.prisma.submissionFile.findMany({ where: { submissionId } });
    if (files.length === 0) return;
    const doneStatuses = ['shared', 'transferred', 'failed', 'waiting_owner_space'];
    const allDone = files.every((f) => doneStatuses.includes(f.transferStatus));
    const successCount = files.filter((f) => f.transferStatus === 'shared' || f.transferStatus === 'transferred').length;
    const failedCount = files.filter((f) => f.transferStatus === 'failed').length;
    let status = 'processing';
    if (allDone && successCount > 0 && failedCount === 0) status = 'success';
    if (allDone && successCount > 0 && failedCount > 0) status = 'partial_success';
    if (allDone && successCount === 0 && failedCount > 0) status = 'failed';
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status, successCount, failedCount },
    });
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
      ['shared', 'transferred', 'failed', 'waiting_owner_space'].includes(f.transferStatus),
    );
    if (!allDone) return;

    const successCount = files.filter((f) => f.transferStatus === 'shared' || f.transferStatus === 'transferred').length;
    const failedCount = files.filter((f) => f.transferStatus === 'failed').length;

    let status = 'success';
    if (successCount > 0 && failedCount > 0) status = 'partial_success';
    if (successCount === 0 && failedCount > 0) status = 'failed';

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status, successCount, failedCount },
    });
  }
}
