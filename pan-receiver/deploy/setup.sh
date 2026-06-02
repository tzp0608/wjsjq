#!/bin/bash
set -e

echo "=== 网盘收件助手 - 服务器一键部署脚本 ==="

# 1. 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 2. 安装 PM2 进程管理器
npm install -g pm2

# 3. 安装 Nginx
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

# 4. 创建应用目录
mkdir -p /opt/pan-receiver
cd /opt/pan-receiver

echo "=== 基础环境安装完成 ==="
echo "请把 backend 目录上传至 /opt/pan-receiver/backend"
echo "然后执行: bash /opt/pan-receiver/deploy/start.sh"
