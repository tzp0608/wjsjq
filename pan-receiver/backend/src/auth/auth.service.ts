import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private crypto: CryptoService,
    private config: ConfigService,
  ) {}

  async wechatLogin(code: string) {
    const appId = this.config.get<string>('WECHAT_APP_ID');
    const secret = this.config.get<string>('WECHAT_APP_SECRET');
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
    const { data } = await axios.get(url);
    if (data.errcode) {
      throw new UnauthorizedException(`WeChat login failed: ${data.errmsg}`);
    }
    const openid = data.openid as string;
    const unionid = data.unionid as string | undefined;

    let user = await this.prisma.user.findUnique({ where: { wxOpenid: openid } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { wxOpenid: openid, wxUnionid: unionid },
      });
    }

    const token = this.jwt.sign({
      userId: user.id,
      wxOpenid: user.wxOpenid,
    });

    return {
      token,
      userId: user.id,
      baiduBound: !!user.baiduUid,
    };
  }

  generateBaiduAuthUrl(role: string, redirect: string, userId?: string) {
    const clientId = this.config.get<string>('BAIDU_APP_KEY')!;
    const redirectUri = this.config.get<string>('BAIDU_OAUTH_REDIRECT_URI')!;
    const state = Buffer.from(
      JSON.stringify({ role, redirect, userId, nonce: Math.random().toString(36).slice(2) }),
    ).toString('base64');

    const authUrl =
      `https://openapi.baidu.com/oauth/2.0/authorize?` +
      `response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=netdisk&state=${encodeURIComponent(state)}`;

    return { authUrl, state };
  }

  async baiduCallback(code: string, state: string) {
    const parsed = JSON.parse(Buffer.from(state, 'base64').toString());
    const clientId = this.config.get<string>('BAIDU_APP_KEY');
    const clientSecret = this.config.get<string>('BAIDU_APP_SECRET');
    const redirectUri = this.config.get<string>('BAIDU_OAUTH_REDIRECT_URI');

    const tokenUrl = 'https://openapi.baidu.com/oauth/2.0/token';
    const { data: tokenData } = await axios.get(tokenUrl, {
      params: {
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      },
    });

    const accessToken = tokenData.access_token as string;
    const refreshToken = tokenData.refresh_token as string;
    const expiresIn = tokenData.expires_in as number;

    const { data: userInfo } = await axios.get(
      'https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo',
      { params: { access_token: accessToken } },
    );

    const baiduUid = String(userInfo.baidu_name || userInfo.uk);
    const baiduUk = String(userInfo.uk || '');
    const baiduNickname = (userInfo.netdisk_name || userInfo.baidu_name || '') as string;

    const accessEnc = this.crypto.encrypt(accessToken);
    const refreshEnc = this.crypto.encrypt(refreshToken);

    await this.prisma.user.update({
      where: { id: parsed.userId },
      data: {
        baiduUid,
        baiduUk,
        baiduNickname,
        baiduAccessTokenEncrypted: JSON.stringify(accessEnc),
        baiduRefreshTokenEncrypted: JSON.stringify(refreshEnc),
        baiduTokenExpireAt: new Date(Date.now() + expiresIn * 1000),
        baiduScope: 'netdisk',
      },
    });

    return { redirect: parsed.redirect, role: parsed.role };
  }

  async unbindBaidu(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        baiduUid: null,
        baiduUk: null,
        baiduNickname: null,
        baiduAccessTokenEncrypted: null,
        baiduRefreshTokenEncrypted: null,
        baiduTokenExpireAt: null,
        baiduScope: null,
      },
    });
    return { success: true };
  }
}
