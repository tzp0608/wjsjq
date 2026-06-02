import { request } from '../../utils/request';

Page({
  async onLoad() {
    const token = wx.getStorageSync('token');
    if (token) {
      try {
        const res: any = await request({ url: '/api/auth/me', method: 'GET' });
        wx.setStorageSync('baiduBound', !!res?.baiduBound);
        if (res?.baiduBound) {
          wx.switchTab({ url: '/pages/index/index' });
        } else {
          wx.switchTab({ url: '/pages/profile/index' });
        }
      } catch (e) {
        // token invalid, stay on login page
      }
    }
  },
  handleLogin() {
    wx.login({
      success: async (res) => {
        try {
          const data = await request<{ token: string; userId: string; baiduBound: boolean }>({
            url: '/api/auth/wechat-login',
            method: 'POST',
            data: { code: res.code },
          });
          const app = getApp();
          app.globalData.token = data.token;
          wx.setStorageSync('token', data.token);
          wx.setStorageSync('baiduBound', data.baiduBound);
          if (data.baiduBound) {
            wx.switchTab({ url: '/pages/index/index' });
          } else {
            wx.switchTab({ url: '/pages/profile/index' });
          }
        } catch (e) {
          wx.showToast({ title: '登录失败', icon: 'none' });
        }
      },
    });
  },
});
