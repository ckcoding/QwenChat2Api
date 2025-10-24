# 通义千问 API 代理服务

一个将通义千问网页聊天 转换为 OpenAI 标准格式的 Node.js 代理服务，支持流式和非流式响应，具备自动 Token 刷新、图片处理、多模态对话等功能。

## 🚀 主要特性

- **OpenAI 兼容**: 完全兼容 OpenAI API 格式，支持 `/v1/chat/completions` 和 `/v1/models` 端点
- **流式响应**: 支持 Server-Sent Events (SSE) 流式输出，提供实时对话体验
- **多模态支持**: 支持文本、图片、视频等多种输入格式
- **自动 Token 管理**: 自动从 Cookie 获取和刷新 QWEN_TOKEN，无需手动维护
- **双重认证模式**: 支持服务器端和客户端两种认证模式
- **图片生成**: 支持文本生成图片 (T2I) 和图片编辑功能
- **智能回退**: 当检测到图片输入时自动切换到视觉模型
- **健康监控**: 提供健康检查端点和 Token 状态监控

## 📁 项目结构

```
QwenChat2Api/
├── main.js                 # 主服务入口
├── init.js                 # 初始化脚本，用于设置 Cookie
├── config.json             # 配置文件
├── cookie.txt              # 存储浏览器 Cookie
├── package.json            # 项目依赖配置
├── test.js                 # 测试脚本
├── upload.js               # 文件上传模块
├── chat-helpers.js         # 聊天辅助函数
└── lib/                    # 核心模块库
    ├── config.js           # 配置管理
    ├── token-refresh.js    # Token 自动刷新
    ├── transformers.js     # 响应格式转换
    ├── http.js             # HTTP 请求封装
    ├── logger.js           # 日志管理
    ├── headers.js          # 请求头构建
    └── sse.js              # SSE 流处理
```

## 🛠️ 安装与配置

### 1. 安装依赖

```bash
npm install
```

### 2. 初始化配置

运行初始化脚本设置 Cookie：

```bash
node init.js
```

按照提示：
1. 打开浏览器访问 https://chat.qwen.ai
2. 登录你的账户
3. 打开开发者工具 (F12)
4. 切换到 Network 标签页
5. 刷新页面或发送消息
6. 复制任意请求的 Cookie 值
7. 粘贴到终端

### 3. 配置说明

编辑 `config.json` 文件：

```json
{
  "API_KEY": "sk-aaaa-bbbb-cccc-dddd",           // API 密钥（可选，用于访问控制）
  "QWEN_TOKEN": "eyJhbGciOiJIUzI1NiIs...",      // 通义千问 Token（自动获取）
  "SERVER_MODE": true,                           // 服务器端模式
  "DEBUG_MODE": false,                           // 调试模式
  "SERVER_PORT": 8000,                           // 服务端口
  "VISION_FALLBACK_MODEL": "qwen-vl-max",        // 视觉回退模型
  "AUTO_REFRESH_TOKEN": true,                    // 自动刷新 Token
  "TOKEN_REFRESH_INTERVAL_HOURS": 24             // Token 刷新间隔（小时）
}
```

## 🚀 启动服务

```bash
# 生产模式
npm start

# 调试模式
npm run dev

# 运行测试
npm test
```

服务启动后访问：http://localhost:8000

## 📚 API 使用

### 1. 获取模型列表

```bash
curl -X GET "http://localhost:8000/v1/models" \
  -H "Authorization: Bearer your_api_key"
```

### 2. 文本对话

```bash
curl -X POST "http://localhost:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key" \
  -d '{
    "model": "qwen3-max",
    "messages": [
      {"role": "user", "content": "你好，请介绍一下自己"}
    ],
    "stream": true
  }'
```

### 3. 图片对话

```bash
curl -X POST "http://localhost:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key" \
  -d '{
    "model": "qwen3-max",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "描述这张图片"},
          {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
        ]
      }
    ],
    "stream": true
  }'
```

