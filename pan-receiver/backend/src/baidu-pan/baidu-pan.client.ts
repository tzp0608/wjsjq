import axios from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface BaiduUserInfo {
  baidu_name: string;
  netdisk_name: string;
  uk: number;
  avatar_url: string;
  vip_type: number;
}

export interface BaiduFileItem {
  path: string;
  server_filename: string;
  size: number;
  isdir: number;
  fs_id: number;
  md5?: string;
}

export class BaiduPanClient {
  constructor(private accessToken: string) {}

  private async get(url: string, params?: Record<string, any>) {
    const { data } = await axios.get(url, {
      params: { ...params, access_token: this.accessToken },
      timeout: 30000,
    });
    if (data.errno !== undefined && data.errno !== 0) {
      const err = new Error(`Baidu API error: ${data.errno}`);
      (err as any).errno = data.errno;
      throw err;
    }
    return data;
  }

  private async post(url: string, params?: Record<string, any>, data?: Record<string, any>) {
    const body = data ? new URLSearchParams(data).toString() : undefined;
    const { data: res } = await axios.post(url, body, {
      params: { ...params, access_token: this.accessToken },
      headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      timeout: 30000,
    });
    if (res.errno !== undefined && res.errno !== 0) {
      const err = new Error(`Baidu API error: ${res.errno}`);
      (err as any).errno = res.errno;
      throw err;
    }
    return res;
  }

  async getUserInfo(): Promise<BaiduUserInfo> {
    return this.get('https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo');
  }

  async getQuota() {
    return this.get('https://pan.baidu.com/api/quota');
  }

  async listFiles(path: string = '/', order: string = 'time') {
    const res = await this.get('https://pan.baidu.com/rest/2.0/xpan/file?method=list', {
      dir: path,
      order,
    });
    return (res.list || []) as BaiduFileItem[];
  }

  async createFolder(targetPath: string) {
    return this.post('https://pan.baidu.com/rest/2.0/xpan/file?method=create', undefined, {
      path: targetPath,
      size: 0,
      isdir: 1,
      rtype: 1,
    });
  }

  async ensureFolder(targetPath: string) {
    const parts = targetPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      try {
        await this.createFolder(current);
      } catch (e: any) {
        // -8 = file already exists (sometimes folder), ignore
        if (e.errno !== -8 && e.errno !== 2 && !e.message?.includes('file exist') && !e.message?.includes('errno=2')) {
          throw e;
        }
      }
    }
  }

  async uploadFile(localPath: string, remotePath: string) {
    const fileData = fs.readFileSync(localPath);
    const form = new FormData();
    form.append('file', fileData, { filename: remotePath.split('/').pop() });

    // 百度 PCS 服务器端上传标准接口
    const url = `https://c.pcs.baidu.com/rest/2.0/pcs/file?method=upload&access_token=${this.accessToken}&path=${encodeURIComponent(remotePath)}&ondup=newcopy`;
    let res;
    try {
      const resp = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      res = resp.data;
    } catch (e: any) {
      // 上传接口经常返回非 200 状态码但带 errno 信息
      if (e.response?.data) {
        res = e.response.data;
      } else {
        throw new Error(`Baidu upload network error: ${e.message}`);
      }
    }

    if (res?.errno !== undefined && res.errno !== 0) {
      // 常见 errno 含义
      const errMap = {
        '-6': 'access_token 无效或过期',
        '-7': 'access_token 已过期，需重新授权',
        '-8': '文件已存在',
        '-9': '文件/路径不存在或权限不足',
        '-10': '容量不足',
        '-11': '权限被拒绝',
        '2': '路径不存在',
        '31079': '文件大小超过限制',
        '31120': '用户未授权该应用',
        '31401': 'access_token 过期',
      };
      const meaning = errMap[String(res.errno)] || '';
      throw new Error(`百度网盘上传失败: errno=${res.errno}${meaning ? ' (' + meaning + ')' : ''} | path=${remotePath}`);
    }

    return res;
  }

  private md5(data: Buffer): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  async getFileMeta(fsids: number[]) {
    return this.get('https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas', {
      fsids: `[${fsids.join(',')}]`,
      thumb: 0,
      dlink: 0,
      extra: 0,
    });
  }

  async getFileMetaWithThumb(fsids: number[]) {
    return this.get('https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas', {
      fsids: `[${fsids.join(',')}]`,
      thumb: 1,
      dlink: 0,
      extra: 1,
    });
  }

  async getFileDlink(fsids: number[]) {
    return this.get('https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas', {
      fsids: `[${fsids.join(',')}]`,
      thumb: 0,
      dlink: 1,
      extra: 0,
    });
  }

  async createShare(fsids: number[]) {
    return this.post('https://pan.baidu.com/rest/2.0/xpan/share?method=create', undefined, {
      fsid_list: `[${fsids.join(',')}]`,
      period: 0,
      description: '来自网盘收件助手',
    });
  }

  async transferFromShare(shareUrl: string, targetPath: string, fromUk: string) {
    const match = shareUrl.match(/shareid=(\d+)/);
    if (!match) throw new Error('Invalid share URL');
    const shareId = match[1];
    return this.post('https://pan.baidu.com/rest/2.0/xpan/share?method=transfer', undefined, {
      shareid: shareId,
      from: fromUk,
      sekey: '',
      path: targetPath,
    });
  }
}
