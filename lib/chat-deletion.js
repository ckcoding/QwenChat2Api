// 聊天记录删除模块
const { http } = require('./http');
const { logger } = require('./logger');
const { buildBrowserLikeHeaders } = require('./headers');
const { getQwenToken, getCookie } = require('./config');

const QWEN_CHAT_LIST_URL = 'https://chat.qwen.ai/api/v2/chats';

/**
 * 删除指定的聊天记录
 * @param {string} chatId - 聊天ID
 * @param {string} token - 认证token
 * @returns {Promise<boolean>} - 删除是否成功
 */
async function deleteChat(chatId, token) {
  try {
    const url = `${QWEN_CHAT_LIST_URL}/${chatId}`;
    const headers = buildBrowserLikeHeaders(token);
    const cookie = getCookie();
    if (cookie) headers['Cookie'] = cookie;
    
    logger.info('正在删除聊天记录', { chatId });
    const response = await http.delete(url, { headers });
    
    if (response.status === 200 || response.status === 204) {
      logger.info('✓ 成功删除聊天记录', { chatId });
      return true;
    } else {
      logger.error('✗ 删除失败', { chatId, status: response.status, data: response.data });
      return false;
    }
  } catch (error) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    logger.error('✗ 删除聊天记录时发生异常', { 
      chatId, 
      error: error.message, 
      status, 
      dataPreview: typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data || {}).slice(0, 300) 
    });
    return false;
  }
}

/**
 * 查询第2页的聊天记录并删除
 * @param {number} intervalMinutes - 执行间隔（分钟），默认10分钟
 */
async function deleteChatsFromPage2() {
  try {
    const token = getQwenToken();
    if (!token) {
      logger.warn('无法执行删除任务：QWEN_TOKEN 未设置');
      return;
    }
    
    const cookie = getCookie();
    if (!cookie) {
      logger.warn('无法执行删除任务：Cookie 未设置');
      return;
    }
    
    logger.info('开始执行定时删除任务：查询第2页聊天记录...');
    const url = `${QWEN_CHAT_LIST_URL}/?page=2`;
    const headers = buildBrowserLikeHeaders(token);
    
    try {
      const response = await http.get(url, { headers, timeout: 10000 });
      
      if (response.status !== 200) {
        logger.error('查询聊天记录失败', { status: response.status, data: response.data });
        return;
      }
      
      const contentType = (response.headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        logger.error('返回的 Content-Type 异常', { 
          contentType, 
          preview: response.data?.toString?.()?.slice(0, 500) 
        });
        return;
      }
      
      const data = response.data;
      if (!data || !data.success || !Array.isArray(data.data)) {
        logger.info('没有更多聊天记录可删除', { 
          success: data?.success, 
          hasData: !!data?.data 
        });
        return;
      }
      
      const chatIds = data.data.map(item => item?.id).filter(Boolean);
      if (chatIds.length === 0) {
        logger.info('第2页没有聊天记录可删除');
        return;
      }
      
      logger.info(`获取到 ${chatIds.length} 个聊天ID，开始删除...`);
      let successCount = 0;
      let failCount = 0;
      
      for (const chatId of chatIds) {
        if (await deleteChat(chatId, token)) {
          successCount++;
        } else {
          failCount++;
        }
      }
      
      logger.info(`删除任务完成: 成功 ${successCount} 个, 失败 ${failCount} 个`);
    } catch (error) {
      const status = error?.response?.status;
      const data = error?.response?.data;
      logger.error('查询聊天记录时发生异常', { 
        error: error.message, 
        status, 
        dataPreview: typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data || {}).slice(0, 500) 
      });
    }
  } catch (error) {
    logger.error('执行删除任务时发生错误', error);
  }
}

/**
 * 启动定时删除任务
 * @param {number} intervalMinutes - 执行间隔（分钟），默认10分钟
 * @returns {NodeJS.Timeout} - 定时器ID
 */
function startChatDeletionScheduler(intervalMinutes = 10) {
  const TIME_INTERVAL = intervalMinutes * 60 * 1000;
  
  // 立即执行一次
  deleteChatsFromPage2();
  
  // 然后定时执行
  const intervalId = setInterval(() => {
    deleteChatsFromPage2();
  }, TIME_INTERVAL);
  
  logger.info(`定时删除任务已启动：每${intervalMinutes}分钟执行一次`);
  
  return intervalId;
}

module.exports = {
  deleteChat,
  deleteChatsFromPage2,
  startChatDeletionScheduler
};

