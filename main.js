const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { randomUUID } = require('crypto');
const { config, getApiKey, getQwenToken, getCookie, getCookies, isServerMode, isDebugMode, getServerPort, getVisionFallbackModel, isTokenExpired, getTokenRemainingTime, formatRemainingTime, reloadConfig, getTokenRefreshInfo } = require('./lib/config');
const { startTokenRefreshScheduler, checkAndRefreshToken, getTokenFromCookie } = require('./lib/token-refresh');
const { buildBrowserLikeHeaders } = require('./lib/headers');
const { setSseHeaders, createKeepAlive } = require('./lib/sse');
const { http } = require('./lib/http');
const { logger } = require('./lib/logger');
const { createQwenToOpenAIStreamTransformer, convertQwenResponseToOpenAI, collectOpenAICompletionFromSSE } = require('./lib/transformers');
const { startChatDeletionScheduler } = require('./lib/chat-deletion');
const { identityPool } = require('./lib/identity-pool');

// 日志由 lib/logger.js 统一管理

const QWEN_API_BASE_URL = 'https://chat.qwen.ai/api/v2/chat/completions';
const QWEN_CHAT_NEW_URL = 'https://chat.qwen.ai/api/v2/chats/new';

// 启动校验：检查基本配置
function validateConfig() {
  const warnings = [];
  if (!getQwenToken()) warnings.push('QWEN_TOKEN 未设置，将尝试从Cookie获取');
  if (!getCookie()) warnings.push('Cookie文件不存在或未设置 COOKIE 环境变量，请设置 Cookie 以便自动获取 Token');
  
  if (warnings.length) {
    warnings.forEach(w => console.log('⚠️ ', w));
  }
}

// Token过期时间检测和警告
function checkTokenExpiry() {
  const token = getQwenToken();
  if (!token) return;
  
  const isExpired = isTokenExpired(token);
  const remainingTime = getTokenRemainingTime(token);
  const formattedTime = formatRemainingTime(remainingTime);
  
  if (isExpired) {
    console.log('⚠️  WARNING: QWEN_TOKEN 已过期！');
    console.log('   请更新配置文件中的 QWEN_TOKEN');
  } else {
    const remainingDays = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
    if (remainingDays <= 7) {
      console.log(`⚠️  WARNING: QWEN_TOKEN 将在 ${formattedTime} 后过期`);
      console.log('   建议提前更新配置文件中的 QWEN_TOKEN');
    } else {
      console.log(`✅ QWEN_TOKEN 有效，剩余时间: ${formattedTime}`);
    }
  }
}
// 启动时自动从cookie获取token
async function initializeToken() {
  try {
    // 检查是否已有有效token
    const currentToken = getQwenToken();
    if (currentToken && !isTokenExpired(currentToken)) {
      logger.info('使用现有有效token');
      return;
    }
    
    // 检查cookie文件是否存在
    const cookie = getCookie();
    if (!cookie) {
      logger.info('Cookie文件不存在或未设置 COOKIE 环境变量，请设置 Cookie 以便自动获取 Token');
      if (!currentToken) {
        logger.error('没有可用的token和cookie，服务无法启动');
        process.exit(1);
      }
      return;
    }
    
    // 尝试从cookie获取新token
    logger.info('检测到Cookie，尝试获取token...');
    const result = await getTokenFromCookie();
    
    if (result.success) {
      // 如果是环境变量模式，直接更新内存中的配置
      if (result.envMode && result.newToken) {
        config.QWEN_TOKEN = result.newToken;
        logger.info('Token获取成功（环境变量模式，已更新内存配置）', { 
          newTokenLength: result.newToken.length 
        });
      } else {
        logger.info('Token获取成功，重新加载配置');
        reloadConfig();
      }
    } else {
      logger.info('从cookie获取token失败:', result.error);
      if (!currentToken) {
        logger.error('没有可用的token，服务可能无法正常工作');
        process.exit(1);
      }
    }
  } catch (error) {
    logger.error('初始化token时发生错误:', error);
    process.exit(1);
  }
}

// 工具函数：消息ID、图片检测
function generateMessageId() { return randomUUID(); }
function hasImagesInMessage(message) {
  if (!message || !Array.isArray(message.content)) return false;
  return message.content.some(item => (item.type === 'image_url' && item.image_url?.url) || (item.type === 'image' && item.image));
}

