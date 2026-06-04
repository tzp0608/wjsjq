import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  private hashShareCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  async createTask(userId: string, dto: {
    title: string;
    description?: string;
    deadline?: string;
    targetPath: string;
    maxFileCountPerSubmission?: number;
    allowRepeatSubmit?: boolean;
    autoCreateSubmitterFolder?: boolean;
  }) {
    const shareCode = crypto.randomBytes(16).toString('hex');
    const shareCodeHash = this.hashShareCode(shareCode);

    const task = await this.prisma.receiveTask.create({
      data: {
        ownerUserId: userId,
        title: dto.title,
        description: dto.description,
        targetPath: dto.targetPath,
        shareCodeHash,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        maxFileCountPerSubmission: dto.maxFileCountPerSubmission ?? 20,
        allowRepeatSubmit: dto.allowRepeatSubmit ?? true,
        autoCreateSubmitterFolder: dto.autoCreateSubmitterFolder ?? true,
      },
    });

    return {
      taskId: task.id,
      sharePath: `/#/submit?taskId=${task.id}&code=${shareCode}`
    };
  }

  async getTask(taskId: string, userId?: string) {
    const task = await this.prisma.receiveTask.findUnique({
      where: { id: taskId },
      include: { owner: { select: { nickname: true, baiduNickname: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');

    const isOwner = userId === task.ownerUserId;
    return {
      taskId: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      targetPath: isOwner ? task.targetPath : undefined,
      submissionCount: task.totalSubmissionCount,
      fileCount: task.totalFileCount,
      failedFileCount: task.failedFileCount,
      deadline: task.deadline?.toISOString(),
      maxFileSize: Number(task.maxFileSize),
      maxFileCountPerSubmission: task.maxFileCountPerSubmission,
      allowRepeatSubmit: task.allowRepeatSubmit,
      ownerName: task.owner.baiduNickname || task.owner.nickname || '未知用户',
    };
  }

  async getPublicTask(taskId: string, code: string) {
    const task = await this.prisma.receiveTask.findUnique({
      where: { id: taskId },
      include: { owner: { select: { nickname: true, baiduNickname: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');

    const hash = this.hashShareCode(code);
    if (task.shareCodeHash !== hash) {
      throw new ForbiddenException('Invalid share code');
    }
    if (task.status !== 'active') {
      throw new ForbiddenException('Task is not active');
    }
    if (task.deadline && task.deadline < new Date()) {
      throw new ForbiddenException('Task has expired');
    }

    return {
      taskId: task.id,
      title: task.title,
      description: task.description,
      ownerName: task.owner.baiduNickname || task.owner.nickname || '未知用户',
      deadline: task.deadline?.toISOString(),
      maxFileSize: Number(task.maxFileSize),
      maxFileCountPerSubmission: task.maxFileCountPerSubmission,
      status: task.status,
    };
  }

  async closeTask(taskId: string, userId: string) {
    const task = await this.prisma.receiveTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.ownerUserId !== userId) throw new ForbiddenException('Not task owner');

    await this.prisma.receiveTask.update({
      where: { id: taskId },
      data: { status: 'closed' },
    });
    return { taskId, status: 'closed' };
  }

  async regenerateShareCode(taskId: string, userId: string) {
    const task = await this.prisma.receiveTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.ownerUserId !== userId) throw new ForbiddenException('Not task owner');

    const shareCode = crypto.randomBytes(16).toString('hex');
    const shareCodeHash = this.hashShareCode(shareCode);

    await this.prisma.receiveTask.update({
      where: { id: taskId },
      data: { shareCodeHash },
    });

    return {
      taskId: task.id,
      sharePath: `/#/submit?taskId=${task.id}&code=${shareCode}`
    };
  }

  async listTaskSubmissions(taskId: string, userId: string) {
    const task = await this.prisma.receiveTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.ownerUserId !== userId) throw new ForbiddenException('Not task owner');

    const submissions = await this.prisma.submission.findMany({
      where: { taskId },
      include: { submitter: { select: { nickname: true, baiduNickname: true } }, files: true },
      orderBy: { createdAt: 'desc' },
    });

    return submissions.map((s) => ({
      id: s.id,
      submitterName: s.submitter.baiduNickname || s.submitter.nickname || '未知用户',
      status: s.status,
      statusText: s.status === 'success' ? '成功' : s.status === 'failed' ? '失败' : s.status === 'partial_success' ? '部分成功' : '处理中',
      fileCount: s.fileCount,
      successCount: s.successCount,
      failedCount: s.failedCount,
      createdAt: s.createdAt.toISOString(),
      files: s.files.map((f) => ({
        name: f.fileName,
        size: typeof f.fileSize === 'bigint' ? Number(f.fileSize) : (f.fileSize || 0),
        status: f.transferStatus,
        path: f.ownerTargetPath || null,
        errorMessage: f.errorMessage || null,
      })),
    }));
  }

  async listUserTasks(userId: string) {
    const tasks = await this.prisma.receiveTask.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return tasks.map((t) => ({
      taskId: t.id,
      title: t.title,
      status: t.status,
      submissionCount: t.totalSubmissionCount,
      fileCount: t.totalFileCount,
      createdAt: t.createdAt.toISOString(),
    }));
  }
}
