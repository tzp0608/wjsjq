import { request } from '../../utils/request';

Page({
  data: {
    taskId: '',
    task: null as any,
    submissions: [] as any[],
    shareCode: '',
  },
  onLoad(options: any) {
    const storedCode = wx.getStorageSync(`task_share_${options.taskId}`) || '';
    this.setData({ taskId: options.taskId, shareCode: options.code || storedCode });
    if (options.taskId) {
      this.loadTask();
      this.loadSubmissions();
    }
  },
  async loadTask() {
    try {
      const task = await request({
        url: `/api/tasks/${this.data.taskId}`,
        method: 'GET',
      });
      this.setData({ task });
    } catch (e: any) {
      wx.showToast({ title: e?.message || '加载失败', icon: 'none' });
    }
  },
  async copySharePath() {
    const task = this.data.task;
    if (!task) return;
    let shareCode = this.data.shareCode;
    if (!shareCode) {
      try {
        const res: any = await request({
          url: `/api/tasks/${this.data.taskId}/regenerate-share`,
          method: 'POST',
        });
        shareCode = res.sharePath.split('code=')[1];
        this.setData({ shareCode });
      } catch (e: any) {
        wx.showToast({ title: e?.message || '获取分享链接失败', icon: 'none' });
        return;
      }
    }
    const sharePath = `/pages/submit/index?taskId=${this.data.taskId}&code=${shareCode}`;
    wx.setClipboardData({
      data: sharePath,
      success: () => {
        wx.showToast({ title: '分享链接已复制', icon: 'success' });
      },
    });
  },
  async loadSubmissions() {
    try {
      const submissions = await request({
        url: `/api/tasks/${this.data.taskId}/submissions`,
        method: 'GET',
      });
      this.setData({ submissions: submissions || [] });
    } catch (e: any) {
      console.error('加载提交记录失败', e);
    }
  },
  copySharePath() {
    const task = this.data.task;
    if (!task) return;
    const sharePath = `/pages/submit/index?taskId=${this.data.taskId}&code=${this.data.shareCode}`;
    wx.setClipboardData({
      data: sharePath,
      success: () => {
        wx.showToast({ title: '分享链接已复制', icon: 'success' });
      },
    });
  },
  async closeTask() {
    try {
      await request({
        url: `/api/tasks/${this.data.taskId}/close`,
        method: 'POST',
      });
      wx.showToast({ title: '任务已关闭', icon: 'success' });
      this.loadTask();
    } catch (e: any) {
      wx.showToast({ title: e?.message || '关闭失败', icon: 'none' });
    }
  },
});
