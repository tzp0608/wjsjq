import { request } from '../../utils/request';

Page({
  data: {
    title: '',
    description: '',
    targetPath: '/我的资源/收集文件',
    deadline: '',
    baiduBound: false,
  },
  onLoad() {
    const baiduBound = wx.getStorageSync('baiduBound') || false;
    this.setData({ baiduBound });
    if (!baiduBound) {
      wx.showModal({
        title: '提示',
        content: '创建任务需要先绑定百度网盘',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/profile/index' });
        },
      });
    }
  },
  onInput(e: any) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },
  onDateChange(e: any) {
    this.setData({ deadline: e.detail.value });
  },
  async submit() {
    const { title, targetPath } = this.data;
    if (!title || !targetPath) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }
    try {
      const res = await request({
        url: '/api/tasks',
        method: 'POST',
        data: {
          title,
          description: this.data.description,
          targetPath,
          deadline: this.data.deadline ? `${this.data.deadline}T23:59:59+08:00` : undefined,
        },
      });
      const shareCode = (res.sharePath as string).split('code=')[1];
      wx.setStorageSync(`task_share_${res.taskId}`, shareCode);
      wx.showModal({
        title: '创建成功',
        content: `分享路径：${res.sharePath}`,
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/index/index' });
        },
      });
    } catch (e: any) {
      wx.showToast({ title: e?.message || '创建失败', icon: 'none' });
    }
  },
});
