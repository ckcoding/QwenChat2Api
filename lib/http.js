// HTTP 封装：统一 axios 实例、请求/响应拦截与错误处理
const axios = require('axios');
const { logger } = require('./logger');

// 创建基础实例
const http = axios.create({
  timeout: 60000,
  // 注意：流式请求需单独设置 responseType
});

// 请求拦截：记录关键信息（避免打印敏感Token）
http.interceptors.request.use((config) => {
  const headers = { ...config.headers };
  if (headers.Authorization) headers.Authorization = headers.Authorization.slice(0, 10) + '...';
  logger.debug('HTTP 请求', { method: config.method, url: config.url, headers });
  return config;
});

// 响应拦截：统一错误处理与日志
http.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    logger.error('HTTP 响应错误', error, { status, dataPreview: typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data || {}).slice(0, 500) });
    return Promise.reject(error);
  }
);

module.exports = { http };


