interface IAppOption {
  globalData: {
    apiBase: string;
    token: string;
  };
}

declare namespace WechatMiniprogram {
  interface RequestOption {
    url: string;
    data?: any;
    header?: any;
    method?: 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'CONNECT';
    dataType?: string;
    responseType?: string;
    success?: (res: any) => void;
    fail?: (err: any) => void;
    complete?: () => void;
  }
}
