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

    const accessEnc = JSON.parse(user.baiduAccessTokenEncrypted);
    const refreshEnc = JSON.parse(user.baiduRefreshTokenEncrypted!);

    if (user.baiduTokenExpireAt && user.baiduTokenExpireAt > new Date(Date.now() + 10 * 60 * 1000)) {
      return this.crypto.decrypt(accessEnc.encrypted, accessEnc.iv, accessEnc.authTag);
    }

    const refreshToken = this.crypto.decrypt(refreshEnc.encrypted, refreshEnc.iv, refreshEnc.authTag);
    const clientId = this.config.get<string>('BAIDU_APP_KEY');
    const clientSecret = this.config.get<string>('BAIDU_APP_SECRET');

    const { data } = await axios.get('https://openapi.baidu.com/oauth/2.0/token', {
      params: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      },
    });

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
  }

  async getClient(userId: string): Promise<BaiduPanClient> {
    const token = await this.getValidToken(userId);
    return new BaiduPanClient(token);
  }
}
