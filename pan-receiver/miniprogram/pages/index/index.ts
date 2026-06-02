import { request } from '../../utils/request';

Page({
  data: {
    tasks: [] as any[],
  },
  onShow() {
    this.loadTasks();
  },
  async loadTasks() {
    try {
      const tasks = await request<any[]>({ url: '/api/tasks', method: 'GET' });
      this.setData({ tasks });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },
  goCreate() {
    wx.navigateTo({ url: '/pages/create/index' });
  },
  goDetail(e: any) {
    const taskId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/task-detail/index?taskId=${taskId}` });
  },
});