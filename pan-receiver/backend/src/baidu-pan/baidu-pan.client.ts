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
  category?: number;
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

  private async post(url: string, params?: Record<string, any>, bodyData?: Record<string, any>) {
    const body = bodyData ? new URLSearchParams(bodyData).toString() : undefined;
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

  async listFiles(dirPath: string = '/', order: string = 'time') {
    const res = await this.get('https://pan.baidu.com/rest/2.0/xpan/file?method=list', {
      dir: dirPath,
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

  /** 移动文件到新位置 */
  async moveFile(sourcePath: string, destPath: string) {
    return this.post('https://pan.baidu.com/rest/2.0/xpan/file?method=filemanager', undefined, {
      opera: 'move',
      async: 0,
      filelist: JSON.stringify([{ src: sourcePath, dest: destPath }]),
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
        if (
          e.errno === -8 ||
          e.errno === 2 ||
          e.message?.includes('file exist') ||
          e.message?.includes('errno=2')
        ) continue; // already exists
        // Token expired — must stop
        if (e.errno === -6 || e.errno === -7) throw e;
        // Other errors might be permission issues on /apps/ etc; log and try to continue
      }
    }
  }

  /**
   * 获取上传域名
   */
  async getUploadHost(): Promise<string> {
    try {
      const res = await axios.get(
        'https://pan.baidu.com/rest/2.0/pcs/upload',
        { params: { method: 'uploadhost', access_token: this.accessToken }, timeout: 15000 },
      );
      if (res.data?.host) return res.data.host;
    } catch (_) {}
    // fallback: 尝试 d.pcs.baidu.com 或 c.pcs.baidu.com
    return 'd.pcs.baidu.com';
  }

  /**
   * 统一的上传入口：
   * 先用 precreate + superfile2 + create 流程，
   * 如果失败则降级为单步上传。
   *
   * 第三方应用的文件需要上传到 /apps/{appName} 路径下,
   * 然后再通过 filemanager 的 move 操作移到最终位置.
   */
  async uploadFile(localPath: string, remotePath: string) {
    // 确保 localPath 存在
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }

    const fileSize = fs.statSync(localPath).size;

    // Step 1: 确保远程文件夹存在
    await this.ensureFolder(path.dirname(remotePath));

    // Step 2: 对于小文件(≤4MB)，优先尝试直接单步上传
    if (fileSize <= 4 * 1024 * 1024) {
      try {
        return await this._singleStepUpload(localPath, remotePath);
      } catch (e: any) {
        // 如果是因为路径不在 /apps/ 下导致失败，走"上传+移动"流程
        if (this._isPathError(e)) {
          return await this._uploadViaAppsDir(localPath, remotePath);
        }
        throw e;
      }
    }

    // 大文件：precreate -> superfile2 -> create 流程
    try {
      return await this._chunkedUpload(localPath, remotePath, fileSize);
    } catch (e: any) {
      if (this._isPathError(e)) {
        return await this._uploadViaAppsDir(localPath, remotePath);
      }
      throw e;
    }
  }

  /** 判断是否为路径相关错误(errno=-9 等) */
  private _isPathError(e: any): boolean {
    return e.errno === -9 || e.message?.includes('路径不存在') || e.message?.includes('permission');
  }

  /** 通过 /apps/ 中转目录上传再移动 */
  private async _uploadViaAppsDir(localPath: string, finalRemotePath: string) {
    const fileName = finalRemotePath.split('/').pop();
    const tmpName = `${Date.now()}_${Math.random().toString(36).slice(2)}_${fileName}`;
    const tmpPath = `/apps/_tmp_upload/${tmpName}`;

    // 在临时目录上传
    await this.ensureFolder('/apps/_tmp_upload');

    const stat = fs.statSync(localPath);
    if (stat.size <= 4 * 1024 * 1024) {
      await this._singleStepUpload(localPath, tmpPath);
    } else {
      await this._chunkedUpload(localPath, tmpPath, stat.size);
    }

    // 确保最终目标的父目录存在
    await this.ensureFolder(path.dirname(finalRemotePath));
    
    // 移动到最终位置
    await this.moveFile(tmpPath, finalRemotePath);

    return { path: finalRemotePath };
  }

  /** 单步上传(≤4MB) */
  private async _singleStepUpload(localPath: string, remotePath: string) {
    const fileBuffer = fs.readFileSync(localPath);
    const form = new FormData();
    form.append('file', fileBuffer, { filename: remotePath.split('/').pop() });

    const uploadHost = await this.getUploadHost();
    const url = `https://${uploadHost}/rest/2.0/pcs/file?method=upload&access_token=${this.accessToken}&path=${encodeURIComponent(remotePath)}&ondup=newcopy`;

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
      if (e.response?.data) res = e.response.data;
      else throw new Error(`Baidu upload network error: ${e.message}`);
    }

    if (res?.errno !== undefined && res.errno !== 0) {
      const meaning = this.getErrorMeaning(res.errno);
      throw new Error(`百度网盘上传失败: errno=${res.errno}${meaning ? ' (' + meaning + ')' : ''} | path=${remotePath}`);
    }
    return res;
  }

  /** 分片上传(precreate→superfile2→create) */
  private async _chunkedUpload(localPath: string, remotePath: string, fileSize: number) {
    const blockSize = 4 * 1024 * 1024;
    const totalBlocks = Math.min(Math.ceil(fileSize / blockSize), 1024);

    // Precreate
    const preRes = await this.post(
      'https://pan.baidu.com/rest/2.0/xpan/file?method=precreate',
      undefined,
      {
        path: remotePath,
        size: String(fileSize),
        isdir: '0',
        autoinit: '1',
        block_list: JSON.stringify(Array.from({ length: totalBlocks }, (_, i) => i)),
      },
    );

    const uploadId = String(preRes.uploadid || '');
    if (!uploadId) throw new Error('precreate failed: no uploadid returned');

    const needBlockList: number[] = preRes.block_list && preRes.block_list.length > 0
      ? preRes.block_list
      : Array.from({ length: totalBlocks }, (_, i) => i);

    // Upload chunks
    const uploadHost = await this.getUploadHost();
    const actualMd5s: string[] = [];

    for (const blockIdx of needBlockList) {
      if (blockIdx >= totalBlocks) continue;

      const start = blockIdx * blockSize;
      const end = Math.min(start + blockSize, fileSize);
      const bufLen = end - start;

      const fd = fs.openSync(localPath, 'r');
      const buf = Buffer.alloc(bufLen);
      fs.readSync(fd, buf, 0, bufLen, start);
      fs.closeSync(fd);

      const chunkForm = new FormData();
      chunkForm.append('file', buf, { filename: String(blockIdx) });

      const chunkUrl = `https://${uploadHost}/rest/2.0/pcs/superfile2?method=upload&access_token=${this.accessToken}&type=tmpfile&path=${encodeURIComponent(remotePath)}&uploadid=${encodeURIComponent(uploadId)}&partseq=${blockIdx}`;

      let chunkRes;
      try {
        const cResp = await axios.post(chunkUrl, chunkForm, {
          headers: chunkForm.getHeaders(),
          timeout: 120000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });
        chunkRes = cResp.data;
      } catch (e: any) {
        if (e.response?.data) chunkRes = e.response.data;
        else throw new Error(`Chunk upload failed at block ${blockIdx}: ${e.message}`);
      }

      if (chunkRes?.md5) {
        actualMd5s[blockIdx] = chunkRes.md5;
      } else {
        actualMd5s[blockIdx] = crypto.createHash('md5').update(buf).digest('hex');
      }
    }

    // Fill in missing blocks' MD5
    for (let i = 0; i < totalBlocks; i++) {
      if (!actualMd5s[i]) {
        const start = i * blockSize;
        const end = Math.min(start + blockSize, fileSize);
        const fd = fs.openSync(localPath, 'r');
        const buf = Buffer.alloc(end - start);
        fs.readSync(fd, buf, 0, end - start, start);
        fs.closeSync(fd);
        actualMd5s[i] = crypto.createHash('md5').update(buf).digest('hex');
      }
    }

    // Create (merge)
    const validMd5s = actualMd5s.slice(0, totalBlocks);
    return this.post(
      'https://pan.baidu.com/rest/2.0/xpan/file?method=create',
      undefined,
      {
        path: remotePath,
        size: String(fileSize),
        isdir: '0',
        block_list: JSON.stringify(validMd5s),
        uploadid,
      },
    );
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

  getErrorMeaning(errno: number): string {
    const map: Record<number, string> = {
      [-6]: 'access_token 无效或过期',
      [-7]: '需重新授权',
      [-8]: '文件已存在',
      [-9]: '路径不存在或权限不足',
      [-10]: '容量不足',
      [-11]: '权限被拒绝',
      [2]: '路径不存在',
      [31079]: '文件大小超过限制',
      [31120]: '用户未授权该应用',
      [31401]: 'access_token 过期',
    };
    return map[errno] || '';
  }
}