async function createNewChat(token, cookie, model, chatType) {
  try {
    logger.info('创建新聊天', { model, chatType });
    const requestId = randomUUID();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      'source': 'web',
      'x-request-id': requestId
    };
    if (cookie) headers['Cookie'] = cookie;
    const res = await http.post(QWEN_CHAT_NEW_URL, {
      title: 'New Chat', models: [model], chat_mode: 'normal', chat_type: chatType, timestamp: Date.now()
    }, { headers });
    const chatId = res.data?.data?.id || null;
    if (!chatId) logger.error('响应中没有聊天ID', res.data);
    return chatId;
  } catch (e) {
    const status = e?.response?.status;
    const data = e?.response?.data;
    logger.error('创建新聊天时出错', e, { status, dataPreview: typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data || {}).slice(0, 300) });
    return null;
  }
}

function calculateAspectRatio(size) {
  const [w, h] = String(size).split('x').map(Number);
  if (!w || !h) return '1:1';
  const gcd = (a,b)=> b===0?a:gcd(b,a%b);
  const d = gcd(w,h);
  return `${w/d}:${h/d}`;
}

function validateQwenRequest(request) {
  try {
    if (!request.chat_id || !request.messages || !Array.isArray(request.messages)) return false;
    for (const m of request.messages) {
      if (!m.fid || !m.role || m.content === undefined) return false;
      if (m.role === 'user') {
        if (!m.user_action || !m.timestamp || !m.models) return false;
      }
    }
    return true;
  } catch (_) { return false; }
}

