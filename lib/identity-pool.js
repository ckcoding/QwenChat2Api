// 身份池模块：管理多个 Cookie/Token 组合，实现负载均衡和故障转移
const { randomUUID } = require('crypto');
const { getCookies, isTokenExpired, getTokenExpiryTime, getTokenRemainingTime } = require('./config');
const { getTokenFromCookie } = require('./token-refresh');
const { logger } = require('./logger');

// 身份状态
const IDENTITY_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  DOWN: 'down'
};

// 身份对象
class Identity {
  constructor(id, cookie) {
    this.id = id;
    this.cookie = cookie;
    this.token = null;
    this.tokenExp = null; // 过期时间（毫秒时间戳）
    this.status = IDENTITY_STATUS.HEALTHY;
    this.failCount = 0;
    this.lastUsedAt = null;
    this.nextRetryAt = null; // 熔断恢复时间
    this.lastError = null;
  }

  // 检查是否可用
  isAvailable() {
    if (this.status === IDENTITY_STATUS.DOWN) {
      return false;
    }
    if (this.nextRetryAt && Date.now() < this.nextRetryAt) {
      return false; // 仍在熔断期
    }
    if (!this.token || isTokenExpired(this.token)) {
      return false;
    }
    return true;
  }

  // 标记失败
  markFailure(error = null) {
    this.failCount++;
    this.lastError = error;
    
    // 根据失败次数调整状态
    if (this.failCount >= 5) {
      this.status = IDENTITY_STATUS.DOWN;
      this.nextRetryAt = Date.now() + 5 * 60 * 1000; // 5分钟后重试
    } else if (this.failCount >= 3) {
      this.status = IDENTITY_STATUS.DEGRADED;
      this.nextRetryAt = Date.now() + 2 * 60 * 1000; // 2分钟后重试
    }
    
    logger.warn(`身份 ${this.id} 标记失败`, { 
      failCount: this.failCount, 
      status: this.status,
      error: error?.message || error
    });
  }

  // 标记成功
  markSuccess() {
    if (this.failCount > 0) {
      this.failCount = Math.max(0, this.failCount - 1); // 成功时减少失败计数
    }
    if (this.status !== IDENTITY_STATUS.HEALTHY && this.isAvailable()) {
      this.status = IDENTITY_STATUS.HEALTHY;
      this.nextRetryAt = null;
      logger.info(`身份 ${this.id} 恢复健康`, { status: this.status });
    }
    this.lastUsedAt = Date.now();
  }

  // 更新 token
  updateToken(token) {
    this.token = token;
    this.tokenExp = getTokenExpiryTime(token);
    if (!this.tokenExp) {
      logger.warn(`身份 ${this.id} token 无法解析过期时间`);
    }
  }
}

// 身份池管理类
class IdentityPool {
  constructor() {
    this.identities = [];
    this.currentIndex = 0; // 轮询索引
    this.initialized = false;
  }

  // 初始化身份池
  async initialize() {
    if (this.initialized) {
      return;
    }

    logger.info('开始初始化身份池...');
    const cookies = getCookies();

    if (cookies.length === 0) {
      logger.warn('未找到任何 Cookie，身份池将为空');
      this.initialized = true;
      return;
    }

    logger.info(`发现 ${cookies.length} 个 Cookie，开始获取对应的 Token...`);

    // 为每个 Cookie 创建身份并获取 Token
    const initPromises = cookies.map(async (cookie, index) => {
      const id = `identity-${index + 1}`;
      const identity = new Identity(id, cookie);

      try {
        logger.info(`正在为 ${id} 获取 Token...`);
        const result = await getTokenFromCookie(cookie);

        if (result.success && result.newToken) {
          identity.updateToken(result.newToken);
          logger.info(`${id} Token 获取成功`, {
            tokenLength: result.newToken.length,
            expiresAt: identity.tokenExp ? new Date(identity.tokenExp).toISOString() : 'unknown'
          });
        } else {
          identity.status = IDENTITY_STATUS.DEGRADED;
          identity.markFailure(result.error || 'Token获取失败');
          logger.error(`${id} Token 获取失败`, { error: result.error });
        }
      } catch (error) {
        identity.status = IDENTITY_STATUS.DEGRADED;
        identity.markFailure(error);
        logger.error(`${id} 初始化失败`, error);
      }

      return identity;
    });

    this.identities = await Promise.all(initPromises);
    
    const healthyCount = this.identities.filter(id => id.isAvailable()).length;
    logger.info(`身份池初始化完成`, {
      total: this.identities.length,
      healthy: healthyCount,
      degraded: this.identities.filter(id => id.status === IDENTITY_STATUS.DEGRADED).length,
      down: this.identities.filter(id => id.status === IDENTITY_STATUS.DOWN).length
    });

    this.initialized = true;
  }

