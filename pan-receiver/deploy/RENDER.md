# Render 免费云托管部署指南

## 方案特点

- **零成本**：Render 免费套餐
- **自动 HTTPS**：自带 `xxx.onrender.com` 域名
- **免费 PostgreSQL**：数据持久保存
- **自动部署**：Push 代码后自动重新部署
- **缺点**：15 分钟无访问会休眠，下次访问需等待 30 秒唤醒

## 部署步骤（共 5 步）

### 第 1 步：创建 GitHub 仓库并推送代码

```bash
cd /Users/yunzhouxinmac/ComateProjects/comate-zulu-demo/pan-receiver

# 初始化 Git
git init

# 添加所有文件
git add .

# 提交
git commit -m "Initial commit for Render deployment"

# 去 https://github.com/new 创建新仓库（名称随意，如 pan-receiver）
# 不要勾选 README 和 .gitignore

# 推送代码（把下面 URL 换成你的仓库地址）
git remote add origin https://github.com/你的用户名/pan-receiver.git
git branch -M main
git push -u origin main
```

### 第 2 步：注册 Render

1. 打开 https://render.com
2. 点击 **Sign Up**，选择 **Continue with GitHub**
3. 授权 Render 访问你的仓库

### 第 3 步：一键部署（Blueprint）

1. 在 Render Dashboard 点击 **New +**
2. 选择 **Blueprint**
3. 找到你的 `pan-receiver` 仓库，点击 **Connect**
4. Render 会自动读取 `render.yaml` 配置
5. 给服务起个名字（如 `pan-receiver`），点击 **Apply**

Render 会自动创建：
- 一个 Web Service（运行后端）
- 一个 PostgreSQL 数据库（免费）

### 第 4 步：配置环境变量

部署完成后，进入你的 Web Service 页面：

1. 点击左侧 **Environment**
2. 添加以下环境变量（点击 **Add Environment Variable**）：

| Key | Value |
|-----|-------|
| `WECHAT_APP_ID` | `wx7551e5e61bb119a1` |
| `WECHAT_APP_SECRET` | `64a2ab187fd5f72e2740605bebc0659f` |
| `BAIDU_APP_KEY` | `eWnYxm09Imik6yY15trR2t7snMPkT6V4` |
| `BAIDU_APP_SECRET` | `gpnL15uC9siDmqUffUifNqyjrXOs9arx` |
| `BAIDU_OAUTH_REDIRECT_URI` | `https://你的服务名.onrender.com/api/auth/baidu/callback` |
| `TOKEN_ENCRYPTION_KEY` | 32位随机字符串（见下方生成方法） |

> **注意**：`JWT_SECRET` 和 `TOKEN_ENCRYPTION_KEY` 已经在 `render.yaml` 中自动生成了，你可以在 Environment 页面查看。如果不满意可以手动修改。

**生成 TOKEN_ENCRYPTION_KEY**：
```bash
node -e "const c=require('crypto'); let k=''; const s='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'; for(let i=0;i<32;i++)k+=s[c.randomInt(s.length)]; console.log(k);"
```

### 第 5 步：配置百度 OAuth 回调地址

1. 登录 [百度开发者中心](https://developer.baidu.com/)
2. 找到你的应用，进入 **安全设置**
3. 在 **授权回调页** 中添加：
   ```
   https://你的服务名.onrender.com/api/auth/baidu/callback
   ```
4. 保存

### 第 6 步：配置微信小程序域名

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 开发管理 → 开发设置 → 服务器域名
3. 添加：
   - `request` 合法域名：`https://你的服务名.onrender.com`
   - `uploadFile` 合法域名：`https://你的服务名.onrender.com`
   - `web-view` 业务域名：`https://openapi.baidu.com`

4. 修改 `miniprogram/app.ts`：
   ```typescript
   apiBase: 'https://你的服务名.onrender.com'
   ```

## 查看服务状态

- 打开 Render Dashboard → 你的 Web Service
- 点击 **Logs** 查看实时日志
- 访问 `https://你的服务名.onrender.com/health` 测试是否运行正常

## 更新代码

以后修改代码后，只需：
```bash
git add .
git commit -m "update"
git push origin main
```

Render 会自动重新部署。

## 常见问题

### 1. 服务休眠导致首次访问慢
Render 免费实例 15 分钟无访问会休眠，下次访问需等待 30 秒左右唤醒。如需避免，可以：
- 使用 [UptimeRobot](https://uptimerobot.com) 每 5 分钟 Ping 一次你的服务
- 或升级到 Render Starter 套餐（$7/月）

### 2. 数据库数据在哪里？
Render 免费 PostgreSQL 数据持久保存，不受实例休眠影响。

### 3. 上传的文件存在哪里？
临时文件存储在 Render 实例的 `/tmp` 目录，转存到百度网盘后会自动清理。实例重启后临时文件会丢失，但已转存的文件在百度网盘中不受影响。

### 4. 如何查看数据库？
Render Dashboard → 你的 PostgreSQL 数据库 → **Connect** 标签页，使用提供的连接信息通过 pgAdmin 或命令行连接。
