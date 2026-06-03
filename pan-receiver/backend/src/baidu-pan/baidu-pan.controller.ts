import { Controller, Get, Post, Query, Body, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BaiduPanService } from './baidu-pan.service';

@Controller('api/baidu')
export class BaiduPanController {
  constructor(private baiduPan: BaiduPanService) {}

  @Get('files')
  @UseGuards(AuthGuard('jwt'))
  async listFiles(@Req() req: any, @Query('path') path: string) {
    try {
      const client = await this.baiduPan.getClient(req.user.userId);
      const items = await client.listFiles(path || '/');
      return {
        path: path || '/',
        items: items.map((item: any) => ({
          name: item.server_filename,
          path: item.path,
          isDir: item.isdir === 1,
          size: item.size,
          fsId: String(item.fs_id),
        })),
      };
    } catch (e: any) {
      if (e.message?.includes('Baidu account not bound')) {
        throw new BadRequestException('百度网盘未绑定');
      }
      if (e.errno === -6 || e.message?.includes('Baidu API error')) {
        throw new BadRequestException('百度网盘授权已过期，请重新绑定');
      }
      throw e;
    }
  }

  @Post('folders')
  @UseGuards(AuthGuard('jwt'))
  async createFolder(@Req() req: any, @Body('path') path: string) {
    const client = await this.baiduPan.getClient(req.user.userId);
    await client.createFolder(path);
    return { path, created: true };
  }
}
