# Zeabur 部署指南

本指南将帮助你将通义千问 API 代理服务部署到 Zeabur 平台。

## 📋 前置要求

1. 一个 [Zeabur](https://zeabur.com) 账号
2. 一个 GitHub 账号（用于代码仓库）
3. 通义千问的 Cookie 和 Token

## 🚀 部署步骤

### 方法一：通过 GitHub 仓库部署（推荐）

#### 1. 准备代码仓库

确保你的代码已经推送到 GitHub 仓库：

```bash
git add .
git commit -m "Prepare for Zeabur deployment"
git push origin main
```

#### 2. 在 Zeabur 中创建项目

1. 登录 [Zeabur](https://zeabur.com)
2. 点击 "New Project" 创建新项目
3. 选择 "Import from GitHub" 并授权访问你的 GitHub 仓库
4. 选择你的 `QwenChat2Api` 仓库

#### 3. 配置环境变量

在 Zeabur 项目设置中添加以下环境变量：

**必需的环境变量：**

```
COOKIE=你的通义千问Cookie值
QWEN_TOKEN=你的通义千问Token（可选，会自动从Cookie获取）
```

**可选的环境变量：**

```
API_KEY=sk-aaaa-bbbb-cccc-dddd           # API密钥（可选）
SERVER_MODE=true                         # 服务器端模式（默认：true）
DEBUG_MODE=false                         # 调试模式（默认：false）
SERVER_PORT=8000                         # 服务端口（默认：8000，Zeabur会自动设置PORT）
VISION_FALLBACK_MODEL=qwen3-vl-plus      # 视觉回退模型（默认：qwen3-vl-plus）
AUTO_REFRESH_TOKEN=true                  # 自动刷新Token（默认：true）
TOKEN_REFRESH_INTERVAL_HOURS=24          # Token刷新间隔（默认：24小时）
```

#### 4. 获取 Cookie 和 Token

##### 方法 A：从浏览器获取

1. 打开浏览器访问 https://chat.qwen.ai
2. 登录你的账户
3. 打开开发者工具 (F12)
4. 切换到 Network 标签页
5. 刷新页面或发送消息
6. 点击任意请求，在 Headers 中找到 Cookie 值
7. 复制完整的 Cookie 值（包括所有键值对）

##### 方法 B：手动编辑配置文件

1. 在本地创建 `cookie.txt` 文件，粘贴 Cookie 值
2. 运行服务（会自动从 Cookie 获取 Token）：
   ```bash
   npm start
   ```
3. 从 `config.json` 中复制 `QWEN_TOKEN` 值
4. 将 Cookie 和 Token 分别设置为 Zeabur 的环境变量

#### 5. 部署

1. 在 Zeabur 项目页面，点击 "Deploy" 按钮
2. Zeabur 会自动检测 Node.js 项目并开始构建
3. 等待构建完成（通常需要 2-5 分钟）
4. 部署成功后，你会获得一个公共 URL（例如：`https://your-project.zeabur.app`）

### 方法二：通过 Zeabur CLI 部署

```bash
# 安装 Zeabur CLI
npm install -g @zeabur/cli

# 登录
zeabur login

# 部署
zeabur deploy
```

## 🔧 配置说明

### 环境变量优先级

项目支持两种配置方式：

1. **环境变量**（推荐用于云部署）
   - 优先使用环境变量
   - 适合 Zeabur、Vercel 等云平台

2. **配置文件**（适合本地开发）
   - `config.json` - 应用配置
   - `cookie.txt` - Cookie 存储

### 重要配置项

- **COOKIE**: 通义千问的 Cookie，用于自动获取和刷新 Token
- **QWEN_TOKEN**: 通义千问的认证 Token（可选，会自动获取）
- **API_KEY**: 用于保护 API 端点的密钥（可选）
- **SERVER_PORT**: 服务端口（Zeabur 会自动设置 `PORT` 环境变量）

## 📝 验证部署

部署完成后，访问以下端点验证服务：

### 1. 健康检查

```bash
curl https://your-project.zeabur.app/health
```

应该返回服务状态信息。

### 2. 获取模型列表

```bash
curl https://your-project.zeabur.app/v1/models \
  -H "Authorization: Bearer your_api_key"
```

### 3. 测试聊天

```bash
curl -X POST https://your-project.zeabur.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key" \
  -d '{
    "model": "qwen3-max",
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

## 🔄 更新部署

### 更新代码

```bash
git add .
git commit -m "Update code"
git push origin main
```

Zeabur 会自动检测到代码更新并重新部署。

### 更新环境变量

1. 在 Zeabur 项目设置中修改环境变量
2. 点击 "Redeploy" 重新部署

## 🐛 故障排除

### 1. 服务无法启动

**问题**: 部署后服务无法启动

**解决方案**:
- 检查环境变量是否正确设置
- 查看 Zeabur 的日志输出
- 确认 `COOKIE` 和 `QWEN_TOKEN` 是否有效

### 2. Token 过期

**问题**: Token 过期导致请求失败

**解决方案**:
- 确保 `COOKIE` 环境变量已设置
- 服务会自动从 Cookie 刷新 Token（如果 `AUTO_REFRESH_TOKEN=true`）
- 或者手动更新 `QWEN_TOKEN` 环境变量

### 3. 404 错误

**问题**: 访问端点返回 404

**解决方案**:
- 检查 URL 是否正确
- 确认服务已成功部署
- 查看服务日志

### 4. 认证失败

**问题**: 返回 401 认证失败

**解决方案**:
- 检查 `API_KEY` 是否正确设置
- 确认请求头中的 Authorization 格式正确
- 如果是服务器端模式，确保 `SERVER_MODE=true`

## 📊 监控和日志

### 查看日志

在 Zeabur 项目页面，点击你的服务，可以查看：
- 实时日志输出
- 构建日志
- 错误日志

### 健康检查

定期访问 `/health` 端点检查服务状态：

```bash
curl https://your-project.zeabur.app/health
```

返回信息包括：
- 服务状态
- Token 有效性
- Token 剩余时间
- 配置信息

## 🔐 安全建议

1. **保护 API_KEY**: 不要将 API_KEY 提交到代码仓库
2. **定期更新 Cookie**: Cookie 可能会过期，定期更新环境变量
3. **使用 HTTPS**: Zeabur 默认提供 HTTPS
4. **限制访问**: 考虑添加 IP 白名单或使用 Zeabur 的访问控制功能

## 📚 相关链接

- [Zeabur 文档](https://zeabur.com/docs)
- [项目 README](./README.md)
- [通义千问官网](https://chat.qwen.ai)

## 💡 提示

1. **首次部署**: 建议先不设置 `QWEN_TOKEN`，让服务自动从 `COOKIE` 获取
2. **自动刷新**: 启用 `AUTO_REFRESH_TOKEN=true` 可以自动维护 Token
3. **调试模式**: 遇到问题时可以临时启用 `DEBUG_MODE=true` 查看详细日志
4. **端口配置**: Zeabur 会自动设置 `PORT` 环境变量，无需手动配置

## 🎉 完成！

部署成功后，你的通义千问 API 代理服务就可以通过 Zeabur 提供的公共 URL 访问了。

如有问题，请查看 Zeabur 的日志或联系支持。