async function processImageUpload(imageUrl, authToken, cookie) {
  // 兼容 main.ts：暂时不上传OSS，直接回传原始URL
  let filename = `image_${Date.now()}.png`;
  let mimeType = 'image/png';
  if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image/')) {
    const mimeMatch = imageUrl.match(/data:image\/([^;]+)/);
    if (mimeMatch) { mimeType = `image/${mimeMatch[1]}`; filename = `image_${Date.now()}.${mimeMatch[1]}`; }
  } else if (typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
    const urlMatch = imageUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i);
    if (urlMatch) { const ext = urlMatch[1].toLowerCase(); mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`; filename = `image_${Date.now()}.${ext}`; }
  }
  return {
    type: 'image',
    file: { created_at: Date.now(), data: {}, filename, hash: null, id: randomUUID(), user_id: 'system', meta: { name: filename, size: 0, content_type: mimeType }, update_at: Date.now() },
    id: randomUUID(),
    url: imageUrl,
    name: filename,
    collection_name: '',
    progress: 0,
    status: 'uploaded',
    greenNet: 'success',
    size: 0,
    error: '',
    itemId: randomUUID(),
    file_type: mimeType,
    showType: 'image',
    file_class: 'vision',
    uploadTaskId: randomUUID()
  };
}

function extractImagesFromHistory(messages) {
  const images = [];
  for (const message of messages || []) {
    if (!message) continue;
    if (message.role === 'assistant' && typeof message.content === 'string') {
      const md = /!\[.*?\]\((.*?)\)/g; for (const m of message.content.matchAll(md)) { if (m[1]) images.push(m[1]); }
    }
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        const md = /!\[.*?\]\((.*?)\)/g; for (const m of message.content.matchAll(md)) { if (m[1]) images.push(m[1]); }
      } else if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (item.type === 'image_url' && item.image_url?.url) images.push(item.image_url.url);
          else if (item.type === 'image' && item.image) images.push(item.image);
        }
      }
    }
  }
  return images.slice(-3);
}

async function transformOpenAIRequestToQwen(openAIRequest, token, cookie, opts = {}) {
  if (!openAIRequest.messages || !Array.isArray(openAIRequest.messages)) throw new Error('无效请求：需要消息数组');
  if (openAIRequest.messages.length === 0) throw new Error('无效请求：消息数组不能为空');
  const model = openAIRequest.model || 'qwen-max';
  const wantStream = openAIRequest.stream !== false; // 默认流式，显式 false 则非流
  let chat_type = 't2t';
  const hasImages = openAIRequest.messages.some(msg => hasImagesInMessage(msg));
  if (model.endsWith('-image')) chat_type = 't2i';
  else if (model.endsWith('-image_edit')) chat_type = 'image_edit';
  else if (model.endsWith('-video')) chat_type = 't2v';
  else if (hasImages) { chat_type = 't2t'; }
  let qwenModel = model.replace(/-(search|thinking|image|image_edit|video)$/,'');
  let usedFallback = false;
  const disableVisionFallback = !!opts.disableVisionFallback;
  if (!disableVisionFallback && hasImages && !/(image|image_edit|video)$/.test(model) && config.VISION_FALLBACK_MODEL) {
    qwenModel = config.VISION_FALLBACK_MODEL;
    usedFallback = true;
    logger.info('检测到图片，已切换视觉回退模型', { fallback: qwenModel });
  }
  const chatId = await createNewChat(token, cookie, qwenModel, chat_type);
  if (!chatId) throw new Error('创建聊天会话失败');

  if (chat_type === 'image_edit') {
    const lastUserMessage = openAIRequest.messages.filter(m=>m.role==='user').pop();
    if (!lastUserMessage) throw new Error('未找到用于图片编辑的用户消息。');
    let textContent = '';
    const currentMessageImages = [];
    if (typeof lastUserMessage.content === 'string') textContent = lastUserMessage.content;
    else if (Array.isArray(lastUserMessage.content)) {
      for (const item of lastUserMessage.content) {
        if (item.type === 'text') textContent += (item.text || item.content || '');
        else if (item.type === 'image_url' && item.image_url?.url) currentMessageImages.push(item.image_url.url);
        else if (item.type === 'image' && item.image) currentMessageImages.push(item.image);
      }
    }
    const historyImages = extractImagesFromHistory(openAIRequest.messages.slice(0,-1));
    const allImages = [...currentMessageImages, ...historyImages];
    const imagesToUse = allImages.slice(-3);
    const files = [];
    if (imagesToUse.length > 0) {
      try { const imageToUpload = imagesToUse[imagesToUse.length - 1]; const uploadedFile = await processImageUpload(imageToUpload, token, cookie); files.push(uploadedFile); } catch(e){ logger.error('图片上传失败，切换到文本生图模式', e); }
    }
    const messageId = generateMessageId();
    const timestamp = Math.floor(Date.now()/1000);
    const actualChatType = files.length > 0 ? 'image_edit' : 't2i';
    const transformedRequest = {
      stream: wantStream,
      incremental_output: wantStream,
      chat_id: chatId,
      chat_mode: 'normal',
      model: qwenModel,
      parent_id: null,
      messages: [{
        fid: messageId,
        parentId: null,
        childrenIds: [],
        role: 'user',
        content: textContent || '生成一张图片',
        user_action: 'chat',
        files,
        timestamp,
        models: [qwenModel],
        chat_type: actualChatType,
        feature_config: { thinking_enabled: false, output_schema: 'phase' },
        extra: { meta: { subChatType: actualChatType } },
        sub_chat_type: actualChatType,
        parent_id: null
      }],
      timestamp
    };
    return { request: transformedRequest, chatId, usedFallback };
  }

  if (chat_type === 't2i') {
    const lastUserMessage = openAIRequest.messages.filter(m=>m.role==='user').pop();
    if (!lastUserMessage) throw new Error('未找到用于图片生成的用户消息。');
    const openAISize = openAIRequest.size || '1024x1024';
    const sizeMap = { '256x256':'1:1','512x512':'1:1','1024x1024':'1:1','1792x1024':'16:9','1024x1792':'9:16','2048x2048':'1:1','1152x768':'3:2','768x1152':'2:3' };
    const qwenSize = sizeMap[openAISize] || calculateAspectRatio(openAISize);
    let textContent='';
    if (typeof lastUserMessage.content === 'string') textContent = lastUserMessage.content;
    else if (Array.isArray(lastUserMessage.content)) {
      for (const item of lastUserMessage.content) if (item.type==='text') textContent += (item.text || item.content || '');
    }
    const messageId = generateMessageId();
    const timestamp = Math.floor(Date.now()/1000);
    const transformedRequest = {
      stream: wantStream,
      incremental_output: wantStream,
      chat_id: chatId,
      chat_mode: 'normal',
      model: qwenModel,
      parent_id: null,
      size: qwenSize,
      messages: [{
        fid: messageId,
        parentId: null,
        childrenIds: [],
        role: 'user',
        content: textContent || '生成一张图片',
        user_action: 'chat',
        files: [],
        timestamp,
        models: [qwenModel],
        chat_type: 't2i',
        feature_config: { thinking_enabled: false, output_schema: 'phase' },
        extra: { meta: { subChatType: 't2i' } },
        sub_chat_type: 't2i',
        parent_id: null
      }],
      timestamp
    };
    return { request: transformedRequest, chatId, usedFallback };
  }

  const timestamp = Math.floor(Date.now()/1000);
  const transformedMessages = await Promise.all((openAIRequest.messages||[]).map(async (msg, index) => {
    const messageId = generateMessageId();
    let files = [];
    let content = msg.content;
    let messageChatType = chat_type;
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const textParts = []; const imageUrls = [];
      for (const item of msg.content) {
        if (item.type==='text') textParts.push(item.text || item.content || '');
        else if (item.type==='image_url' && item.image_url?.url) imageUrls.push(item.image_url.url);
        else if (item.type==='image' && item.image) imageUrls.push(item.image);
      }
      if (imageUrls.length > 0) {
        try {
          for (const imageUrl of imageUrls) { const uploadedFile = await processImageUpload(imageUrl, token, cookie); files.push(uploadedFile); }
          if (files.length > 0) messageChatType = 't2t';
        } catch (e) { logger.error('图片上传失败，将跳过图片处理', e); }
      }
      content = textParts.join(' ');
    }
    return {
      fid: messageId,
      parentId: index > 0 ? null : null,
      childrenIds: [],
      role: msg.role,
      content,
      user_action: msg.role === 'user' ? 'chat' : undefined,
      files,
      timestamp,
      models: [model.replace(/-(search|thinking|image|image_edit|video)$/,'')],
      chat_type: messageChatType,
      feature_config: { thinking_enabled: model.includes('-thinking'), output_schema: 'phase' },
      extra: { meta: { subChatType: messageChatType } },
      sub_chat_type: messageChatType,
      parent_id: null
    };
  }));
  const transformedRequest = { stream: wantStream, incremental_output: wantStream, chat_id: chatId, chat_mode: 'normal', model: model.replace(/-(search|thinking|image|image_edit|video)$/,''), parent_id: null, messages: transformedMessages, timestamp };
  return { request: transformedRequest, chatId, usedFallback };
}

// 流式转换器由 lib/transformers.js 统一提供
// 删除聊天记录功能由 lib/chat-deletion.js 统一管理

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 认证中间件（支持服务器端与客户端两种模式）
// - 服务器端模式：只验 SALT，QWEN_TOKEN 从配置注入
// - 客户端模式：从 Authorization 解析 salt;qwen_token;cookie
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/health') return next();
  try {
    if (isServerMode()) {
      // 服务器端认证：只校验 API_KEY（若配置），并把 token 从 config 注入
      const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
      const apiKeyHeader = req.headers['x-api-key'] || '';
      const queryApiKey = (req.query && (req.query.api_key || req.query.key)) || '';
      const bodyApiKey = (req.body && typeof req.body === 'object' && (req.body.api_key || req.body.key)) || '';
      if (getApiKey()) {
        const bearer = String(authHeader).startsWith('Bearer ')
          ? String(authHeader).replace(/^Bearer\s+/i, '')
          : '';
        const candidate = String(bearer || apiKeyHeader || queryApiKey || bodyApiKey || '').trim();
        if (!candidate || candidate !== getApiKey()) {
          return res.status(401).json({ error: '身份验证失败', message: '无效的API密钥' });
        }
      }
      req.state = { qwenToken: config.QWEN_TOKEN, ssxmodItna: getCookie() };
      return next();
    } else {
      const authHeader = req.headers['authorization'];
      const clientToken = (authHeader || '').replace(/^Bearer\s+/i, '');
      if (!clientToken) {
        const expected = getApiKey() ? 'Bearer api_key;qwen_token;ssxmod_itna' : 'Bearer qwen_token;ssxmod_itna';
        return res.status(401).json({ error: '身份验证失败', message: '未提供认证令牌', format: expected, api_key_required: !!getApiKey() });
      }
      const parts = clientToken.split(';');
      let qwenToken, ssxmodItna;
      if (getApiKey()) {
        if (parts[0]?.trim() !== getApiKey()) return res.status(401).json({ error: '身份验证失败', message: '无效的API密钥' });
        qwenToken = parts[1]?.trim(); ssxmodItna = parts[2]?.trim() || '';
      } else { qwenToken = parts[0]?.trim(); ssxmodItna = parts[1]?.trim() || ''; }
      if (!qwenToken) return res.status(401).json({ error: '身份验证失败', message: '需要通义千问令牌' });
      req.state = { qwenToken, ssxmodItna };
      return next();
    }
  } catch (e) { logger.error('身份验证过程中发生错误', e); return res.status(500).json({ error: '内部服务器错误' }); }
});

app.get('/', (req, res) => {
  const apiKeyStatus = getApiKey() ? '🔒 受限访问模式' : '🎯 开放访问模式';
  const authMode = isServerMode() ? '服务器端认证 (配置文件)' : '客户端认证 (请求头)';
  const authFormat = isServerMode()
    ? (getApiKey() ? 'Authorization: Bearer your_api_key' : 'Authorization 可选')
    : (getApiKey() ? 'Authorization: Bearer api_key;qwen_token;ssxmod_itna_value' : 'Authorization: Bearer qwen_token;ssxmod_itna_value');
  res.set('Content-Type','text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>通义千问 API 代理</title><script src="https://cdn.tailwindcss.com"></script></head><body class="font-sans min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-indigo-500 to-purple-600"><div class="w-full max-w-lg rounded-2xl bg-white/95 p-10 text-center shadow-2xl backdrop-blur-md"><div class="mb-3 flex items-center justify-center gap-2"><div class="h-2 w-2 animate-pulse rounded-full bg-emerald-500"></div><div class="text-lg font-semibold text-gray-800">服务运行正常</div></div><div class="mb-8 text-sm leading-relaxed text-gray-500">欲买桂花同载酒，终不似，少年游</div><div class="mb-8 text-left"><div class="mb-4 text-base font-semibold text-gray-700">API 端点</div><div class="flex items-center justify-between border-b border-gray-100 py-3"><span class="text-sm text-gray-500">模型列表</span><code class="font-mono rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-800">/v1/models</code></div><div class="flex items-center justify-between py-3"><span class="text-sm text-gray-500">聊天完成</span><code class="font-mono rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-800">/v1/chat/completions</code></div></div><div class="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-left"><div class="mb-2 text-sm font-semibold text-gray-700">认证方式</div><div class="mb-1 text-xs font-medium text-emerald-600">${apiKeyStatus}</div><div class="mb-3 text-xs font-medium text-indigo-600">${authMode}</div><div class="font-mono break-all rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-[12px] leading-snug text-gray-600">${authFormat}</div></div><div class="text-xs font-medium text-gray-400"><span class="text-indigo-500">通义千问 API 代理 v3.11</span><br/><span class="text-gray-400 mt-1">🚀 支持最新API格式</span></div></div></body></html>`);
});

