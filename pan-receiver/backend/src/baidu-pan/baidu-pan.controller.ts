import { Controller, Get, Post, Query, Body, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BaiduPanService } from './baidu-pan.service';

@Controller('api/baidu')
export class BaiduPanController {
  constructor(private baiduPan: BaiduPanService) {}

  @Get('files')
  @UseGuards(AuthGuard('jwt'))
  async listFiles(@Req() req: any, @Query('path') path: string) {
    console.log('[baidu/files] listFiles called, path=', path || '/', 'userId=', req.user?.userId);
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
      console.error('[baidu/files] Error:', e.message, e.errno);
      if (e.message?.includes('Baidu account not bound')) {
        throw new BadRequestException('百度网盘未绑定，请先绑定');
      }
      if (e.errno === -6 || e.message?.includes('expired') || e.message?.includes('过期')) {
        throw new BadRequestException('百度网盘授权已过期，请重新绑定');
      }
      throw new BadRequestException(e.message || '百度网盘请求失败');
    }
  }

  @Get('file-preview')
  @UseGuards(AuthGuard('jwt'))
  async getFilePreview(@Req() req: any, @Query('path') filePath: string) {
    try {
      const client = await this.baiduPan.getClient(req.user.userId);
      const dirPath = filePath.split('/').slice(0, -1).join('/') || '/';
      const fileName = filePath.split('/').pop();
      const items = await client.listFiles(dirPath);
      const file = items.find((i: any) => i.server_filename === fileName);
      if (!file) throw new BadRequestException('文件不存在');

      const meta = await client.getFileMetaWithThumb([file.fs_id]);
      const info = meta.list?.[0];

      return {
        name: file.server_filename,
        path: file.path,
        size: file.size,
        fsId: String(file.fs_id),
        thumb: info?.thumbs?.url2 || info?.thumbs?.url1 || info?.thumbs?.url3 || '',
        isImage: [1, 2, 3].includes(file.category),
      };
    } catch (e: any) {
      if (e.message?.includes('Baidu account not bound')) {
        throw new BadRequestException('百度网盘未绑定');
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
