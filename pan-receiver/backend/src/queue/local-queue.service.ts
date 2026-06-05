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

    // 查询提交者是否绑定了百度网盘
    const submitter = await this.prisma.user.findUnique({
      where: { id: submitterUserId },
      select: { baiduUid: true, baiduNickname: true, nickname: true, username: true },
    });
    const submitterBaiduBound = !!submitter?.baiduUid;
    this.logger.log(`[Upload] Starting for ${fileRecord.fileName} (${fileId}), submitterBound=${submitterBaiduBound}`);

    try {
      // 标记为正在上传到百度网盘
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { transferStatus: 'uploading' },
      });
      await this.updateSubmissionStatus(fileRecord.submissionId);

      let panPath: string;
      let transferUserId: string;
      if (submitterBaiduBound) {
        // 提交者绑定了网盘：上传到提交者网盘，然后创建分享让收集者转存
        transferUserId = submitterUserId;
        panPath = `/网盘收件助手/submissions/${taskId}/${fileRecord.submissionId}/${fileRecord.fileName}`;
      } else {
        // 提交者未绑定网盘：服务器直接上传到收集者的网盘
        const task = await this.prisma.receiveTask.findUnique({ where: { id: taskId } });
        if (!task) throw new Error('Task not found');
        const submitterName = submitter?.nickname || submitter?.username || submitter?.baiduNickname || '匿名用户';
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        // 路径：{owner targetPath}/direct_submissions/{submitterName}_{dateStr}/{fileName}
        panPath = `${task.targetPath}/direct_submissions/${submitterName}_${dateStr}/${fileRecord.fileName}`;
        transferUserId = task.ownerUserId;
      }

      this.logger.log(`[Upload] Uploading ${localPath} -> ${panPath} (as user ${transferUserId})`);

      const client = await this.baiduPan.getClient(transferUserId);
      this.logger.log(`[Upload] Ensuring folder: ${path.dirname(panPath)}`);
      await client.ensureFolder(path.dirname(panPath));
      this.logger.log(`[Upload] Uploading to Baidu...`);
      await client.uploadFile(localPath, panPath);
      this.logger.log(`[Upload] Upload complete for ${fileId}`);

      // 标记为已上传
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { submitterPanPath: panPath, transferStatus: 'uploaded_to_pan' },
      });
      await this.updateSubmissionStatus(fileRecord.submissionId);

      try { fs.unlinkSync(localPath); } catch (_) {}

      // 根据绑定情况触发不同的后续步骤
      if (submitterBaiduBound) {
        // 走分享流程（创建分享让收集者转存）
        await this.addShareJob({ submissionId: fileRecord.submissionId, submitterUserId, taskId });
      } else {
        // 直接转存到收集者网盘 - 直接标记为已转存
        await this.prisma.submissionFile.update({
          where: { id: fileId },
          data: {
            ownerTargetPath: panPath,
            transferStatus: 'transferred',
          },
        });
        await this.updateSubmissionStatus(fileRecord.submissionId);
        this.logger.log(`[Upload] Direct upload complete (no share needed): ${panPath}`);
      }
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
      this.logger.error(`[Share] Failed for submission ${submissionId}: ${err.message}`, err.stack);
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
