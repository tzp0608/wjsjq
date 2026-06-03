import { request } from '../../utils/request';

Page({
  data: {
    baiduBound: false,
  },
  onShow() {
    this.loadUserInfo();
  },
  async loadUserInfo() {
    try {
      const res: any = await request({
        url: '/api/auth/me',
        method: 'GET',
      });
      const baiduBound = !!res?.baiduBound;
      wx.setStorageSync('baiduBound', baiduBound);
      this.setData({ baiduBound });
    } catch (e) {
      const baiduBound = wx.getStorageSync('baiduBound') || false;
      this.setData({ baiduBound });
    }
  },
  async bindBaidu() {
    try {
      const res: any = await request({
        url: '/api/auth/baidu/auth-url?role=owner&redirect=/pages/profile/index',
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
  async unbindBaidu() {
    try {
      await request({
        url: '/api/auth/baidu/unbind',
        method: 'POST',
      });
      wx.setStorageSync('baiduBound', false);
      this.setData({ baiduBound: false });
      wx.showToast({ title: '已解绑', icon: 'success' });
    } catch (e: any) {
      wx.showToast({ title: e?.message || '解绑失败', icon: 'none' });
    }
  },
});