app.get('/v1/models', async (req, res) => {
  // 获取身份（优先使用身份池，否则使用传统方式）
  let identity = null;
  let token = req.state?.qwenToken;
  let ssx = req.state?.ssxmodItna || getCookie();
  
  if (identityPool.initialized) {
    identity = identityPool.getAvailableIdentity();
    if (identity) {
      token = identity.token;
      ssx = identity.cookie;
    }
  }
  
  if (!token) return res.status(401).json({ error: '身份验证失败。没有可用的通义千问令牌。' });
  try {
    const headers = buildBrowserLikeHeaders(token, { includeCookie: false });
    if (ssx) headers['Cookie'] = ssx;
    const rsp = await http.get('https://chat.qwen.ai/api/models', { headers });
    
    // 标记身份成功
    if (identity && identity.id !== 'legacy') {
      identityPool.markIdentitySuccess(identity);
    }
    const originalModels = rsp.data?.data || [];
    const processedModels = [];
    for (const model of originalModels) {
      processedModels.push(model);
      if (model?.info?.meta?.abilities?.thinking) processedModels.push({ ...model, id: `${model.id}-thinking` });
      if (model?.info?.meta?.chat_type?.includes('search')) processedModels.push({ ...model, id: `${model.id}-search` });
      if (model?.info?.meta?.chat_type?.includes('t2i')) { processedModels.push({ ...model, id: `${model.id}-image` }); processedModels.push({ ...model, id: `${model.id}-image_edit` }); }
      if (model?.info?.meta?.chat_type?.includes('image_edit')) { if (!processedModels.some(m => m.id === `${model.id}-image_edit`)) processedModels.push({ ...model, id: `${model.id}-image_edit` }); }
    }
    // 兜底：若上游为空，返回一组常用模型，避免前端不可用
    if (processedModels.length === 0) {
      const fallback = [
        { id: 'qwen3-max', object: 'model' },
        { id: 'qwen3-max-thinking', object: 'model' },
        { id: 'qwen3-max-image', object: 'model' },
        { id: 'qwen3-max-image_edit', object: 'model' },
        { id: 'qwen3-vl-plus', object: 'model' }
      ];
      return res.json({ object: 'list', data: fallback });
    }
    res.json({ object: 'list', data: processedModels });
  } catch (e) {
    // 标记身份失败
    if (identity && identity.id !== 'legacy') {
      identityPool.markIdentityFailure(identity, e);
    }
    logger.error('获取模型时出错', e);
    res.status(502).json({ error: '从上游API获取模型失败。', details: e.message });
  }
});