```bash
curl -X POST "http://localhost:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key" \
  -d '{
    "model": "qwen3-max",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "描述这张图片"},
          {"type": "image_url", "image_url": {"url": "图片URL地址"}}
        ]
      }
    ],
    "stream": true
  }'
```

### 4. 图片生成

```bash
curl -X POST "http://localhost:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key" \
  -d '{
    "model": "qwen3-max-image",
    "messages": [
      {"role": "user", "content": "生成一张美丽的风景画"}
    ],
    "size": "1024x1024",
    "stream": true
  }'
```

## 🔧 核心功能详解

### 1. 认证系统

**服务器端模式** (SERVER_MODE: true):
- 使用配置文件中的 QWEN_TOKEN
- 可选 API_KEY 进行访问控制
- 适合部署在服务器上

**客户端模式** (SERVER_MODE: false):
- 从请求头获取认证信息
- 格式：`Authorization: Bearer api_key;qwen_token;cookie`
- 适合客户端直接调用

### 2. Token 自动管理

- 启动时自动从 Cookie 获取最新 Token
- 定时检查 Token 过期时间
- 自动刷新即将过期的 Token
- 支持手动刷新：`POST /refresh-token`

### 3. 响应格式转换

**流式响应**:
- 将通义千问的 SSE 流转换为 OpenAI 格式
- 支持图片 URL 自动转换为 Markdown 格式
- 处理各种错误状态和完成信号

**非流式响应**:
- 聚合流式数据为完整响应
- 保持 OpenAI 标准格式
- 支持降级处理

### 4. 多模态支持

- **文本对话**: 标准文本输入输出
- **图片理解**: 支持 base64 和 URL 图片
- **图片生成**: 文本生成图片 (T2I)
- **图片编辑**: 基于现有图片进行编辑
- **视频生成**: 文本生成视频 (T2V)

### 5. 智能模型选择

- 根据输入内容自动选择合适模型
- 检测图片输入时自动切换到视觉模型
- 支持模型后缀：`-thinking`, `-search`, `-image`, `-image_edit`, `-video`

## 🔍 监控与调试

### 健康检查

```bash
curl http://localhost:8000/health
```

返回服务状态、Token 有效性、配置信息等。

### 调试模式

设置 `DEBUG_MODE: true` 启用详细日志输出。

### 日志系统

- 统一日志格式，包含时间戳
- 分级日志：info, error, debug
- 敏感信息自动脱敏

## 🛡️ 安全特性

- **Token 保护**: 自动隐藏敏感 Token 信息
- **请求验证**: 严格的请求格式验证
- **错误处理**: 完善的错误处理和降级机制
- **超时控制**: 防止长时间阻塞请求

## 🔄 自动刷新机制

1. **启动检查**: 服务启动时检查 Token 有效性
2. **定时检查**: 每 24 小时检查一次 Token 状态
3. **过期预警**: Token 即将过期时提前刷新
4. **失败重试**: 刷新失败时自动重试
5. **配置备份**: 更新前自动备份原配置

## 📊 性能优化

- **流式处理**: 实时响应，减少延迟
- **连接复用**: HTTP 连接池管理
- **内存控制**: 缓冲区大小限制
- **错误恢复**: 自动重试和降级处理

## 🐛 故障排除

### 常见问题

1. **Token 过期**: 运行 `node init.js` 重新设置 Cookie
2. **连接失败**: 检查网络连接和防火墙设置
3. **图片上传失败**: 检查文件大小和格式
4. **流式中断**: 检查客户端是否支持 SSE

### 调试步骤

1. 启用调试模式：`DEBUG_MODE: true`
2. 查看详细日志输出
3. 检查健康状态：`/health` 端点
4. 手动刷新 Token：`POST /refresh-token`

## 📝 更新日志

### v3.11.0
- 新增自动 Token 刷新机制
- 优化图片处理流程
- 增强错误处理和日志系统
- 支持更多模型类型和功能

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 📄 许可证

MIT License

---

**注意**: 本项目仅供学习和研究使用，请遵守相关服务的使用条款。
