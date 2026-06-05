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
    // 简化流程：不再单独做 share 步骤
    // 对于 baidu_pan_existing 类型的文件，直接通过 handleUpload 处理
    this.logger.log(`[LocalQueue] Share job for submission ${data.submissionId} (redirecting to upload flow)`);

    const files = await this.prisma.submissionFile.findMany({
      where: { submissionId: data.submissionId, sourceType: 'baidu_pan_existing', transferStatus: 'selected' },
    });

    for (const f of files) {
      await this.addUploadJob({
        fileId: f.id,
        localPath: '',  // 网盘已有文件不需要本地上传
        submitterUserId: data.submitterUserId,
        taskId: data.taskId,
        submissionId: data.submissionId,
      });
    }
  }

  async addTransferJob(_data: TransferJobData) {
    // 简化流程：transfer 已在 upload 中完成
    this.logger.log(`[LocalQueue] Transfer job skipped (handled in upload step)`);
  }

  /**
   * 核心处理逻辑 - 所有类型都简化为：下载到临时目录 → 上传到收集者的网盘目标目录
   */
  private async handleUpload(data: UploadJobData) {
    const { fileId, localPath, submitterUserId, taskId, submissionId } = data;
    const fileRecord = await this.prisma.submissionFile.findUnique({ where: { id: fileId } });
    if (!fileRecord) {
      this.logger.warn(`[Upload] File record not found: ${fileId}`);
      return;
    }

    try {
      // 更新状态为正在处理
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { transferStatus: 'uploading' },
      });
      await this.updateSubmissionStatus(fileRecord.submissionId);

      // 查询任务信息获取 targetPath 和 ownerUserId
      const task = await this.prisma.receiveTask.findUnique({ where: { id: taskId } });
      if (!task) throw new Error('Task not found');

      // 构建目标路径：{targetPath}/{submitterName}_{dateStr}/{fileName}
      const submitter = await this.prisma.user.findUnique({
        where: { id: submitterUserId },
        select: { nickname: true, username: true, baiduNickname: true },
      });
      const submitterName = submitter?.nickname || submitter?.username || submitter?.baiduNickname || '匿名用户';
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const panDir = `${task.targetPath}/${submitterName}_${dateStr}`;
      const panPath = `${panDir}/${fileRecord.fileName}`;

      let tempFilePath = localPath;

      // 如果是选择已有网盘文件的（sourceType=baidu_pan_existing），需要先用提交者token下载再上传
      if (fileRecord.sourceType === 'baidu_pan_existing' && !localPath && fileRecord.submitterPanFsId) {
        this.logger.log(`[Upload] Downloading existing Pan file ${fileRecord.fileName} (fsId=${fileRecord.submitterPanFsId})`);
        
        const submitterClient = await this.baiduPan.getClient(submitterUserId);
        const dlinkRes = await submitterClient.getFileDlink([Number(fileRecord.submitterPanFsId)]);
        const dlinks = dlinkRes.list || [];
        if (dlinks.length === 0) throw new Error('无法获取文件下载链接');
        
        const dlink = dlinks[0].dlink;
        const tmpDir = process.env.TEMP_FILE_DIR || '/tmp/pan-receiver';
        fs.mkdirSync(tmpDir, { recursive: true });
        tempFilePath = path.join(tmpDir, `${Date.now()}_${fileRecord.fileName}`);

        this.logger.log(`[Upload] Downloading from dlink to ${tempFilePath}`);
        
        // 下载需要带 access_token 和 User-Agent
        const submitterToken = await this.baiduPan.getValidToken(submitterUserId);
        const response = await axios.get(`${dlink}&access_token=${submitterToken}`, {
          responseType: 'stream',
          timeout: 120000,
          headers: { 'User-Agent': 'netdisk' },
          maxRedirects: 5,
        });
        
        const writer = fs.createWriteStream(tempFilePath);
        await new Promise((resolve, reject) => {
          response.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        this.logger.log(`[Upload] Download complete, size=${fs.statSync(tempFilePath).size}`);
      }

      if (!tempFilePath || !fs.existsSync(tempFilePath)) {
        throw new Error('No file available for upload (missing local file or download failed)');
      }

      // 用收集者的 Token 上传到其网盘的目标目录
      this.logger.log(`[Upload] Uploading ${tempFilePath} -> ${panPath} (as owner ${task.ownerUserId})`);

      const ownerClient = await this.baiduPan.getClient(task.ownerUserId);
      
      // 先确保目录存在
      this.logger.log(`[Upload] Ensuring folder exists: ${panDir}`);
      await ownerClient.ensureFolder(panDir);

      // 上传文件
      this.logger.log(`[Upload] Starting PCS upload...`);
      await ownerClient.uploadFile(tempFilePath, panPath);
      this.logger.log(`[Upload] File uploaded successfully: ${panPath}`);

      // 清理临时文件
      try { 
        if (tempFilePath !== localPath) fs.unlinkSync(tempFilePath); 
      } catch (_) {}
      try { 
        if (localPath) fs.unlinkSync(localPath); 
      } catch (_) {}

      // 直接标记为已转存（因为已经到了最终位置）
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: {
          ownerTargetPath: panPath,
          submitterPanPath: panPath,
          transferStatus: 'transferred',
        },
      });
      await this.updateSubmissionStatus(fileRecord.submissionId);
      this.logger.log(`[Upload] Complete: ${panPath}`);

    } catch (err: any) {
      const errMsg = err.errno ? `errno=${err.errno} ${err.message}` : err.message;
      this.logger.error(`[Upload] Failed for ${fileId}: ${errMsg}`, err.stack);
      await this.prisma.submissionFile.update({
        where: { id: fileId },
        data: { transferStatus: 'failed', errorMessage: errMsg.slice(0, 500) },
      });
      await this.updateSubmissionStatus(submissionId!);

      // 清理可能的临时文件
      try { if (localPath) fs.unlinkSync(localPath); } catch (_) {}
    }
  }

  private async updateSubmissionStatus(submissionId: string) {
    const files = await this.prisma.submissionFile.findMany({ where: { submissionId } });
    if (files.length === 0) return;

    const doneStatuses = ['transferred', 'failed'];
    const allDone = files.every((f) => doneStatuses.includes(f.transferStatus));

    const successCount = files.filter((f) => f.transferStatus === 'transferred').length;
    const failedCount = files.filter((f) => f.transferStatus === 'failed').length;

    let status = 'processing';
    if (allDone && successCount > 0 && failedCount === 0) status = 'success';
    if (allDone && successCount > 0 && failedCount > 0) status = 'partial_success';
    if (allDone && successCount === 0 && failedCount > 0) status = 'failed';

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status, successCount, failedCount },
    });

    this.logger.debug(`[Status] submission ${submissionId} -> ${status} (${successCount} ok, ${failedCount} fail)`);
  }
}
