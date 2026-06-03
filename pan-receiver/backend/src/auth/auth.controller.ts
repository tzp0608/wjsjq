import { Controller, Post, Body, Get, Query, UseGuards, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private prisma: PrismaService,
  ) {}

  @Post('register')
  async register(@Body('username') username: string, @Body('password') password: string) {
    return this.auth.register(username, password);
  }

  @Post('login')
  async login(@Body('username') username: string, @Body('password') password: string) {
    return this.auth.login(username, password);
  }

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
    return this.auth.generateBaiduAuthUrl(role || 'owner', redirect || '/', req.user.userId);
  }

  @Get('baidu/callback')
  async baiduCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const result = await this.auth.baiduCallback(code, state);
    const redirect = result.redirect || '/';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;">
<div style="text-align:center;">
<h2 style="color:#07c160;">百度网盘绑定成功</h2>
<p>正在跳转...</p>
<script>window.location.replace('${redirect}');</script>
</div>
</body>
</html>`);
  }

  @Post('baidu/unbind')
  @UseGuards(AuthGuard('jwt'))
  unbindBaidu(@Req() req: any) {
    return this.auth.unbindBaidu(req.user.userId);
  }
}
