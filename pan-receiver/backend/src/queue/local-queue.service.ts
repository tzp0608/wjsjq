import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BaiduPanService } from '../baidu-pan/baidu-pan.service';
import { UploadJobData, ShareJobData, TransferJobData } from './queue.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class LocalQueueService {
  private readonly logger = new Logger(LocalQueueService.name);

  constructor(
    private prisma: PrismaService,
    private baiduPan: BaiduPanService,
  ) {}

  async addUploadJob(data: UploadJobData) {
    this.logger.log(`[LocalQueue] Upload job for file ${data.fileId}`);
    setImmediate(() => this.handleUpload(data).catch((e) => this.logger.error(e)));
  }

  async addShareJob(data: ShareJobData) {
    this.logger.log(`[LocalQueue] Share job for submission ${data.submissionId}`);
    setImmediate(() => this.handleShare(data).catch((e) => this.logger.error(e)));
  }

  async addTransferJob(data: TransferJobData) {
    this.logger.log(`[LocalQueue] Transfer job for file ${data.fileId}`);
    setImmediate(() => this.handleTransfer(data).catch((e) => this.logger.error(e)));
  }

  private async handleUpload(data: UploadJobData) {
    const { fileId, localPath, submitterUserId, taskId } = data;
    const fileRecord = await this.prisma.submissionFile.findUnique({ where: { id: fileId } });
    if (!fileRecord) {
      this.logger.warn(`[Upload] File record not found: ${fileId}`);
      return;
    }

    this.logger.log(`[Upload] Starting upload for ${fileRecord.fileName} (${fileId}) to ${submitterUserId}'s Baidu Pan`);

    try {
      // 标记为正在上传到百度网盘
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { transferStatus: 'uploading' },
      });
      await this.updateSubmissionStatus(fileRecord.submissionId);

      const client = await this.baiduPan.getClient(submitterUserId);
      const panPath = `/apps/网盘收件助手/submissions/${taskId}/${fileRecord.submissionId}/${fileRecord.fileName}`;
      this.logger.log(`[Upload] Ensuring folder: ${path.dirname(panPath)}`);
      await client.ensureFolder(path.dirname(panPath));
      this.logger.log(`[Upload] Uploading ${localPath} -> ${panPath}`);
      await client.uploadFile(localPath, panPath);
      this.logger.log(`[Upload] Upload complete for ${fileId}`);

      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { submitterPanPath: panPath, transferStatus: 'uploaded_to_pan' },
      });
      await this.updateSubmissionStatus(fileRecord.submissionId);

      try { fs.unlinkSync(localPath); } catch (_) {}

      await this.addShareJob({ submissionId: fileRecord.submissionId, submitterUserId, taskId });
    } catch (err: any) {
      const errMsg = err.errno ? `errno=${err.errno} ${err.message}` : err.message;
      this.logger.error(`[Upload] Failed for ${fileId}: ${errMsg}`, err.stack);
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { transferStatus: 'failed', errorMessage: errMsg },
      });
      await this.updateSubmissionStatus(fileRecord.submissionId);
    }
  }

  private async handleShare(data: ShareJobData) {
    const { submissionId, submitterUserId, taskId } = data;
    const files = await this.prisma.submissionFile.findMany({
      where: { submissionId, transferStatus: { in: ['uploaded_to_pan', 'selected'] } },
    });
    if (files.length === 0) {
      this.logger.warn(`[Share] No files ready for submission ${submissionId}`);
      return;
    }

    // 标记为正在创建分享
    for (const f of files) {
      await this.prisma.submissionFile.update({
        where: { id: f.id },
        data: { transferStatus: 'creating_share' },
      });
    }
    await this.updateSubmissionStatus(submissionId);

    try {
      const client = await this.baiduPan.getClient(submitterUserId);
      const fsids = files.map((f) => Number(f.submitterPanFsId || 0)).filter(Boolean);
      if (fsids.length === 0) {
        const metaList = await Promise.all(
          files.map((f) =>
            client.listFiles(path.dirname(f.submitterPanPath || '')).then((items: any[]) =>
              items.find((i) => i.path === f.submitterPanPath),
            ),
          ),
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
    }
  }

  private async handleTransfer(data: TransferJobData) {
    const { fileId, ownerUserId, targetPath } = data;
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

    this.logger.debug(`[Status] submission ${submissionId} -> ${status} (success=${successCount}, failed=${failedCount}, allDone=${allDone})`);
  }
}
