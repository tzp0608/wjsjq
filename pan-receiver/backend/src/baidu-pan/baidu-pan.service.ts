import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { BaiduPanClient } from './baidu-pan.client';

@Injectable()
export class BaiduPanService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private config: ConfigService,
  ) {}

  async getValidToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.baiduAccessTokenEncrypted) {
      throw new BadRequestException('Baidu account not bound');
    }

    try {
      const accessEnc = JSON.parse(user.baiduAccessTokenEncrypted);
      const refreshEnc = JSON.parse(user.baiduRefreshTokenEncrypted!);

      // Token 还没过期（预留 10 分钟缓冲），直接使用
      if (user.baiduTokenExpireAt && user.baiduTokenExpireAt > new Date(Date.now() + 10 * 60 * 1000)) {
        return this.crypto.decrypt(accessEnc.encrypted, accessEnc.iv, accessEnc.authTag);
      }

      // Token 已过期或即将过期，尝试刷新
      const refreshToken = this.crypto.decrypt(refreshEnc.encrypted, refreshEnc.iv, refreshEnc.authTag);
      const clientId = this.config.get<string>('BAIDU_APP_KEY');
      const clientSecret = this.config.get<string>('BAIDU_APP_SECRET');

      let data;
      try {
        const response = await axios.get('https://openapi.baidu.com/oauth/2.0/token', {
          params: {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
          },
        });
        data = response.data;
      } catch (refreshErr: any) {
        // 刷新失败，清除绑定状态，要求用户重新授权
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            baiduAccessTokenEncrypted: null,
            baiduRefreshTokenEncrypted: null,
            baiduTokenExpireAt: null,
            baiduUid: null,
            baiduUk: null,
            baiduNickname: null,
          },
        });
        throw new BadRequestException('百度网盘授权已过期，请重新绑定');
      }

      // 检查刷新返回是否有效
      if (!data.access_token) {
        throw new BadRequestException('百度网盘授权刷新失败，请重新绑定');
      }

      const newAccess = this.crypto.encrypt(data.access_token);
      const newRefresh = this.crypto.encrypt(data.refresh_token);

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          baiduAccessTokenEncrypted: JSON.stringify(newAccess),
          baiduRefreshTokenEncrypted: JSON.stringify(newRefresh),
          baiduTokenExpireAt: new Date(Date.now() + data.expires_in * 1000),
        },
      });

      return data.access_token;
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      console.error('[getValidToken] Refresh failed:', e.message);
      throw new BadRequestException('百度网盘授权已过期，请重新绑定: ' + e.message);
    }
  }

  async getClient(userId: string): Promise<BaiduPanClient> {
    const token = await this.getValidToken(userId);
    return new BaiduPanClient(token);
  }
}
