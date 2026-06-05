import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

@Controller('api')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('hello')
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health(): { status: string; time: string; env: string[] } {
    const relevant = ['NODE_ENV', 'APP_PORT', 'REDIS_URL', 'TEMP_FILE_DIR'];
    return {
      status: 'ok',
      time: new Date().toISOString(),
      env: relevant.filter(k => !!process.env[k]).map(k => `${k}=${process.env[k]}`),
    };
  }

  /** 查看最近的失败文件记录（用于调试） */
  @Get('debug/failed-files')
  async debugFailedFiles() {
    const files = await this.prisma.submissionFile.findMany({
      where: { transferStatus: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { submission: true },
    });
    return files.map(f => ({
      fileId: f.id,
      fileName: f.fileName,
      sourceType: f.sourceType,
      transferStatus: f.transferStatus,
      errorMessage: f.errorMessage,
      submitterPanPath: f.submitterPanPath,
      ownerTargetPath: f.ownerTargetPath,
      updatedAt: f.updatedAt?.toISOString?.() || null,
      taskId: f.taskId,
      taskOwnerId: f.ownerUserId,
      submitterUserId: f.submitterUserId,
    }));
  }
}
