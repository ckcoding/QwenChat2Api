## Qwen API Proxy Service

A Node.js proxy service that converts the Qwen web chat interface into the OpenAI standard API format. It supports both streaming and non-streaming responses, automatic token refreshing, image processing, multimodal conversations, multi-cookie load balancing, and more.

## 🚀 Key Features

- **OpenAI Compatibility**: Fully compatible with the OpenAI API format, supporting the `/v1/chat/completions` and `/v1/models` endpoints.
- **Streaming Responses**: Supports Server-Sent Events (SSE) streaming for real-time conversations.
- **Multimodal Support**: Handles text, images, video, and additional input formats.
- **Automatic Token Management**: Automatically obtains and refreshes the `QWEN_TOKEN` from cookies without manual maintenance.
- **Multi-Cookie Load Balancing**: Configure multiple cookies to enable automatic round-robin request assignment for load balancing and failover.
- **Dual Authentication Modes**: Supports both server-side and client-side authentication models.
- **Image Generation**: Provides text-to-image (T2I) generation and image editing capabilities.
- **Smart Fallback**: Automatically switches to a vision model when image inputs are detected.
- **Health Monitoring**: Offers health check endpoints and token status monitoring.

## 📁 Project Structure

```
QwenChat2Api/
├── main.js                 # Service entry point
├── config.json             # Configuration file
├── cookie.txt              # Browser cookie storage (optional, replaceable by env vars)
├── package.json            # Dependency configuration
├── test.js                 # Test script
├── upload.js               # File upload module
├── chat-helpers.js         # Chat helper functions
└── lib/                    # Core module library
    ├── config.js           # Configuration management
    ├── config-loader.js    # Configuration loader
    ├── token-refresh.js    # Automatic token refresh
    ├── identity-pool.js    # Identity pool management (load balancing)
    ├── transformers.js     # Response transformation
    ├── http.js             # HTTP request wrapper
    ├── logger.js           # Logging management
    ├── headers.js          # Request header builder
    ├── sse.js              # SSE stream handling
    └── chat-deletion.js    # Chat log deletion
```

## 🛠️ Installation & Configuration

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Cookies and Tokens

#### Single-Cookie Setup (Traditional Mode)

**Option 1: Environment Variables (Recommended)**

Set environment variables:

```bash
export COOKIE="your-cookie-value"
export QWEN_TOKEN="your-token-value (optional, auto-generated)"
```

**Option 2: Configuration Files**

1. Create a `cookie.txt` file and paste the cookie value into it.
2. Edit `config.json` and configure `QWEN_TOKEN` (optional, it will be fetched automatically from the cookie).

#### Multi-Cookie Load Balancing (Recommended)

Configure multiple cookies to improve stability and concurrency.

**Option 1: Multi-line File (Recommended)**

Place each cookie on a new line in `cookie.txt`:

```
your-first-cookie-value
your-second-cookie-value
your-third-cookie-value
```

**Option 2: Environment Variable Separator**

Use `|||` to separate cookies:

```bash
export COOKIE="first-cookie|||second-cookie|||third-cookie"
```

**Notes:**

- Each cookie corresponds to an independent account.
- Tokens are fetched automatically for each cookie during startup.
- Requests are distributed in a round-robin manner to balance load.
- Failed identities are automatically rotated out and replaced.
- Comment lines are supported: any line in `cookie.txt` starting with `#` is ignored.

**How to Retrieve Cookies:**

1. Open https://chat.qwen.ai in your browser.
2. Sign in to your account.
3. Open Developer Tools (F12).
4. Switch to the **Network** tab.
5. Refresh the page or send a message.
6. Select any request and locate the cookie in the **Headers** panel.
7. Copy the entire cookie value.

### 3. Configuration Overview

Edit `config.json`:

```json
{
  "API_KEY": "sk-aaaa-bbbb-cccc-dddd",           // API key (optional access control)
  "QWEN_TOKEN": "eyJhbGciOiJIUzI1NiIs...",      // Qwen token (auto-fetched)
  "SERVER_MODE": true,                           // Server mode
  "DEBUG_MODE": false,                           // Debug mode
  "SERVER_PORT": 8000,                           // Server port
  "VISION_FALLBACK_MODEL": "qwen3-vl-plus",     // Vision fallback model
  "AUTO_REFRESH_TOKEN": true,                    // Auto refresh token
  "TOKEN_REFRESH_INTERVAL_HOURS": 24             // Token refresh interval (hours)
}
```

## 🚀 Start the Service