// 执行请求的辅助函数（支持重试）
async function executeQwenRequest(qwenRequest, identity, usedFallback, wantStream, requestId, req, res) {
  let apiUrl = QWEN_API_BASE_URL;
  const requestChatId = qwenRequest.chat_id;
  if (requestChatId) apiUrl = `${QWEN_API_BASE_URL}?chat_id=${requestChatId}`;
  
  const headers = {
    'Authorization': `Bearer ${identity.token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0',
    'source': 'web',
    'x-request-id': requestId,
    'accept': '*/*',
    'x-accel-buffering': 'no'
  };
  if (identity.cookie) headers['Cookie'] = identity.cookie;
  
  // 如使用视觉回退，补充更完整浏览器头以提升稳定性
  if (usedFallback) {
    headers['sec-ch-ua'] = '"Google Chrome";v="120", "Chromium";v="120", "Not=A?Brand";v="24"';
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"macOS"';
    headers['sec-fetch-dest'] = 'empty';
    headers['sec-fetch-mode'] = 'cors';
    headers['sec-fetch-site'] = 'same-origin';
    headers['referer'] = 'https://chat.qwen.ai/';
  }

  logger.info('将调用上游 API', {
    requestId,
    url: apiUrl,
    identityId: identity.id
  });

  if (wantStream) {
    // 流式：SSE 转发
    setSseHeaders(res, requestId);
    let cleanup = null;
    const { safeWriteDone, cleanup: cleanupFn } = createKeepAlive(res);
    cleanup = cleanupFn;
    
    try {
      const upstream = await http.post(apiUrl, qwenRequest, { headers, responseType: 'stream' });
      logger.info('上游响应就绪', { requestId, status: upstream.status, identityId: identity.id });
      
      // 检查状态码
      if (upstream.status >= 400) {
        identityPool.markIdentityFailure(identity, new Error(`HTTP ${upstream.status}`));
        throw new Error(`上游API返回错误: ${upstream.status}`);
      }
      
      // 标记成功
      identityPool.markIdentitySuccess(identity);
      
      const transformer = createQwenToOpenAIStreamTransformer();
      upstream.data.on('error', (e)=>{ 
        logger.error('上游流错误', e);
        identityPool.markIdentityFailure(identity, e);
      });
      transformer.on('error', (e)=>{ logger.error('转换器错误', e); });
      upstream.data.on('end', () => { logger.info('上游数据流 end', { requestId }); safeWriteDone(); });
      upstream.data.on('close', () => { logger.info('上游数据流 close', { requestId }); safeWriteDone(); });
      transformer.on('end', () => { logger.info('转换器 end', { requestId }); safeWriteDone(); });
      req.on('close', () => { try { upstream.data.destroy(); } catch (_) {} safeWriteDone(); });
      upstream.data.pipe(transformer).pipe(res, { end: false });
      res.on('close', () => { if (cleanup) cleanup(); logger.info('响应 close', { requestId }); });
      res.on('finish', () => { if (cleanup) cleanup(); logger.info('响应 finish', { requestId }); });
      return { success: true };
    } catch (upstreamError) {
      identityPool.markIdentityFailure(identity, upstreamError);
      
      // 如果上游请求失败，但响应头已发送，需要向客户端发送错误消息
      if (res.headersSent) {
        logger.error('上游请求失败，但响应头已发送，向客户端发送错误', { requestId, error: upstreamError.message });
        try {
          const errorMessage = `上游API请求失败: ${upstreamError.message}`;
          const errorChunk = {
            id: `chatcmpl-${randomUUID()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now()/1000),
            model: 'qwen-proxy',
            choices: [{ index: 0, delta: { content: errorMessage }, finish_reason: 'stop' }]
          };
          res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          if (cleanup) cleanup();
          res.end();
        } catch (e) {
          logger.error('发送错误消息失败', e);
          if (cleanup) cleanup();
          res.end();
        }
        return { success: false, error: upstreamError, retryable: false };
      }
      
      return { success: false, error: upstreamError, retryable: true };
    }
  } else {
    // 非流式：部分上游仍以 SSE 形式返回增量，因此这里优先尝试以流收集
    try {
      const upstream = await http.post(apiUrl, { ...qwenRequest, stream: true, incremental_output: true }, { headers, responseType: 'stream' });
      logger.info('上游非流式（转流聚合）响应就绪', { requestId, status: upstream.status, identityId: identity.id });
      
      // 检查状态码
      if (upstream.status >= 400) {
        identityPool.markIdentityFailure(identity, new Error(`HTTP ${upstream.status}`));
        throw new Error(`上游API返回错误: ${upstream.status}`);
      }
      
      // 标记成功
      identityPool.markIdentitySuccess(identity);
      
      const content = await collectOpenAICompletionFromSSE(upstream.data);
      const openaiJson = {
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now()/1000),
        model: 'qwen-proxy',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
      };
      return { success: true, data: openaiJson };
    } catch (error) {
      identityPool.markIdentityFailure(identity, error);
      return { success: false, error, retryable: true };
    }
  }
}

