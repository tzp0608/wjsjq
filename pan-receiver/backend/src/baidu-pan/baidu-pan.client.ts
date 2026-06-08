import axios from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';

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
      timeout: 60000,
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

  /** 创建文件夹 */
  async createFolder(targetPath: string) {
    try {
      return await this.post('https://pan.baidu.com/rest/2.0/xpan/file?method=create', undefined, {
        path: targetPath,
        size: 0,
        isdir: 1,
        rtype: 1,
      });
    } catch (e: any) {
      if (e.errno === -8 || e.message?.includes('file exist')) return {};
      throw e;
    }
  }

  /** 确保目录路径存在 */
  async ensureFolder(dirPath: string) {
    if (!dirPath || dirPath === '/') return;
    try {
      await this.createFolder(dirPath);
      return;
    } catch (_) {}

    const parts = dirPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      try {
        await this.createFolder(current);
      } catch (e: any) {
        if (e.errno === -6 || e.errno === -7) throw e;
      }
    }
  }

  /**
   * 上传文件到百度网盘
   * 策略：先上传到 /apps/_tmp_upload/ 临时目录，再 rename 到最终位置
   */
  async uploadFile(localFilePath: string, remotePath: string) {
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Local file not found: ${localFilePath}`);
    }

    const fileName = path.basename(remotePath);
    const tmpUploadDir = '/apps/_tmp_upload';
    
    // 确保临时上传目录存在
    await this.ensureFolder(tmpUploadDir);

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const safeName = `${timestamp}_${randomSuffix}_${fileName}`;
    const appsTmpPath = `${tmpUploadDir}/${safeName}`;

    console.log(`[BaiduClient] Uploading to temp: ${appsTmpPath}`);

    // 执行 PCS 单步上传
    await this._pcsSingleUpload(localFilePath, appsTmpPath);

    // 如果目标路径就在 /apps/ 下，不需要移动
    if (remotePath.startsWith('/apps/')) {
      if (appsTmpPath !== remotePath) {
        await this.ensureFolder(path.dirname(remotePath));
        await this._renameFile(appsTmpPath, remotePath);
      }
      return { path: remotePath };
    }

    // 目标不在 /apps/ 下 → 创建目标目录 + 移动文件
    console.log(`[BaiduClient] Moving from ${appsTmpPath} -> ${remotePath}`);
    await this.ensureFolder(path.dirname(remotePath));
    await this._renameFile(appsTmpPath, remotePath);

    return { path: remotePath };
  }

  /** PCS 单步上传 */
  private async _pcsSingleUpload(localFilePath: string, pcsRemotePath: string) {
    const fileBuffer = fs.readFileSync(localFilePath);
    const form = new FormData();
    form.append('file', fileBuffer, { filename: path.basename(pcsRemotePath) });

    const url = `https://c.pcs.baidu.com/rest/2.0/pcs/file?method=upload&access_token=${this.accessToken}&path=${encodeURIComponent(pcsRemotePath)}&ondup=newcopy`;

    let res: any;
    try {
      const resp = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 180000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      res = resp.data;
    } catch (e: any) {
      if (e.response?.data) res = e.response.data;
      else throw new Error(`PCS upload network error: ${e.message}`);
    }

    if (!res) throw new Error('PCS upload returned empty response');

    if (res.errno !== undefined && res.errno !== 0) {
      const meaning = this._errorMeaning(res.errno);
      throw new Error(`百度网盘上传失败 errno=${res.errno}${meaning ? '('+meaning+')' : ''}, path=${pcsRemotePath}`);
    }

    return res;
  }

  /** 重命名/移动文件 */
  private async _renameFile(srcPath: string, destPath: string) {
    return this.post(
      'https://pan.baidu.com/rest/2.0/xpan/file?method=filemanager',
      undefined,
      {
        opera: 'rename',
        async: '1',
        filelist: JSON.stringify([{ path: srcPath, newname: destPath }]),
        ondup: 'newcopy',
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

  async getFileDlink(fsids: number[]) {
    return this.get('https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas', {
      fsids: `[${fsids.join(',')}]`,
      thumb: 0,
      dlink: 1,
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

  private _errorMeaning(errno: number): string {
    const map: Record<number, string> = {
      [-6]: 'token无效或过期',
      [-7]: '需重新授权',
      [-8]: '文件已存在',
      [-9]: '路径不存在或权限不足',
      [-10]: '容量不足',
      [2]: '参数错误',
      [31079]: '文件超限',
      [31120]: '未授权该应用',
    };
    return map[errno] || '';
  }
}