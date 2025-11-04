// 配置加载器：统一处理环境变量和配置文件的读取
// 优先使用环境变量，其次使用配置文件，最后使用默认值
const fs = require('fs');
const path = require('path');

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

// 检查是否使用环境变量模式
function isEnvMode() {
  return !!(process.env.QWEN_TOKEN || process.env.API_KEY || process.env.COOKIE);
}

// 读取配置：优先使用环境变量，否则从文件读取
function loadConfig() {
  // 优先使用环境变量
  if (isEnvMode()) {
    return {
      API_KEY: process.env.API_KEY || '',
      QWEN_TOKEN: process.env.QWEN_TOKEN || '',
      SERVER_MODE: process.env.SERVER_MODE !== 'false',
      DEBUG_MODE: process.env.DEBUG_MODE === 'true',
      SERVER_PORT: Number(process.env.SERVER_PORT || process.env.PORT || 8000),
      VISION_FALLBACK_MODEL: process.env.VISION_FALLBACK_MODEL || 'qwen3-vl-plus',
      AUTO_REFRESH_TOKEN: process.env.AUTO_REFRESH_TOKEN !== 'false',
      TOKEN_REFRESH_INTERVAL_HOURS: Number(process.env.TOKEN_REFRESH_INTERVAL_HOURS || 24)
    };
  }
  
  // 从文件读取
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (error) {
    console.warn('读取配置文件失败，使用默认配置', error.message);
  }
  
  // 默认配置
  return {
    API_KEY: '',
    QWEN_TOKEN: '',
    SERVER_MODE: true,
    DEBUG_MODE: false,
    SERVER_PORT: 8000,
    VISION_FALLBACK_MODEL: 'qwen3-vl-plus',
    AUTO_REFRESH_TOKEN: true,
    TOKEN_REFRESH_INTERVAL_HOURS: 24
  };
}

// 读取 Cookie：优先使用环境变量
function loadCookie() {
  if (process.env.COOKIE) {
    return process.env.COOKIE.trim();
  }
  return safeReadFile(COOKIE_PATH);
}

// 读取配置文件（用于token刷新等场景）
function readConfigFile() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
    return null;
  } catch (error) {
    console.warn('读取配置文件失败', error.message);
    return null;
  }
}

// 更新配置文件中的token
function updateConfigFile(newToken, newCookie) {
  try {
    let configUpdated = false;
    let cookieUpdated = false;
    
    // 更新配置文件中的token
    if (newToken) {
      const config = readConfigFile();
      if (config) {
        config.QWEN_TOKEN = newToken;
        
        // 备份原配置文件
        const backupPath = CONFIG_PATH + '.backup.' + Date.now();
        fs.writeFileSync(backupPath, fs.readFileSync(CONFIG_PATH));
        
        // 写入新配置
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        configUpdated = true;
      }
    }
    
    // 更新cookie文件
    if (newCookie) {
      // 备份原cookie文件
      const cookieBackupPath = COOKIE_PATH + '.backup.' + Date.now();
      if (fs.existsSync(COOKIE_PATH)) {
        fs.writeFileSync(cookieBackupPath, fs.readFileSync(COOKIE_PATH));
      }
      
      // 写入新cookie
      fs.writeFileSync(COOKIE_PATH, newCookie);
      cookieUpdated = true;
    }
    
    return { configUpdated, cookieUpdated };
  } catch (error) {
    console.error('更新配置文件失败', error);
    return { configUpdated: false, cookieUpdated: false };
  }
}

// 重新加载配置（用于token刷新后）
function reloadConfig(currentConfig) {
  try {
    // 如果使用环境变量，则跳过文件重新加载
    if (isEnvMode()) {
      const newConfig = loadConfig();
      Object.assign(currentConfig, newConfig);
      return true;
    }
    
    // 从文件重新加载
    const newConfig = readConfigFile();
    if (newConfig) {
      Object.assign(currentConfig, newConfig);
      return true;
    }
    return false;
  } catch (error) {
    console.error('重新加载配置失败:', error);
    return false;
  }
}

// 获取token（优先环境变量，其次配置文件）
function getToken() {
  if (process.env.QWEN_TOKEN) {
    return process.env.QWEN_TOKEN;
  }
  const config = readConfigFile();
  return config?.QWEN_TOKEN || '';
}

// 获取cookie（优先环境变量，其次文件）
function getCookie() {
  return loadCookie();
}

module.exports = {
  loadConfig,
  loadCookie,
  readConfigFile,
  updateConfigFile,
  reloadConfig,
  getToken,
  getCookie,
  isEnvMode,
  CONFIG_PATH,
  COOKIE_PATH
};