app.post('/v1/chat/completions', async (req, res) => {
  const requestId = randomUUID();
  
  // 获取身份（优先使用身份池，否则使用传统方式）
  let identity = null;
  let token = req.state?.qwenToken;
  let ssxmodItna = req.state?.ssxmodItna;
  
  // 如果身份池已初始化且有可用身份，使用身份池
  if (identityPool.initialized) {
    identity = identityPool.getAvailableIdentity();
    if (identity) {
      token = identity.token;
      ssxmodItna = identity.cookie;
      logger.info('使用身份池中的身份', { identityId: identity.id, requestId });
    }
  }
  
  // 如果没有身份或token，返回错误
  if (!token) {
    return res.status(401).json({ error: '身份验证失败。没有可用的通义千问令牌。' });
  }
  
  // 如果没有从身份池获取到身份，创建临时身份对象（用于兼容）
  if (!identity) {
    identity = { token, cookie: ssxmodItna || getCookie(), id: 'legacy' };
  }
  
  try {
    const openAIRequest = req.body || {};
    const wantStream = openAIRequest.stream !== false; // 默认流式
    
    // 提取提问信息（第一条用户消息）
    let userPrompt = '';
    if (Array.isArray(openAIRequest.messages)) {
      const firstUserMessage = openAIRequest.messages.find(m => m.role === 'user');
      if (firstUserMessage) {
        if (typeof firstUserMessage.content === 'string') {
          userPrompt = firstUserMessage.content;
        } else if (Array.isArray(firstUserMessage.content)) {
          const textParts = firstUserMessage.content
            .filter(item => item.type === 'text')
            .map(item => item.text || item.content || '');
          userPrompt = textParts.join(' ');
        }
        // 截断过长的提示词
        if (userPrompt.length > 200) {
          userPrompt = userPrompt.substring(0, 200) + '...';
        }
      }
    }
    
    const { request: qwenRequest, chatId, usedFallback } = await transformOpenAIRequestToQwen(openAIRequest, token, identity.cookie);
    logger.info('转换完成，准备请求上游', {
      chatId,
      usedFallback,
      model: qwenRequest?.model,
      messageCount: Array.isArray(qwenRequest?.messages) ? qwenRequest.messages.length : 0,
      chatType: qwenRequest?.messages?.[0]?.chat_type,
      identityId: identity.id,
      userPrompt: userPrompt || '(无文本提示)'
    });
    if (!validateQwenRequest(qwenRequest)) return res.status(400).json({ error: '请求格式转换失败' });
    
    // 执行请求（支持重试）
    let result = await executeQwenRequest(qwenRequest, identity, usedFallback, wantStream, requestId, req, res);
    
    // 如果失败且可重试，尝试使用其他身份
    if (!result.success && result.retryable && identityPool.initialized && identity.id !== 'legacy') {
      const maxRetries = 2; // 最多重试2次
      for (let retry = 0; retry < maxRetries; retry++) {
        const nextIdentity = identityPool.getAvailableIdentity();
        if (!nextIdentity || nextIdentity.id === identity.id) {
          break; // 没有其他可用身份
        }
        
        logger.info('尝试使用备用身份重试', { 
          requestId, 
          oldIdentityId: identity.id, 
          newIdentityId: nextIdentity.id,
          retry: retry + 1
        });
        
        // 重新创建聊天（使用新身份）
        const newChatId = await createNewChat(nextIdentity.token, nextIdentity.cookie, qwenRequest.model, qwenRequest.messages?.[0]?.chat_type || 't2t');
        if (newChatId) {
          qwenRequest.chat_id = newChatId;
        }
        
        identity = nextIdentity;
        result = await executeQwenRequest(qwenRequest, identity, usedFallback, wantStream, requestId, req, res);
        
        if (result.success) {
          break; // 重试成功
        }
      }
    }
    
    // 处理结果
    if (!result.success) {
      throw result.error;
    }
    
    // 非流式返回数据
    if (!wantStream && result.data) {
      res.json(result.data);
    }
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data;
    logger.error('聊天完成代理中的错误', e, { requestId, status, dataPreview: typeof data === 'string' ? data.slice(0, 500) : JSON.stringify(data || {}).slice(0, 500) });
    if (!res.headersSent) res.status(status).json({ error: '上游API请求失败', details: data || e.message, requestId });
  }
});

