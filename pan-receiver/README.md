# 网盘收件助手

基于微信小程序 + NestJS 后端 + 百度网盘开放平台的文件收集系统。

## 技术架构

- 小程序端：微信原生小程序 + TypeScript
- 后端：NestJS + Prisma + PostgreSQL + Redis + BullMQ
- 存储：服务器本地临时目录（支持对象存储扩展）
- 队列：BullMQ（上传 / 分享 / 转存）

## 项目结构

```
pan-receiver/
├── backend/              NestJS 后端服务
│   ├── src/
│   │   ├── auth/         微信登录 + JWT + 百度 OAuth
│   │   ├── tasks/        收集任务管理
│   │   ├── submissions/  提交单与文件上传
│   │   ├── baidu-pan/    百度网盘 API 封装
│   │   ├── queue/        BullMQ 队列处理器
│   │   ├── prisma/       Prisma 服务
│   │   └── common/       加密、限流、审计
│   ├── prisma/
│   │   └── schema.prisma 数据库模型
│   └── .env              环境变量（需自行创建）
├── miniprogram/          微信小程序
│   ├── pages/            页面
│   ├── utils/            工具函数
│   └── app.ts            小程序入口
├── h5/                   H5 辅助页面
│   └── oauth-callback.html 百度 OAuth 回调
└── docker-compose.yml    PostgreSQL + Redis
```

## 快速启动

### 1. 启动基础设施

需要本地安装 Docker 和 Docker Compose。

```bash
docker-compose up -d
```

这将启动：
- PostgreSQL 16（端口 5432）
- Redis 7（端口 6379）

### 2. 配置后端环境变量

```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入你的真实配置
```

必须配置的项：
- `WECHAT_APP_ID` / `WECHAT_APP_SECRET`：微信小程序凭证
- `BAIDU_APP_KEY` / `BAIDU_APP_SECRET`：百度开放平台凭证
- `JWT_SECRET`：随机字符串（建议 32 位以上）
- `TOKEN_ENCRYPTION_KEY`：AES 加密密钥（必须 32 字节）

### 3. 初始化数据库

```bash
cd backend
npx prisma migrate dev --name init
npx prisma generate
```

### 4. 启动后端

```bash
npm run start:dev
```

后端默认运行在 http://localhost:3000

### 5. 导入微信小程序

1. 使用微信开发者工具导入 `miniprogram` 目录
2. 修改 `miniprogram/app.ts` 中的 `apiBase` 为实际后端地址
3. 在微信小程序后台配置 `request` 合法域名和 `uploadFile` 合法域名
4. 配置业务域名以支持 `web-view` 打开百度授权页

### 6. 部署 H5 回调页

将 `h5/oauth-callback.html` 部署为静态页面，确保其所在域名与 `BAIDU_OAUTH_REDIRECT_URI` 一致。

## 核心流程

### 发起人

1. 微信登录
2. 绑定百度网盘（OAuth 授权）
3. 创建收集任务，选择接收目录
4. 分享任务链接给提交人
5. 文件自动转存到指定百度网盘目录

### 提交人

1. 打开分享链接
2. 微信登录
3. 绑定百度网盘
4. 选择微信聊天文件 / 相册图片 / 百度网盘已有文件
5. 确认提交，后台自动完成上传 → 分享 → 转存

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/wechat-login | 微信登录 |
| GET | /api/auth/me | 当前用户信息 |
| GET | /api/auth/baidu/auth-url | 获取百度授权链接 |
| GET | /api/auth/baidu/callback | 百度授权回调 |
| POST | /api/auth/baidu/unbind | 解绑百度网盘 |
| POST | /api/tasks | 创建任务 |
| GET | /api/tasks | 任务列表 |
| GET | /api/tasks/:id | 任务详情 |
| POST | /api/tasks/:id/close | 关闭任务 |
| GET | /api/tasks/:id/submissions | 任务提交记录 |
| GET | /api/public/tasks/:id | 公开任务信息 |
| POST | /api/submissions | 创建提交单 |
| POST | /api/submissions/:id/upload | 上传本地文件 |
| POST | /api/submissions/:id/pan-files | 提交网盘已有文件 |
| GET | /api/submissions/:id/status | 查询提交状态 |
| POST | /api/submissions/:id/retry | 重试提交 |
| GET | /api/baidu/files | 网盘目录列表 |
| POST | /api/baidu/folders | 创建网盘目录 |

## 注意事项

1. **百度网盘权限**：需要在百度开放平台申请 `netdisk` 权限
2. **微信小程序域名**：后端域名必须加入小程序的 `request` 和 `uploadFile` 合法域名
3. **业务域名**：`openapi.baidu.com` 需要加入小程序 `web-view` 业务域名，否则授权页无法打开
4. **文件大小限制**：默认单文件 500MB，前后端双重校验
5. **Token 加密**：百度 access_token / refresh_token 使用 AES-256-GCM 加密存储
