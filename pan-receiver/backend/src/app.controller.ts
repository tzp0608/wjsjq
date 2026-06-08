import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

// Root level routes
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('hello')
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health(): { status: string; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }
}

// API routes
@Controller('api')
export class ApiController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('test')
  test(): { message: string; version: string; time: string } {
    return { message: 'API is working', version: 'v1.0.7', time: new Date().toISOString() };
  }

  @Get('test/baidu-token')
  async testBaiduToken() {
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