  // 获取可用的身份（轮询策略）
  getAvailableIdentity() {
    if (this.identities.length === 0) {
      return null;
    }

    // 过滤出可用的身份
    const availableIdentities = this.identities.filter(id => id.isAvailable());

    if (availableIdentities.length === 0) {
      // 如果没有可用身份，尝试使用所有身份（包括熔断的）
      const allIdentities = this.identities.filter(id => id.token);
      if (allIdentities.length === 0) {
        return null;
      }
      logger.warn('所有身份都不可用，使用降级身份');
      return allIdentities[this.currentIndex % allIdentities.length];
    }

    // 轮询选择
    const selected = availableIdentities[this.currentIndex % availableIdentities.length];
    this.currentIndex = (this.currentIndex + 1) % availableIdentities.length;

    return selected;
  }

  // 标记身份失败
  markIdentityFailure(identity, error = null) {
    if (!identity) return;
    if (typeof identity.markFailure === 'function') {
      identity.markFailure(error);
    } else {
      // 兼容非身份池对象（如 legacy 临时身份）
      logger.warn(`非池化身份标记失败(跳过方法调用)`, { id: identity.id || 'unknown', error: error?.message || error });
    }
  }

  // 标记身份成功
  markIdentitySuccess(identity) {
    if (!identity) return;
    if (typeof identity.markSuccess === 'function') {
      identity.markSuccess();
    } else {
      // 兼容非身份池对象（如 legacy 临时身份）
      logger.info(`非池化身份成功(跳过方法调用)`, { id: identity.id || 'unknown' });
    }
  }

  // 刷新指定身份的 Token
  async refreshIdentityToken(identity) {
    if (!identity) {
      return false;
    }

    try {
      logger.info(`刷新身份 ${identity.id} 的 Token...`);
      const result = await getTokenFromCookie(identity.cookie);

      if (result.success && result.newToken) {
        identity.updateToken(result.newToken);
        identity.markSuccess();
        logger.info(`身份 ${identity.id} Token 刷新成功`);
        return true;
      } else {
        identity.markFailure(result.error || 'Token刷新失败');
        logger.error(`身份 ${identity.id} Token 刷新失败`, { error: result.error });
        return false;
      }
    } catch (error) {
      identity.markFailure(error);
      logger.error(`刷新身份 ${identity.id} Token 时发生错误`, error);
      return false;
    }
  }

  // 检查并刷新所有需要刷新的 Token
  async refreshExpiredTokens() {
    const refreshPromises = this.identities.map(async (identity) => {
      // 检查是否需要刷新（24小时内过期或已过期）
      if (!identity.token || isTokenExpired(identity.token)) {
        return await this.refreshIdentityToken(identity);
      }

      const remainingTime = getTokenRemainingTime(identity.token);
      const oneDayInMs = 24 * 60 * 60 * 1000;

      if (remainingTime < oneDayInMs) {
        return await this.refreshIdentityToken(identity);
      }

      return false;
    });

    const results = await Promise.all(refreshPromises);
    const refreshedCount = results.filter(r => r === true).length;

    if (refreshedCount > 0) {
      logger.info(`刷新了 ${refreshedCount} 个身份的 Token`);
    }

    return refreshedCount;
  }

  // 获取池状态信息
  getPoolStatus() {
    const healthy = this.identities.filter(id => id.status === IDENTITY_STATUS.HEALTHY && id.isAvailable()).length;
    const degraded = this.identities.filter(id => id.status === IDENTITY_STATUS.DEGRADED).length;
    const down = this.identities.filter(id => id.status === IDENTITY_STATUS.DOWN).length;

    return {
      total: this.identities.length,
      healthy,
      degraded,
      down,
      initialized: this.initialized
    };
  }

  // 获取所有身份详情（用于调试）
  getAllIdentities() {
    return this.identities.map(id => ({
      id: id.id,
      status: id.status,
      failCount: id.failCount,
      hasToken: !!id.token,
      tokenExpired: id.token ? isTokenExpired(id.token) : true,
      lastUsedAt: id.lastUsedAt ? new Date(id.lastUsedAt).toISOString() : null,
      nextRetryAt: id.nextRetryAt ? new Date(id.nextRetryAt).toISOString() : null
    }));
  }
}

// 创建全局单例
const identityPool = new IdentityPool();

module.exports = {
  identityPool,
  IDENTITY_STATUS,
  Identity
};

