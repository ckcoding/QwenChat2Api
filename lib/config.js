// 配置模块：读取并导出 config.json 以及常用的获取函数
// 目的：集中管理配置，避免在业务代码中到处读取文件
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// 配置文件路径
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const COOKIE_PATH = path.join(__dirname, '..', 'cookie.txt');

// 安全读取文件函数
function safeReadFile(filePath, defaultValue = '') {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8').trim();
    }
    return defaultValue;
  } catch (error) {
    console.warn(`读取文件失败: ${filePath}`, error.message);
    return defaultValue;
  }
}

// 同步读取配置（服务启动时读取一次即可）
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const cookie = safeReadFile(COOKIE_PATH);

// 获取API密钥（用于简单鉴权）
function getApiKey() { return config.API_KEY || ''; }
// 获取通义千问 Token
function getQwenToken() { return config.QWEN_TOKEN || ''; }
// 获取浏览器 Cookie（某些接口需要）
function getCookie() { return cookie || ''; }
// 是否使用服务端认证模式
function isServerMode() { return !!config.SERVER_MODE; }
// 是否开启调试日志
function isDebugMode() { return !!config.DEBUG_MODE; }
// 服务端口
function getServerPort() { return Number(config.SERVER_PORT || 8000); }
// 视觉模型回退名（当纯文本模型携带图片时自动切换）
function getVisionFallbackModel() { return config.VISION_FALLBACK_MODEL || ''; }

// JWT token 解析和过期时间检测
function parseJwtToken(token) {
  try {
    // 不验证签名，只解析payload
    const decoded = jwt.decode(token, { complete: true });
    return decoded;
  } catch (error) {
    return null;
  }
}

// 检查token是否过期
function isTokenExpired(token) {
  const decoded = parseJwtToken(token);
  if (!decoded || !decoded.payload || !decoded.payload.exp) {
    return true; // 无法解析或没有过期时间，认为已过期
  }
  
  const currentTime = Math.floor(Date.now() / 1000);
  return decoded.payload.exp < currentTime;
}

// 获取token过期时间（毫秒时间戳）
function getTokenExpiryTime(token) {
  const decoded = parseJwtToken(token);
  if (!decoded || !decoded.payload || !decoded.payload.exp) {
    return null;
  }
  return decoded.payload.exp * 1000; // 转换为毫秒
}

// 获取token剩余有效时间（毫秒）
function getTokenRemainingTime(token) {
  const expiryTime = getTokenExpiryTime(token);
  if (!expiryTime) {
    return 0;
  }
  const remaining = expiryTime - Date.now();
  return Math.max(0, remaining);
}

// 格式化剩余时间显示
function formatRemainingTime(remainingMs) {
  if (remainingMs <= 0) return '已过期';
  
  const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) {
    return `${days}天${hours}小时`;
  } else if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  } else {
    return `${minutes}分钟`;
  }
}

// 动态重新加载配置（用于token刷新后）
function reloadConfig() {
  try {
    const newConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    Object.assign(config, newConfig);
    return true;
  } catch (error) {
    console.error('重新加载配置失败:', error);
    return false;
  }
}

// 检查token是否需要刷新
function shouldRefreshToken() {
  const token = getQwenToken();
  if (!token) return true;
  
  // 如果token已过期，需要刷新
  if (isTokenExpired(token)) return true;
  
  const remainingTime = getTokenRemainingTime(token);
  const oneDayInMs = 24 * 60 * 60 * 1000;
  
  // 如果剩余时间少于24小时，则需要刷新
  return remainingTime < oneDayInMs;
}

// 获取token刷新状态信息
function getTokenRefreshInfo() {
  const token = getQwenToken();
  if (!token) {
    return {
      needsRefresh: true,
      reason: 'No token found',
      remainingTime: 0,
      formattedTime: 'N/A',
      valid: false,
      isExpired: true
    };
  }
  
  const isExpired = isTokenExpired(token);
  const remainingTime = getTokenRemainingTime(token);
  const formattedTime = formatRemainingTime(remainingTime);
  const needsRefresh = shouldRefreshToken();
  
  return {
    needsRefresh,
    isExpired,
    remainingTime,
    formattedTime,
    valid: !isExpired,
    reason: needsRefresh ? (isExpired ? 'Token已过期' : 'Token将在24小时内过期') : 'Token仍然有效'
  };
}

module.exports = {
  config,
  getApiKey,
  getQwenToken,
  getCookie,
  isServerMode,
  isDebugMode,
  getServerPort,
  getVisionFallbackModel,
  parseJwtToken,
  isTokenExpired,
  getTokenExpiryTime,
  getTokenRemainingTime,
  formatRemainingTime,
  reloadConfig,
  shouldRefreshToken,
  getTokenRefreshInfo,
  // 向后兼容的别名
  getSalt: getApiKey,
  isServerEnv: isServerMode,
  isDebug: isDebugMode,
  getPort: getServerPort,
};


