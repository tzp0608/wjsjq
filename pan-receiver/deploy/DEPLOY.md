# 云服务器部署指南

## 推荐配置

- **阿里云轻量应用服务器** 或 **腾讯云轻量应用服务器**
- 地区：**香港/新加坡**（免备案）或 **国内**（需备案域名）
- 配置：1核1G 即可，带宽 3Mbps
- 系统：Ubuntu 22.04 LTS
- 价格：约 99 元/年

## 快速部署（三步）

### 1. 连接服务器并安装环境

```bash
# SSH 连接服务器（替换为你的服务器 IP）
ssh root@your-server-ip

# 下载并执行环境安装脚本
curl -fsSL https://raw.githubusercontent.com/your-repo/pan-receiver/main/deploy/setup.sh | bash
```

或直接执行：
```bash
apt update && apt install -y nodejs npm nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
```

### 2. 上传代码

在本地终端执行：
```bash
# 把整个 backend 目录传到服务器
scp -r backend/ root@your-server-ip:/opt/pan-receiver/

# 上传生产环境配置
scp deploy/.env.production root@your-server-ip:/opt/pan-receiver/backend/.env
```

### 3. 启动服务

```bash
ssh root@your-server-ip
cd /opt/pan-receiver/backend
npm install --production
npx prisma generate
npx prisma migrate deploy
pm2 start dist/main.js --name pan-receiver
pm2 save
pm2 startup systemd
```

### 4. 配置 Nginx + SSL

```bash
# 复制 Nginx 配置
cp /opt/pan-receiver/deploy/nginx.conf /etc/nginx/sites-available/pan-receiver
ln -s /etc/nginx/sites-available/pan-receiver /etc/nginx/sites-enabled/

# 编辑配置，把 your-domain.com 换成你的域名
nano /etc/nginx/sites-available/pan-receiver

# 申请 SSL 证书（免费）
certbot --nginx -d your-domain.com

# 重启 Nginx
systemctl restart nginx
```

## 防火墙配置

```bash
# 开放 80 和 443 端口
ufw allow 80
ufw allow 443
ufw allow 22
ufw enable
```

## 微信小程序域名配置

登录 [微信公众平台](https://mp.weixin.qq.com/)：

| 类型 | 填写内容 |
|------|----------|
| request 合法域名 | `https://your-domain.com` |
| uploadFile 合法域名 | `https://your-domain.com` |
| web-view 业务域名 | `https://openapi.baidu.com` |

**注意**：必须用 HTTPS，HTTP 域名微信小程序会拦截。

## 备份数据库

SQLite 数据库文件在 `/opt/pan-receiver/backend/prisma/dev.db`，建议定期备份：

```bash
# 手动备份
scp root@your-server-ip:/opt/pan-receiver/backend/prisma/dev.db ./backup-$(date +%Y%m%d).db

# 或配置 crontab 自动备份
0 3 * * * cp /opt/pan-receiver/backend/prisma/dev.db /backup/pan-receiver-$(date +\%Y\%m\%d).db
```

## 更新代码

```bash
ssh root@your-server-ip
cd /opt/pan-receiver/backend
# 上传新代码后
npm run build
pm2 restart pan-receiver
```

## 监控日志

```bash
# 实时查看后端日志
pm2 logs pan-receiver

# 查看 Nginx 访问日志
tail -f /var/log/nginx/access.log

# 查看 Nginx 错误日志
tail -f /var/log/nginx/error.log
```