```bash
# Production mode
npm start

# Debug mode
npm run dev

# Run tests
npm test
```

Access the service at: http://localhost:8000

## 📚 API Usage

### 1. List Models

```bash
curl -X GET "http://localhost:8000/v1/models" \
  -H "Authorization: Bearer your_api_key"
```

### 2. Text Chat

```bash
curl -X POST "http://localhost:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key" \
  -d '{
    "model": "qwen3-max",
    "messages": [
      {"role": "user", "content": "Hello, please introduce yourself"}
    ],
    "stream": true
  }'
```

### 3. Image Chat

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
          {"type": "text", "text": "Describe this image"},
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
          {"type": "text", "text": "Describe this image"},
          {"type": "image_url", "image_url": {"url": "<image-url>"}}
        ]
      }
    ],
    "stream": true
  }'
```

### 4. Image Generation

```bash
curl -X POST "http://localhost:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key" \
  -d '{
    "model": "qwen3-max-image",
    "messages": [
      {"role": "user", "content": "Generate a beautiful landscape"}
    ],
    "size": "1024x1024",
    "stream": true
  }'
```

## 🔧 Core Functionality Explained

### 1. Authentication System

**Server Mode** (`SERVER_MODE: true`):

- Uses the `QWEN_TOKEN` from the configuration file.
- Optional `API_KEY` for access control.
- Ideal for server deployments.

**Client Mode** (`SERVER_MODE: false`):

- Retrieves authentication information from request headers.
- Format: `Authorization: Bearer api_key;qwen_token;cookie`
- Suitable for direct client usage.

### 2. Automatic Token Management

- Fetches the latest token from cookies at startup.
- Periodically checks token expiration.
- Automatically refreshes tokens that are about to expire.
- Manual refresh available via `POST /refresh-token`.

### 3. Response Transformation

**Streaming Responses**:

- Converts Qwen SSE streams into the OpenAI format.
- Automatically formats image URLs as Markdown.
- Handles error states and completion signals.

**Non-Streaming Responses**:

- Aggregates stream data into a complete response.
- Maintains OpenAI-compliant structure.
- Supports graceful degradation.

### 4. Multimodal Support

- **Text Chat**: Standard text input/output.
- **Image Understanding**: Supports both base64 and URL images.
- **Image Generation**: Text-to-image (T2I) generation.
- **Image Editing**: Modify existing images.
- **Video Generation**: Text-to-video (T2V) support.

### 5. Intelligent Model Selection

- Automatically selects appropriate models based on input content.
- Switches to vision models when image inputs are detected.
- Supports model suffixes: `-thinking`, `-search`, `-image`, `-image_edit`, `-video`.

### 6. Multi-Cookie Load Balancing 🆕

When multiple cookies are configured, the service enables load balancing automatically.

**Key Functions:**

- **Identity Pool Management**: Maintains tokens for each cookie.
- **Round-Robin Distribution**: Assigns requests in rotation.
- **Failover**: Automatically retries with another identity when a request fails.
- **Health Monitoring**: Tracks the health status (`healthy`, `degraded`, `down`) of each identity.
- **Circuit Breaker**: Temporarily disables identities after repeated failures.
- **Automatic Recovery**: Revives suspended identities after a cooldown period.
- **Independent Token Refresh**: Refreshes tokens per identity.

**Workflow:**

1. Detects multiple cookies at startup and initializes the identity pool.
2. Fetches tokens for each cookie.
3. Selects available identities by round-robin for each request.
4. Retries with the next identity on failure (up to two retries).
5. Updates the health state of failing identities.
6. Periodically refreshes tokens for all identities.

**Status Definitions:**

- `healthy`: Identity is functioning normally.
- `degraded`: Minor failures detected; still usable.
- `down`: Identity is tripped and temporarily unavailable.

**Advantages:**

- Higher concurrency handling.
- Reduced throttling risk for individual accounts.
- Improved service availability and stability.
- Automatic failure recovery.

## 🔍 Monitoring & Debugging

### Health Check

```bash
curl http://localhost:8000/health
```

Returns service status, token validity, configuration info, identity pool state, and more.

**Sample Response:**

```json
{
  "status": "OK",
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
    "formattedTime": "7 days",
    "needsRefresh": false,
    "reason": "Token is still valid"
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

### Debug Mode

Set `DEBUG_MODE: true` to enable verbose logging output.

### Logging System

- Unified log format with timestamps.
- Log levels: `info`, `error`, `debug`.
- Sensitive data is automatically masked.

## 🛡️ Security Features

- **Token Protection**: Automatically masks sensitive token information.
- **Request Validation**: Strict request schema validation.
- **Error Handling**: Robust error handling and graceful fallback.
- **Timeout Control**: Prevents long-running blocked requests.

## 🔄 Automatic Refresh Mechanism

### Single-Cookie Mode

1. **Startup Check**: Validates token status when the service starts.
2. **Scheduled Checks**: Verifies token status every 24 hours.
3. **Expiration Warning**: Refreshes tokens proactively before expiration.
4. **Retry on Failure**: Automatically retries refresh attempts.
5. **Configuration Backup**: Creates a backup before updating tokens.

### Multi-Cookie Mode (Identity Pool)

1. **Initialization**: Fetches tokens for each cookie at startup.
2. **Independent Management**: Manages and refreshes tokens per identity.
3. **Scheduled Refresh**: Periodically checks and refreshes expiring tokens.
4. **Failure Isolation**: Token refresh failures for one identity do not affect others.
5. **State Tracking**: Continuously monitors token validity and health status per identity.

## 📊 Performance Optimization

- **Streaming Processing**: Real-time responses reduce latency.
- **Connection Reuse**: Uses HTTP connection pooling.
- **Memory Control**: Limits buffer sizes.
- **Failure Recovery**: Implements automatic retries and graceful fallback.
- **Load Balancing**: Round-robin distribution across cookies for better concurrency.
- **Failover**: Automatically switches to healthy identities.

## 🐛 Troubleshooting

### Common Issues

1. **Token Expired**: Update the `COOKIE` environment variable or `cookie.txt`; the service will fetch a new token automatically.
2. **Connection Failed**: Check network connectivity and firewall rules.
3. **Image Upload Failed**: Verify file size and format constraints.
4. **Streaming Interrupted**: Ensure the client supports SSE.
5. **Load Balancing Not Working**: Confirm that `cookie.txt` contains multiple cookies (one per line) or that the environment variable uses the `|||` separator.
6. **Identity Pool Initialization Failed**: Validate each cookie; invalid cookies are marked as `degraded`.
7. **Cookie Format Error**: Ensure the cookie string contains no illegal characters; the service cleans common issues automatically.

### Debugging Steps

1. Enable debug mode: `DEBUG_MODE: true`.
2. Inspect detailed log output.
3. Check the `/health` endpoint for status details.
4. Manually refresh tokens via `POST /refresh-token`.

## ☁️ Cloud Deployment

### Deploy to Zeabur

The project supports deployment to [Zeabur](https://zeabur.com).

Refer to [DEPLOY.md](./DEPLOY.md) for detailed instructions.

**Quick Start:**

1. Push the code to a GitHub repository.
2. Import the project in Zeabur.
3. Configure environment variables:
   - `COOKIE`: Your Qwen cookie.
   - `QWEN_TOKEN`: (Optional) Automatically fetched from the cookie.
   - `API_KEY`: (Optional) API access key.
4. Deploy the project.

**Environment Variables:**

- `COOKIE` – Cookie value (`|||` separated for multiple cookies).
- `QWEN_TOKEN` – Token (used in single-cookie mode; auto-fetched in multi-cookie mode).
- `API_KEY` – API key.
- `SERVER_MODE` – Server mode (default: `true`).
- `DEBUG_MODE` – Debug mode (default: `false`).
- `PORT` – Service port (set automatically by Zeabur).
- `VISION_FALLBACK_MODEL` – Vision fallback model.
- `AUTO_REFRESH_TOKEN` – Enable automatic token refreshing (default: `true`).
- `TOKEN_REFRESH_INTERVAL_HOURS` – Token refresh interval in hours (default: `24`).

## 📝 Changelog

### v3.11.0

- ✨ **Added multi-cookie load balancing**
  - Configurable multiple cookies with automatic round-robin distribution.
  - Built-in failover and auto-recovery mechanisms.
  - Independent token and health management per identity.
  - Circuit breaker with automatic restoration.
- ✨ Added automatic token refresh.
- ✨ Optimized image processing.
- ✨ Enhanced error handling and logging.
- ✨ Improved log output with user query details.
- ✨ Added support for more model types and capabilities.
- ✨ Added environment variable configuration for cloud deployment.
- ✨ Added Zeabur deployment support.
- 🐛 Fixed scheduled deletion handling for multi-cookie mode.

## 🤝 Contributing

Contributions via issues and pull requests are welcome.

## 📄 License

MIT License

---

**Note**: This project is for learning and research purposes only. Please comply with the service terms of use.
