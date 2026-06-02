Page({
  data: {
    url: ''
  },
  onLoad(options: any) {
    this.setData({ url: decodeURIComponent(options.url || '') });
  }
});
