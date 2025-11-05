# 通义千问 API 代理服务

一个将通义千问网页聊天 转换为 OpenAI 标准格式的 Node.js 代理服务，支持流式和非流式响应，具备自动 Token 刷新、图片处理、多模态对话、多 Cookie 负载均衡等功能。

## 🚀 主要特性

- **OpenAI 兼容**: 完全兼容 OpenAI API 格式，支持 `/v1/chat/completions` 和 `/v1/models` 端点
- **流式响应**: 支持 Server-Sent Events (SSE) 流式输出，提供实时对话体验
- **多模态支持**: 支持文本、图片、视频等多种输入格式
- **自动 Token 管理**: 自动从 Cookie 获取和刷新 QWEN_TOKEN，无需手动维护
- **多 Cookie 负载均衡**: 支持配置多个 Cookie，自动轮询分配请求，实现负载均衡和故障转移
- **自动 消息 管理**: 默认保留最新60条对话记录
- **双重认证模式**: 支持服务器端和客户端两种认证模式
- **图片生成**: 支持文本生成图片 (T2I) 和图片编辑功能
- **智能回退**: 当检测到图片输入时自动切换到视觉模型
- **健康监控**: 提供健康检查端点和 Token 状态监控

## 📁 项目结构

```
QwenChat2Api/
├── main.js                 # 主服务入口
├── config.json             # 配置文件
├── cookie.txt              # 存储浏览器 Cookie（可选，可用环境变量）
├── package.json            # 项目依赖配置
├── test.js                 # 测试脚本
├── upload.js               # 文件上传模块
├── chat-helpers.js         # 聊天辅助函数
└── lib/                    # 核心模块库
    ├── config.js           # 配置管理
    ├── config-loader.js    # 配置加载器
    ├── token-refresh.js    # Token 自动刷新
    ├── identity-pool.js    # 身份池管理（负载均衡）
    ├── transformers.js     # 响应格式转换
    ├── http.js             # HTTP 请求封装
    ├── logger.js           # 日志管理
    ├── headers.js          # 请求头构建
    ├── sse.js              # SSE 流处理
    └── chat-deletion.js    # 聊天记录删除
```

## 🛠️ 安装与配置

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 Cookie 和 Token

#### 单 Cookie 配置（传统模式）

**方法一：使用环境变量（推荐）**

设置环境变量：
```bash
export COOKIE="你的Cookie值"
export QWEN_TOKEN="你的Token值（可选，会自动获取）"
```

**方法二：使用配置文件**

1. 创建 `cookie.txt` 文件，将 Cookie 值粘贴进去
2. 编辑 `config.json` 文件，设置 `QWEN_TOKEN`（可选，会自动从 Cookie 获取）

#### 多 Cookie 负载均衡配置（推荐）

为了提升服务的稳定性和并发能力，建议配置多个 Cookie 实现负载均衡。

**方法一：多行文件（推荐）**

在 `cookie.txt` 文件中，每行一个 Cookie：
```
你的第一个Cookie值
你的第二个Cookie值
你的第三个Cookie值
```

**方法二：环境变量分隔符**

使用 `|||` 分隔多个 Cookie：
```bash
export COOKIE="第一个Cookie值|||第二个Cookie值|||第三个Cookie值"
```

**注意事项：**
- 每个 Cookie 对应一个独立的账号
- 服务启动时会自动为每个 Cookie 获取对应的 Token
- 请求会自动轮询分配到不同的身份，实现负载均衡
- 如果某个身份失败，会自动切换到其他可用身份
- 支持注释行：在 `cookie.txt` 中以 `#` 开头的行会被忽略

**获取 Cookie 的方法：**

1. 打开浏览器访问 https://chat.qwen.ai
2. 登录你的账户
3. 打开开发者工具 (F12)
4. 切换到 Network 标签页
5. 刷新页面或发送消息
6. 点击任意请求，在 Headers 中找到 Cookie 值
7. 复制完整的 Cookie 值

### 3. 配置说明

编辑 `config.json` 文件：

