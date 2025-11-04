// Token刷新模块：自动获取新的通义千问token
const { http } = require('./http');
const { logger } = require('./logger');
const { 
  readConfigFile, 
  updateConfigFile, 
  getCookie, 
  getToken, 
  isEnvMode 
} = require('./config-loader');

// 刷新token的API端点
const AUTH_REFRESH_URL = 'https://chat.qwen.ai/api/v1/auths/';

// 更新配置文件中的token和cookie文件
function updateConfig(newToken, newCookie) {
  const { configUpdated, cookieUpdated } = updateConfigFile(newToken, newCookie);
  logger.info('配置文件已更新', { 
    tokenUpdated: configUpdated, 
    cookieUpdated: cookieUpdated
  });
  return configUpdated || cookieUpdated;
}

// 从cookie获取token的主要函数
async function getTokenFromCookie() {
  try {
    logger.info('开始从cookie获取token...');
    
    // 使用统一的配置加载器获取cookie
    const cookie = getCookie();
    
    if (!cookie) {
      logger.error('Cookie为空或未设置');
      return { success: false, error: 'Cookie为空或未设置' };
    }
    
    // 构建请求头，模拟浏览器请求
    const headers = {
      "accept": "*/*",
      "accept-language": "zh,zh-CN;q=0.9,zh-TW;q=0.8,en-US;q=0.7,en;q=0.6",
      "bx-v": "2.5.31",
      "cache-control": "no-cache",
      "content-type": "application/json; charset=UTF-8",
      "pragma": "no-cache",
      "sec-ch-ua": '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "source": "web",
      "timezone": new Date().toISOString(),
      "x-request-id": require('crypto').randomUUID(),
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "cookie": cookie
    };
    
    // 发送请求
    const response = await http.get(AUTH_REFRESH_URL, { headers });
    
    if (response.status === 200 && response.data) {
      const data = response.data;
      
      // 提取token
      let newToken = null;
      
      // 从响应中提取token（通常在data.token或data.access_token字段）
      if (data.token) {
        newToken = data.token;
      } else if (data.access_token) {
        newToken = data.access_token;
      } else if (data.data && data.data.token) {
        newToken = data.data.token;
      }
      
      if (newToken) {
        // 如果使用环境变量模式，只更新内存中的配置，不写入文件
        if (isEnvMode()) {
          logger.info('Token获取成功（环境变量模式，仅更新内存）', { 
            newTokenLength: newToken.length
          });
          // 通知调用者需要更新环境变量
          return { success: true, newToken, envMode: true };
        }
        
        // 更新配置文件中的token
        const success = updateConfig(newToken, null);
        if (success) {
          logger.info('Token获取成功', { 
            newTokenLength: newToken.length
          });
          return { success: true, newToken };
        } else {
          logger.error('Token获取失败：无法更新配置文件');
          return { success: false, error: '配置文件更新失败' };
        }
      } else {
        logger.error('Token获取失败：响应中未找到token', { responseData: data });
        return { success: false, error: '响应中未找到token' };
      }
    } else {
      logger.error('Token获取失败：HTTP请求失败', { 
        status: response.status, 
        data: response.data 
      });
      return { success: false, error: `HTTP请求失败: ${response.status}` };
    }
  } catch (error) {
    logger.error('Token获取过程中发生错误', error);
    return { success: false, error: error.message };
  }
}

// 刷新token的主要函数（保持向后兼容）
async function refreshToken() {
  return await getTokenFromCookie();
}

// 检查token是否需要刷新（基于过期时间）
function shouldRefreshToken(token) {
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(token, { complete: true });
    
    if (!decoded || !decoded.payload || !decoded.payload.exp) {
      return true; // 无法解析，需要刷新
    }
    
    const currentTime = Math.floor(Date.now() / 1000);
    const expiryTime = decoded.payload.exp;
    const timeUntilExpiry = expiryTime - currentTime;
    
    // 如果token在24小时内过期，则需要刷新
    const oneDayInSeconds = 24 * 60 * 60;
    return timeUntilExpiry < oneDayInSeconds;
  } catch (error) {
    logger.error('检查token过期时间失败', error);
    return true; // 出错时也刷新
  }
}

// 定时刷新token（每天检查一次）
function startTokenRefreshScheduler() {
  // 立即检查一次
  checkAndRefreshToken();
  
  // 从配置读取刷新间隔（优先环境变量，其次配置文件）
  const intervalHours = Number(
    process.env.TOKEN_REFRESH_INTERVAL_HOURS || 
    readConfigFile()?.TOKEN_REFRESH_INTERVAL_HOURS || 
    24
  );
  const interval = intervalHours * 60 * 60 * 1000; // 转换为毫秒
  
  setInterval(checkAndRefreshToken, interval);
  
  logger.info('Token自动刷新调度器已启动', { 
    checkInterval: `${intervalHours}小时`,
    nextCheck: new Date(Date.now() + interval).toISOString()
  });
}

// 检查并刷新token
async function checkAndRefreshToken() {
  try {
    // 使用统一的配置加载器获取token
    const token = getToken();
    
    if (!token) {
      logger.warn('没有找到QWEN_TOKEN，跳过刷新检查');
      return;
    }
    
    const shouldRefresh = shouldRefreshToken(token);
    if (shouldRefresh) {
      logger.info('检测到token需要刷新，开始刷新...');
      const result = await refreshToken();
      if (result.success) {
        if (result.envMode) {
          logger.warn('Token已刷新，但环境变量模式下需要手动更新 QWEN_TOKEN 环境变量');
        } else {
          logger.info('Token自动刷新完成');
        }
      } else {
        logger.error('Token自动刷新失败', { error: result.error });
      }
    } else {
      logger.info('Token仍然有效，跳过刷新');
    }
  } catch (error) {
    logger.error('检查token刷新时发生错误', error);
  }
}

module.exports = {
  getTokenFromCookie,
  refreshToken,
  shouldRefreshToken,
  startTokenRefreshScheduler,
  checkAndRefreshToken,
  updateConfig
};
