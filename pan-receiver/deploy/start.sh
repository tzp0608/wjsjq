#!/bin/bash
set -e

cd /opt/pan-receiver/backend

# 安装依赖
npm install --production

# 生成 Prisma Client
npx prisma generate

# 数据库初始化（如果不存在）
npx prisma migrate deploy

# 用 PM2 启动
pm2 delete pan-receiver 2>/dev/null || true
pm2 start dist/main.js --name pan-receiver --env production
pm2 save
pm2 startup systemd

echo "=== 后端已启动 ==="
echo "请配置 Nginx 反向代理和 SSL 证书"
