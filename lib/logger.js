// 简易日志模块：集中日志行为，便于统一替换与级别控制
const { config } = require('./config');

function timestamp() { return new Date().toISOString(); }

const logger = {
  info(message, data) {
    console.log(`[${timestamp()}] 信息: ${message}`, data || '');
  },
  error(message, error, data) {
    const payload = {
      error: error?.message || error,
      stack: error?.stack,
      ...(data || {})
    };
    console.error(`[${timestamp()}] 错误: ${message}`, payload);
  },
  debug(message, data) {
    if (!config.DEBUG) return;
    console.log(`[${timestamp()}] 调试: ${message}`, data || '');
  }
};

module.exports = { logger };


