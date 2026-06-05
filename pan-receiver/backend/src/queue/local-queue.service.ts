import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BaiduPanService } from '../baidu-pan/baidu-pan.service';
import { UploadJobData, ShareJobData, TransferJobData } from './queue.service';
import axios from 'axios';
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
    // 简化: share 流程已废弃，直接走 upload
    this.logger.log(`[LocalQueue] Share job -> redirect to upload for submission ${data.submissionId}`);
    const files = await this.prisma.submissionFile.findMany({
      where: { submissionId: data.submissionId, transferStatus: 'selected' },
    });
    for (const f of files) {
      await this.addUploadJob({
        fileId: f.id,
        localPath: '',
        submitterUserId: data.submitterUserId,
        taskId: data.taskId,
        submissionId: data.submissionId,
      });
    }
  }

  async addTransferJob(_data: TransferJobData) {
    this.logger.log(`[LocalQueue] Transfer job skipped`);
  }

  private async handleUpload(data: UploadJobData) {
    const { fileId, localPath, submitterUserId, taskId, submissionId } = data;
    const fileRecord = await this.prisma.submissionFile.findUnique({ where: { id: fileId } });
    if (!fileRecord) {
      this.logger.warn(`[Upload] File record not found: ${fileId}`);
      return;
    }

    try {
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { transferStatus: 'uploading' },
      });

      const task = await this.prisma.receiveTask.findUnique({ where: { id: taskId } });
      if (!task) throw new Error('Task not found');

      const submitter = await this.prisma.user.findUnique({
        where: { id: submitterUserId },
        select: { nickname: true, username: true, baiduNickname: true },
      });
      const submitterName = submitter?.nickname || submitter?.username || submitter?.baiduNickname || '匿名用户';
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      
      // 最终目标路径
      const finalDir = `${task.targetPath}/${submitterName}_${dateStr}`;
      const finalPath = `${finalDir}/${fileRecord.fileName}`;

      let tempFilePath = localPath;

      // 如果是网盘已有文件，先下载到服务器临时文件
      if (fileRecord.sourceType === 'baidu_pan_existing' && !localPath && fileRecord.submitterPanFsId) {
        tempFilePath = await this._downloadFromPan(submitterUserId, Number(fileRecord.submitterPanFsId), fileRecord.fileName);
      }

      if (!tempFilePath || !fs.existsSync(tempFilePath)) {
        throw new Error('No file available for upload');
      }

      // 用收集者的 Token 上传到其网盘
      const ownerClient = await this.baiduPan.getClient(task.ownerUserId);
      this.logger.log(`[Upload] Uploading ${tempFilePath} -> ${finalPath}`);

      // 直接用 ownerClient.uploadFile，它会自动处理中转逻辑
      await ownerClient.uploadFile(tempFilePath, finalPath);
      this.logger.log(`[Upload] Success: ${finalPath}`);

      // 清理临时文件
      try { if (tempFilePath !== localPath) fs.unlinkSync(tempFilePath); } catch (_) {}
      try { if (localPath) fs.unlinkSync(localPath); } catch (_) {}

      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: {
          ownerTargetPath: finalPath,
          submitterPanPath: finalPath,
          transferStatus: 'transferred',
        },
      });
      await this._updateSubmissionStatus(fileRecord.submissionId);

    } catch (err: any) {
      const errMsg = err.errno ? `errno=${err.errno} ${err.message}` : err.message;
      this.logger.error(`[Upload] Failed for ${fileId}: ${errMsg}`, err.stack);
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { transferStatus: 'failed', errorMessage: errMsg.slice(0, 500) },
      }).catch(() => {});
      await this._updateSubmissionStatus(submissionId!).catch(() => {});

      try { if (localPath) fs.unlinkSync(localPath); } catch (_) {}
    }
  }

  /** 从提交者网盘下载到服务器 */
  private async _downloadFromPan(userId: string, fsid: number, fileName: string): Promise<string> {
    this.logger.log(`[_downloadFromPan] Downloading fsId=${fsid}, name=${fileName}`);
    
    const client = await this.baiduPan.getClient(userId);
    
    // 获取 dlink
    const metaRes = await client.getFileDlink([fsid]);
    const fileList = metaRes.list || [];
    if (!fileList.length || !fileList[0].dlink) {
      throw new Error(`无法获取文件的下载链接 (fsId=${fsid})`);
    }

    const dlink = fileList[0].dlink as string;
    const token = await this.baiduPan.getValidToken(userId);

    const tmpDir = process.env.TEMP_FILE_DIR || '/tmp/pan-receiver';
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fff]/g, '_')}`);

    // 百度网盘的 dlink 需要追加 access_token 并带 User-Agent header
    const downloadUrl = `${dlink}&access_token=${token}`;
    this.logger.log(`[_downloadFromPan] Fetching from dlink...`);

    const resp = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 120000,
      headers: { 'User-Agent': 'netdisk;pan-receiver' },
      maxRedirects: 5,
    });

    const writer = fs.createWriteStream(tmpFile);
    await new Promise<void>((resolve, reject) => {
      resp.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const size = fs.statSync(tmpFile).size;
    this.logger.log(`[_downloadFromPan] Done: ${tmpFile} (${size} bytes)`);
    return tmpFile;
  }

  private async _updateSubmissionStatus(submissionId: string) {
    const files = await this.prisma.submissionFile.findMany({ where: { submissionId } });
    if (files.length === 0) return;

    const doneSet = new Set(['transferred', 'failed']);
    const allDone = files.every((f) => doneSet.has(f.transferStatus));
    const successCount = files.filter((f) => f.transferStatus === 'transferred').length;
    const failedCount = files.filter((f) => f.transferStatus === 'failed').length;

    let status = 'processing';
    if (allDone && successCount > 0 && failedCount === 0) status = 'success';
    else if (allDone && successCount > 0 && failedCount > 0) status = 'partial_success';
    else if (allDone && successCount === 0 && failedCount > 0) status = 'failed';

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status, successCount, failedCount },
    });
  }
}