```json
{
  "API_KEY": "sk-aaaa-bbbb-cccc-dddd",           // API 密钥（可选，用于访问控制）
  "QWEN_TOKEN": "eyJhbGciOiJIUzI1NiIs...",      // 通义千问 Token（自动获取）
  "SERVER_MODE": true,                           // 服务器端模式
  "DEBUG_MODE": false,                           // 调试模式
  "SERVER_PORT": 8000,                           // 服务端口
  "VISION_FALLBACK_MODEL": "qwen3-vl-plus",        // 视觉回退模型
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

### 6. 多 Cookie 负载均衡 🆕

当配置多个 Cookie 时，服务会自动启用负载均衡模式：

**核心功能：**
- **身份池管理**: 自动为每个 Cookie 获取并维护对应的 Token
- **轮询分配**: 请求按轮询策略分配到不同的身份
- **故障转移**: 当某个身份失败时，自动切换到其他可用身份重试
- **健康监控**: 实时跟踪每个身份的健康状态（healthy/degraded/down）
- **熔断机制**: 失败达到阈值后临时禁用，避免频繁失败
- **自动恢复**: 熔断的身份会在一定时间后自动恢复
- **Token 刷新**: 每个身份的 Token 独立管理和自动刷新

**工作流程：**
1. 启动时检测到多个 Cookie，自动初始化身份池
2. 为每个 Cookie 获取对应的 Token
3. 请求时从身份池中选择可用身份（轮询策略）
4. 如果请求失败，自动切换到下一个身份重试（最多重试 2 次）
5. 标记失败身份，更新健康状态
6. 定时刷新所有身份的 Token

**状态说明：**
- `healthy`: 身份正常，可以正常使用
- `degraded`: 身份降级，有少量失败但仍可使用
- `down`: 身份故障，已熔断，暂时不可用

**优势：**
- 提升并发处理能力
- 降低单账号限流风险
- 提高服务可用性和稳定性
- 自动故障恢复

## 🔍 监控与调试

### 健康检查

```bash
curl http://localhost:8000/health
```

返回服务状态、Token 有效性、配置信息、身份池状态等。

**响应示例：**
```json
{
  "status": "正常",
  "timestamp": "2025-11-05T03:00:00.000Z",
  "version": "3.11",
  "config": {
    "apiKeyEnabled": true,
    "serverMode": true,
    "debugMode": false,
    "autoRefreshToken": true
  },
  "token": {
    "valid": true,
    "expired": false,
    "remainingTime": 604800000,
    "formattedTime": "7天",
    "needsRefresh": false,
    "reason": "Token仍然有效"
  },
  "identityPool": {
    "total": 2,
    "healthy": 2,
    "degraded": 0,
    "down": 0,
    "initialized": true
  }
}
```

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

### 单 Cookie 模式

1. **启动检查**: 服务启动时检查 Token 有效性
2. **定时检查**: 每 24 小时检查一次 Token 状态
3. **过期预警**: Token 即将过期时提前刷新
4. **失败重试**: 刷新失败时自动重试
5. **配置备份**: 更新前自动备份原配置

### 多 Cookie 模式（身份池）

1. **初始化**: 启动时为每个 Cookie 获取对应的 Token
2. **独立管理**: 每个身份的 Token 独立管理和刷新
3. **定时刷新**: 定时检查所有身份的 Token，自动刷新即将过期的
4. **失败处理**: 单个身份刷新失败不影响其他身份
5. **状态跟踪**: 实时跟踪每个身份的健康状态和 Token 有效期

## 📊 性能优化

- **流式处理**: 实时响应，减少延迟
- **连接复用**: HTTP 连接池管理
- **内存控制**: 缓冲区大小限制
- **错误恢复**: 自动重试和降级处理
- **负载均衡**: 多 Cookie 轮询分配，提升并发能力
- **故障转移**: 自动切换可用身份，提高可用性

## 🐛 故障排除

### 常见问题

1. **Token 过期**: 更新 `COOKIE` 环境变量或 `cookie.txt` 文件，服务会自动获取新的 Token
2. **连接失败**: 检查网络连接和防火墙设置
3. **图片上传失败**: 检查文件大小和格式
4. **流式中断**: 检查客户端是否支持 SSE
5. **负载均衡不生效**: 确保 `cookie.txt` 中有多个 Cookie（每行一个），或使用 `|||` 分隔的环境变量
6. **身份池初始化失败**: 检查每个 Cookie 是否有效，无效的 Cookie 会被标记为 degraded 状态
7. **Cookie 格式错误**: 确保 Cookie 字符串中没有换行符等非法字符，服务会自动清理

### 调试步骤

1. 启用调试模式：`DEBUG_MODE: true`
2. 查看详细日志输出
3. 检查健康状态：`/health` 端点
4. 手动刷新 Token：`POST /refresh-token`

## ☁️ 云平台部署

### Zeabur 部署

项目已支持部署到 [Zeabur](https://zeabur.com) 平台。

详细部署指南请查看 [DEPLOY.md](./DEPLOY.md)

**快速步骤：**

1. 将代码推送到 GitHub 仓库
2. 在 Zeabur 中导入项目
3. 设置环境变量：
   - `COOKIE`: 你的通义千问 Cookie
   - `QWEN_TOKEN`: （可选，会自动从 Cookie 获取）
   - `API_KEY`: （可选）API 密钥
4. 部署完成！

**环境变量支持：**

项目支持通过环境变量配置，适合云平台部署：
- `COOKIE` - Cookie 值（支持多 Cookie，使用 `|||` 分隔）
- `QWEN_TOKEN` - Token（单 Cookie 模式使用，多 Cookie 模式下会自动获取）
- `API_KEY` - API 密钥
- `SERVER_MODE` - 服务器模式（默认：true）
- `DEBUG_MODE` - 调试模式（默认：false）
- `PORT` - 服务端口（Zeabur 自动设置）
- `VISION_FALLBACK_MODEL` - 视觉回退模型
- `AUTO_REFRESH_TOKEN` - 自动刷新 Token（默认：true）
- `TOKEN_REFRESH_INTERVAL_HOURS` - Token 刷新间隔（小时，默认：24）

## 📝 更新日志

### v3.11.0
- ✨ **新增多 Cookie 负载均衡功能**
  - 支持配置多个 Cookie，自动轮询分配请求
  - 实现故障转移和自动恢复机制
  - 每个身份独立管理 Token 和健康状态
  - 自动熔断和恢复机制
- ✨ 新增自动 Token 刷新机制
- ✨ 优化图片处理流程
- ✨ 增强错误处理和日志系统
- ✨ 优化日志输出，显示用户提问信息
- ✨ 支持更多模型类型和功能
- ✨ 支持环境变量配置，适配云平台部署
- ✨ 新增 Zeabur 部署支持
- 🐛 修复定时删除任务在多 Cookie 模式下的 Cookie 处理问题

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 📄 许可证

MIT License

---

**注意**: 本项目仅供学习和研究使用，请遵守相关服务的使用条款。
