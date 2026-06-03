import { request } from '../../utils/request';

Page({
  data: {
    taskId: '',
    code: '',
    task: null as any,
    files: [] as any[],
    fileMap: {} as Record<string, string>,
    submissionId: '',
    status: '',
    baiduBound: false,
    loggedIn: false,
  },
  onLoad(options: any) {
    this.setData({ taskId: options.taskId || '', code: options.code || '' });
    this.refreshAuthStatus();
    if (options.taskId && options.code) {
      this.loadTask();
    }
  },
  async refreshAuthStatus() {
    const token = wx.getStorageSync('token');
    if (!token) {
      this.setData({ loggedIn: false, baiduBound: false });
      return;
    }
    this.setData({ loggedIn: true });
    try {
      const res: any = await request({ url: '/api/auth/me', method: 'GET' });
      const baiduBound = !!res?.baiduBound;
      wx.setStorageSync('baiduBound', baiduBound);
      this.setData({ baiduBound });
    } catch (e) {
      const baiduBound = wx.getStorageSync('baiduBound') || false;
      this.setData({ baiduBound });
    }
  },
  goLogin() {
    wx.navigateTo({ url: '/pages/login/index' });
  },
  async bindBaidu() {
    try {
      const res: any = await request({
        url: '/api/auth/baidu/auth-url?role=submitter&redirect=/pages/submit/index',
        method: 'GET',
      });
      wx.setClipboardData({
        data: res.authUrl,
        success: () => {
          wx.showModal({
            title: '请复制链接到浏览器授权',
            content: '百度授权链接已复制到剪贴板。请打开手机浏览器粘贴访问，完成授权后返回小程序即可。',
            showCancel: false,
          });
        },
      });
    } catch (e: any) {
      wx.showToast({ title: e?.message || '获取授权链接失败', icon: 'none' });
    }
  },
  async loadTask() {
    try {
      const task = await request({
        url: `/api/public/tasks/${this.data.taskId}?code=${this.data.code}`,
        method: 'GET',
      });
      this.setData({ task });
    } catch (e: any) {
      wx.showToast({ title: e?.message || '任务加载失败', icon: 'none' });
    }
  },
  chooseMessageFile() {
    wx.chooseMessageFile({
      count: 9,
      type: 'all',
      success: (res) => {
        const files = res.tempFiles.map((f) => ({
          name: f.name,
          path: f.path,
          size: f.size,
          type: f.type,
        }));
        this.validateAndSet(files);
      },
    });
  },
  chooseMedia() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image', 'video'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = res.tempFiles.map((f) => ({
          name: f.tempFilePath.split('/').pop() || 'file',
          path: f.tempFilePath,
          size: f.size,
          type: f.fileType,
        }));
        this.validateAndSet(files);
      },
    });
  },
  validateAndSet(files: any[]) {
    const maxSize = (this.data.task?.maxFileSize as number) || 524288000;
    const valid = files.filter((f) => f.size <= maxSize);
    if (valid.length !== files.length) {
      wx.showToast({ title: '当前版本单个文件最大支持 500MB', icon: 'none' });
    }
    this.setData({ files: valid });
  },
  async submitFiles() {
    const { files, taskId } = this.data;
    if (files.length === 0) return;
    try {
      const res: any = await request({
        url: '/api/submissions',
        method: 'POST',
        data: {
          taskId,
          sourceType: 'wechat_message_file',
          files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
        },
      });
      const fileMap: Record<string, string> = {};
      for (const f of res.files || []) {
        const localFile = files.find((lf: any) => lf.name === f.name);
        if (localFile) fileMap[localFile.name] = f.fileId;
      }
      this.setData({ submissionId: res.submissionId, fileMap });
      await this.uploadFiles(res.submissionId, fileMap);
      this.pollStatus(res.submissionId);
    } catch (e: any) {
      wx.showToast({ title: e?.message || '提交失败', icon: 'none' });
    }
  },
  uploadFiles(submissionId: string, fileMap: Record<string, string>) {
    const app = getApp();
    return Promise.all(
      this.data.files.map((f) => {
        const fileId = fileMap[f.name];
        if (!fileId) return Promise.resolve();
        return new Promise((resolve, reject) => {
          wx.uploadFile({
            url: `${app.globalData.apiBase}/api/submissions/${submissionId}/upload`,
            filePath: f.path,
            name: 'file',
            header: { Authorization: `Bearer ${app.globalData.token}` },
            formData: { fileId, taskId: this.data.taskId },
            success: resolve,
            fail: reject,
          });
        });
      }),
    );
  },
  async pollStatus(submissionId: string) {
    const timer = setInterval(async () => {
      try {
        const status: any = await request({
          url: `/api/submissions/${submissionId}/status`,
          method: 'GET',
        });
        this.setData({ status: status.status });
        if (['success', 'partial_success', 'failed'].includes(status.status)) {
          clearInterval(timer);
          wx.showToast({ title: status.status === 'success' ? '提交成功' : '提交完成', icon: 'none' });
        }
      } catch (e) {
        clearInterval(timer);
      }
    }, 2000);
  },
});
