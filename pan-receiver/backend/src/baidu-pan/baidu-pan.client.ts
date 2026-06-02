import axios from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';

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

  async createFolder(path: string) {
    return this.post('https://pan.baidu.com/rest/2.0/xpan/file?method=create', undefined, {
      path,
      size: 0,
      isdir: 1,
      rtype: 1,
    });
  }

  async uploadFile(localPath: string, remotePath: string) {
    const fileSize = fs.statSync(localPath).size;
    const fileData = fs.readFileSync(localPath);
    const form = new FormData();
    form.append('file', fileData, { filename: remotePath.split('/').pop() });

    const uploadUrl = 'https://d.pcs.baidu.com/rest/2.0/pcs/file';
    const { data: res } = await axios.post(uploadUrl, form, {
      params: {
        method: 'upload',
        access_token: this.accessToken,
        path: remotePath,
        ondup: 'newcopy',
      },
      headers: form.getHeaders(),
      timeout: 120000,
    });
    if (res.errno !== undefined && res.errno !== 0) {
      const err = new Error(`Baidu upload error: ${res.errno}`);
      (err as any).errno = res.errno;
      throw err;
    }
    return res;
  }

  async getFileMeta(fsids: number[]) {
    return this.get('https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas', {
      fsids: `[${fsids.join(',')}]`,
      thumb: 0,
      dlink: 0,
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
