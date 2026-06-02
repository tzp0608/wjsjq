App<IAppOption>({
  globalData: {
    apiBase: 'http://localhost:3000',
    token: '',
  },
  onLaunch() {
    const token = wx.getStorageSync('token') || '';
    this.globalData.token = token;
  },
});
