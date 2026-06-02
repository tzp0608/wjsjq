import { Inject, Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BaiduPanService } from '../baidu-pan/baidu-pan.service';
import type { IQueueService } from '../queue/queue.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SubmissionsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private baiduPan: BaiduPanService,
    @Inject('QUEUE_SERVICE') private queue: IQueueService,
  ) {}

  async createSubmission(userId: string, dto: {
    taskId: string;
    sourceType: string;
    files: { name: string; size: number; type?: string }[];
  }) {
    const task = await this.prisma.receiveTask.findUnique({ where: { id: dto.taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== 'active') throw new ForbiddenException('Task is not active');
    if (task.deadline && task.deadline < new Date()) throw new ForbiddenException('Task expired');

    const maxSize = Number(task.maxFileSize);
    const maxCount = task.maxFileCountPerSubmission;

    if (dto.files.length > maxCount) {
      throw new BadRequestException(`Max ${maxCount} files per submission`);
    }
    for (const f of dto.files) {
      if (f.size > maxSize) {
        throw new BadRequestException(`File ${f.name} exceeds size limit`);
      }
    }

    const submission = await this.prisma.submission.create({
      data: {
        taskId: dto.taskId,
        submitterUserId: userId,
        sourceType: dto.sourceType,
        fileCount: dto.files.length,
        totalSize: dto.files.reduce((sum, f) => sum + f.size, 0),
      },
    });

    const createdFiles = await Promise.all(
      dto.files.map((f) =>
        this.prisma.submissionFile.create({
          data: {
            submissionId: submission.id,
            taskId: dto.taskId,
            submitterUserId: userId,
            ownerUserId: task.ownerUserId,
            fileName: f.name,
            fileSize: f.size,
            fileExt: f.name.split('.').pop(),
            sourceType: dto.sourceType,
          },
        }),
      ),
    );

    return {
      submissionId: submission.id,
      uploadUrl: `/api/submissions/${submission.id}/upload`,
      files: createdFiles.map((f) => ({ fileId: f.id, name: f.fileName })),
    };
  }

  async uploadFile(
    submissionId: string,
    userId: string,
    file: Express.Multer.File,
    fileId: string,
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { task: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.submitterUserId !== userId) throw new ForbiddenException();

    const tempDir = this.config.get<string>('TEMP_FILE_DIR', '/tmp/pan-receiver');
    const storageKey = `${submissionId}/${fileId}_${file.originalname}`;
    const localPath = path.join(tempDir, storageKey);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    if (file.path) {
      try {
        fs.renameSync(file.path, localPath);
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          fs.copyFileSync(file.path, localPath);
          fs.unlinkSync(file.path);
        } else {
          throw err;
        }
      }
    } else if (file.buffer) {
      fs.writeFileSync(localPath, file.buffer);
    } else {
      throw new BadRequestException('No file data received');
    }

    await this.prisma.submissionFile.updateMany({
      where: { submissionId, id: fileId },
      data: {
        localTempStorageKey: storageKey,
        transferStatus: 'uploaded_to_server',
      },
    });

    const submissionFile = await this.prisma.submissionFile.findFirst({
      where: { submissionId, id: fileId },
    });
    if (submissionFile) {
      await this.queue.addUploadJob({
        submissionId,
        fileId,
        localPath,
        submitterUserId: userId,
        taskId: submission.taskId,
      });
    }

    return { fileId, status: 'uploaded_to_server' };
  }

  async submitPanFiles(userId: string, submissionId: string, selectedFiles: {
    fsId: string;
    path: string;
    name: string;
    size: number;
  }[]) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { task: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.submitterUserId !== userId) throw new ForbiddenException();

    for (const f of selectedFiles) {
      await this.prisma.submissionFile.create({
        data: {
          submissionId,
          taskId: submission.taskId,
          submitterUserId: userId,
          ownerUserId: submission.task.ownerUserId,
          fileName: f.name,
          fileSize: f.size,
          fileExt: f.name.split('.').pop(),
          sourceType: 'baidu_pan_existing',
          submitterPanPath: f.path,
          submitterPanFsId: f.fsId,
          transferStatus: 'selected',
        },
      });
    }

    await this.queue.addShareJob({
      submissionId,
      submitterUserId: userId,
      taskId: submission.taskId,
    });

    return { submissionId, status: 'creating_share' };
  }

  async getStatus(submissionId: string, userId?: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { files: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    return {
      submissionId: submission.id,
      status: submission.status,
      fileCount: submission.fileCount,
      successCount: submission.successCount,
      failedCount: submission.failedCount,
      files: submission.files.map((f) => ({
        fileId: f.id,
        name: f.fileName,
        status: f.transferStatus,
      })),
    };
  }

  async retrySubmission(submissionId: string, userId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { files: true, task: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.submitterUserId !== userId) throw new ForbiddenException();

    const failedFiles = submission.files.filter(
      (f) => f.transferStatus === 'failed' || f.transferStatus === 'selected',
    );

    for (const f of failedFiles) {
      await this.prisma.transferJob.create({
        data: {
          submissionId,
          fileId: f.id,
          ownerUserId: submission.task.ownerUserId,
          submitterUserId: userId,
          status: 'pending',
          idempotencyKey: `${f.id}_${Date.now()}`,
        },
      });
    }

    return { submissionId, status: 'retrying' };
  }
}
