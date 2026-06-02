export function request<T = any>(options: WechatMiniprogram.RequestOption): Promise<T> {
  return new Promise((resolve, reject) => {
    const app = getApp();
    wx.request({
      ...options,
      url: `${app.globalData.apiBase}${options.url}`,
      header: {
        ...options.header,
        Authorization: `Bearer ${app.globalData.token}`,
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else if (res.statusCode === 401) {
          wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
          wx.removeStorageSync('token');
          app.globalData.token = '';
          wx.redirectTo({ url: '/pages/login/index' });
          reject(res.data);
        } else {
          reject(res.data);
        }
      },
      fail: reject,
    });
  });
}
