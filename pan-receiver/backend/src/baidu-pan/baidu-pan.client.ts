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
        // -8 = file already exists, ignore
        if (e.errno !== -8 && !e.message?.includes('file exist')) {
          throw e;
        }
      }
    }
  }

  async uploadFile(localPath: string, remotePath: string) {
    const fileSize = fs.statSync(localPath).size;
    const fileData = fs.readFileSync(localPath);

    // 使用百度网盘 xpan 官方上传流程：precreate -> 分片上传 -> create
    const fileName = remotePath.split('/').pop();
    const dirPath = path.dirname(remotePath);

    // Step 1: precreate - 创建文件记录
    const precreateRes = await this.post('https://pan.baidu.com/rest/2.0/xpan/file?method=precreate', undefined, {
      path: remotePath,
      size: fileSize,
      isdir: 0,
      autoinit: 1,
      block_list: JSON.stringify([this.md5(fileData)]),
    });

    if (precreateRes.errno !== 0) {
      throw new Error(`Baidu precreate error: ${precreateRes.errno}`);
    }

    // 如果文件已存在且不需要上传
    if (precreateRes.return_value?.exists === 1) {
      return precreateRes.return_value;
    }

    const uploadId = precreateRes.return_value?.uploadid;
    if (!uploadId) {
      throw new Error('No uploadid from precreate');
    }

    // Step 2: superfile2 - 上传文件内容
    const form = new FormData();
    form.append('file', fileData, { filename: fileName });

    await axios.post('https://pan.baidu.com/rest/2.0/xpan/file?method=superfile2', form, {
      params: {
        method: 'superfile2',
        access_token: this.accessToken,
        path: remotePath,
        uploadid: uploadId,
        partseq: 0,
      },
      headers: form.getHeaders(),
      timeout: 120000,
    });

    // Step 3: create - 创建文件记录
    const createRes = await this.post('https://pan.baidu.com/rest/2.0/xpan/file?method=create', undefined, {
      path: remotePath,
      size: fileSize,
      isdir: 0,
      uploadid: uploadId,
      block_list: JSON.stringify([this.md5(fileData)]),
    });

    if (createRes.errno !== 0) {
      throw new Error(`Baidu create error: ${createRes.errno}`);
    }

    return createRes;
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
