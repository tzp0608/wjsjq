import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { AuthGuard } from '@nestjs/passport';

@Controller()
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

  /** 简单的测试端点 - 用于诊断 */
  @Get('test')
  test(): { message: string; version: string; time: string } {
    return {
      message: 'API is working',
      version: 'v1.0.5',
      time: new Date().toISOString(),
    };
  }

  /** 上传诊断 - 测试百度 token 是否有效 */
  @Get('test/baidu-token')
  async testBaiduToken() {
    // 查找最近有百度 token 的用户
    const user = await this.prisma.user.findFirst({
      where: { baiduAccessTokenEncrypted: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    
    if (!user) return { error: '没有绑定百度网盘的用户' };
    
    return {
      userId: user.id,
      baiduUid: user.baiduUid,
      baiduNickname: user.baiduNickname,
      tokenExpireAt: user.baiduTokenExpireAt?.toISOString(),
    };
  }
}