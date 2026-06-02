import { Controller, Post, Body, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private prisma: PrismaService,
  ) {}

  @Post('wechat-login')
  async wechatLogin(@Body('code') code: string) {
    return this.auth.wechatLogin(code);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@Req() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, nickname: true, baiduUid: true, baiduNickname: true },
    });
    return { userId: user?.id, baiduBound: !!user?.baiduUid, baiduNickname: user?.baiduNickname };
  }

  @Get('baidu/auth-url')
  @UseGuards(AuthGuard('jwt'))
  baiduAuthUrl(
    @Query('role') role: string,
    @Query('redirect') redirect: string,
    @Req() req: any,
  ) {
    return this.auth.generateBaiduAuthUrl(role || 'owner', redirect || '/pages/index/index', req.user.userId);
  }

  @Get('baidu/callback')
  async baiduCallback(@Query('code') code: string, @Query('state') state: string) {
    return this.auth.baiduCallback(code, state);
  }

  @Post('baidu/unbind')
  @UseGuards(AuthGuard('jwt'))
  unbindBaidu(@Req() req: any) {
    return this.auth.unbindBaidu(req.user.userId);
  }
}