app.get('/health', (req, res) => {
  const tokenRefreshInfo = getTokenRefreshInfo();
  const poolStatus = identityPool.getPoolStatus();
  
  res.json({ 
    status: '正常', 
    timestamp: new Date().toISOString(), 
    version: '3.11', 
    config: { 
      apiKeyEnabled: !!getApiKey(), 
      serverMode: !!isServerMode(), 
      debugMode: !!isDebugMode(),
      autoRefreshToken: config.AUTO_REFRESH_TOKEN !== false
    },
    token: {
      valid: !tokenRefreshInfo.isExpired,
      expired: tokenRefreshInfo.isExpired,
      remainingTime: tokenRefreshInfo.remainingTime,
      formattedTime: tokenRefreshInfo.formattedTime,
      needsRefresh: tokenRefreshInfo.needsRefresh,
      reason: tokenRefreshInfo.reason
    },
    identityPool: poolStatus
  });
});

// 手动刷新token的API端点
app.post('/refresh-token', async (req, res) => {
  try {
    logger.info('收到手动刷新token请求');
    const result = await getTokenFromCookie();
    
    if (result.success) {
      // 如果是环境变量模式，直接更新内存中的配置
      if (result.envMode && result.newToken) {
        config.QWEN_TOKEN = result.newToken;
        logger.info('Token刷新成功（环境变量模式，已更新内存配置）', { 
          newTokenLength: result.newToken.length 
        });
      } else {
        // 更新配置文件
        reloadConfig();
        logger.info('Token刷新成功，已更新配置文件');
      }
      
      const newTokenInfo = getTokenRefreshInfo();
      
      res.json({
        success: true,
        message: 'Token刷新成功',
        timestamp: new Date().toISOString(),
        token: {
          valid: !newTokenInfo.isExpired,
          remainingTime: newTokenInfo.remainingTime,
          formattedTime: newTokenInfo.formattedTime
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Token刷新失败',
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('手动刷新token时发生错误', error);
    res.status(500).json({
      success: false,
      message: 'Token刷新过程中发生错误',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 启动服务器
function startServer() {
  const port = getServerPort();
app.listen(port, () => {
  console.log('='.repeat(80));
  console.log('🚀 启动通义千问 API 代理服务器 v3.11 (Node.js)');
  console.log('📋 配置状态:');
    console.log(`  🔑 QWEN_TOKEN: ${getQwenToken() ? '✅ 已配置' : '❌ 未配置'}`);
    console.log(`  🔐 API_KEY: ${getApiKey() ? '✅ 已配置' : '⚠️ 未配置 (开放模式)'}`);
    const cookies = getCookies();
    const cookieCount = cookies.length;
    console.log(`  🍪 Cookie文件: ${cookieCount > 0 ? `✅ 已配置 (${cookieCount}个)` : '⚠️ 未配置'}`);
    if (cookieCount > 1) {
      const poolStatus = identityPool.getPoolStatus();
      console.log(`  🔄 负载均衡: ✅ 启用 (${poolStatus.healthy}/${poolStatus.total} 可用)`);
    }
    console.log(`  🐛 调试模式: ${isDebugMode() ? '✅ 启用' : '❌ 禁用'}`);
    console.log(`  🔒 认证模式: ${isServerMode() ? '服务器端' : '客户端'}`);
    console.log(`  🔄 自动刷新: ${config.AUTO_REFRESH_TOKEN !== false ? '✅ 启用' : '❌ 禁用'}`);
    console.log(`  🗑️  定时删除: ${getQwenToken() ? '✅ 启用 (每1小时删除第2页聊天记录)' : '⚠️ 未启用 (需要 QWEN_TOKEN)'}`);
  console.log('\n🔌 API 端点:');
  console.log('  📋 GET  /v1/models - 获取模型列表');
  console.log('  💬 POST /v1/chat/completions - 聊天完成');
  console.log('  ❤️  GET  /health - 健康检查');
    console.log('  🔄 POST /refresh-token - 手动刷新token');
  console.log('  🏠 GET  / - 主页');
  console.log('🌐 访问地址: http://localhost:' + port);
  console.log('='.repeat(80));
});
}

// 修改初始化流程，在完成后启动服务器
async function initialize() {
  validateConfig();
  checkTokenExpiry();
  
  // 初始化身份池（优先）
  const cookies = getCookies();
  if (cookies.length > 1) {
    logger.info(`检测到 ${cookies.length} 个 Cookie，启用负载均衡模式`);
    await identityPool.initialize();
    
    // 启动身份池的token自动刷新调度器
    if (config.AUTO_REFRESH_TOKEN !== false) {
      const intervalHours = Number(
        process.env.TOKEN_REFRESH_INTERVAL_HOURS || 
        config.TOKEN_REFRESH_INTERVAL_HOURS || 
        24
      );
      const interval = intervalHours * 60 * 60 * 1000;
      
      setInterval(async () => {
        await identityPool.refreshExpiredTokens();
      }, interval);
      
      logger.info('身份池 Token 自动刷新调度器已启动', { 
        checkInterval: `${intervalHours}小时`
      });
    }
  } else {
    logger.info('使用传统单 Cookie 模式');
    // 自动获取token（传统模式）
    await initializeToken();
    
    // 启动token自动刷新调度器（传入config对象以便环境变量模式下更新内存）
    if (config.AUTO_REFRESH_TOKEN !== false) {
      startTokenRefreshScheduler(config);
    }
  }
  
  // 启动定时删除任务：每1小时删除一次第2页的聊天记录
  // 只在有 token 的情况下启动删除任务
  if (getQwenToken() || (identityPool.initialized && identityPool.getPoolStatus().healthy > 0)) {
    startChatDeletionScheduler(60); // 每60分钟执行一次
  } else {
    logger.warn('未配置 QWEN_TOKEN，跳过启动定时删除任务');
  }
  
  // 启动服务器
  startServer();
}

// 执行初始化
initialize();


