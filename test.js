const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getServerPort, getApiKey } = require('./lib/config');

const BASE_URL = `http://localhost:${getServerPort()}`;
const apiKey = getApiKey();
const AUTH_HEADER = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

function log(title, payload) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${title}`, payload !== undefined ? payload : '');
}

async function testHealth() {
  log('测试 /health 开始');
  const res = await axios.get(`${BASE_URL}/health`, { timeout: 15000 });
  if (res.status !== 200) throw new Error(`/health 状态码异常: ${res.status}`);
  log('测试 /health 通过', res.data);
}

async function testModels() {
  log('测试 /v1/models 开始');
  const res = await axios.get(`${BASE_URL}/v1/models`, { headers: AUTH_HEADER, timeout: 20000 });
  if (res.status !== 200) throw new Error(`/v1/models 状态码异常: ${res.status}`);
  const list = res.data?.data || [];
  log('测试 /v1/models 通过，模型数量', list.length);
}

async function testChatStream() {
  log('测试 /v1/chat/completions (SSE-文本) 开始');
  const body = {
    model: 'qwen3-max',
    stream: true,
    messages: [
      { role: 'user', content: '你好，请用一两句话介绍一下你自己。' }
    ]
  };

  const res = await axios.post(`${BASE_URL}/v1/chat/completions`, body, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', ...AUTH_HEADER },
    responseType: 'stream',
    timeout: 60000
  });

  return new Promise((resolve, reject) => {
    let chunkCount = 0;
    let done = false;

    res.data.on('data', (buf) => {
      const text = buf.toString('utf-8');
      const lines = text.split(/\n/).filter(Boolean);
      for (const line of lines) {
        if (line.trim() === 'data: [DONE]') {
          log('聊天流接收完成 [DONE]');
          done = true;
          res.data.destroy();
          resolve();
          return;
        }
        if (line.startsWith('data: ')) {
          const payload = line.slice(6);
          chunkCount += 1;
          log(`SSE 块 ${chunkCount}`, payload.slice(0, 200));
        }
      }
    });

    res.data.on('error', (err) => {
      if (!done) reject(err);
    });

    res.data.on('end', () => {
      if (!done) {
        log('聊天流结束(未收到 [DONE])，仍视为通过');
        resolve();
      }
    });
  });
}

async function testChatWithImage() {
  log('测试 /v1/chat/completions (SSE-图片) 开始');

  // 读取当前目录中的图片：alert (2).jpg
  const imagePath = path.join(__dirname, 'alert (2).jpg');
  if (!fs.existsSync(imagePath)) {
    throw new Error(`未找到图片文件: ${imagePath}`);
  }
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString('base64');
  const mimeType = 'image/jpeg'; // 文件名是 .jpg
  const dataUrl = `data:${mimeType};base64,${base64}`;

  // 视觉对话：模型仍使用 qwen3-max（非 -image 后缀），消息里携带图片
  const body = {
    model: 'qwen3-max',
    stream: true,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '请描述这张图片的内容，并指出主要元素。' },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  };

  const res = await axios.post(`${BASE_URL}/v1/chat/completions`, body, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'X-API-Key': apiKey || '', ...AUTH_HEADER },
    responseType: 'stream',
    timeout: 120000
  });

  return new Promise((resolve, reject) => {
    let chunkCount = 0;
    let done = false;

    res.data.on('data', (buf) => {
      const text = buf.toString('utf-8');
      const lines = text.split(/\n/).filter(Boolean);
      for (const line of lines) {
        if (line.trim() === 'data: [DONE]') {
          log('图片对话流接收完成 [DONE]');
          done = true;
          res.data.destroy();
          resolve();
          return;
        }
        if (line.startsWith('data: ')) {
          const payload = line.slice(6);
          chunkCount += 1;
          log(`SSE(IMG) 块 ${chunkCount}`, payload.slice(0, 200));
        }
      }
    });

    res.data.on('error', (err) => {
      if (!done) reject(err);
    });

    res.data.on('end', () => {
      if (!done) {
        log('图片对话流结束(未收到 [DONE])，仍视为通过');
        resolve();
      }
    });
  });
}

async function testChatWithRemoteImageUrl() {
  log('测试 /v1/chat/completions (SSE-远程图片URL) 开始');

  const body = {
    model: 'qwen3-max',
    stream: true,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '描述这张图片的内容' },
          { type: 'image_url', image_url: { url: 'https://www.baidu.com/img/flexible/logo/pc/result@2.png' } }
        ]
      }
    ]
  };

  const res = await axios.post(`${BASE_URL}/v1/chat/completions`, body, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'X-API-Key': apiKey || '', ...AUTH_HEADER },
    responseType: 'stream',
    timeout: 120000
  });

  return new Promise((resolve, reject) => {
    let chunkCount = 0;
    let done = false;

    res.data.on('data', (buf) => {
      const text = buf.toString('utf-8');
      const lines = text.split(/\n/).filter(Boolean);
      for (const line of lines) {
        if (line.trim() === 'data: [DONE]') {
          log('远程图片对话流接收完成 [DONE]');
          done = true;
          res.data.destroy();
          resolve();
          return;
        }
        if (line.startsWith('data: ')) {
          const payload = line.slice(6);
          chunkCount += 1;
          log(`SSE(REMOTE_IMG) 块 ${chunkCount}`, payload.slice(0, 200));
        }
      }
    });

    res.data.on('error', (err) => {
      if (!done) reject(err);
    });

    res.data.on('end', () => {
      if (!done) {
        log('远程图片对话流结束(未收到 [DONE])，仍视为通过');
        resolve();
      }
    });
  });
}

async function testChatNonStream() {
  log('测试 /v1/chat/completions (非流) 开始');
  const body = {
    model: 'qwen3-max',
    stream: false,
    messages: [
      { role: 'user', content: '请用一句话介绍杭州。' }
    ]
  };
  const res = await axios.post(`${BASE_URL}/v1/chat/completions`, body, {
    headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
    timeout: 30000
  });
  if (res.status !== 200) throw new Error(`/v1/chat/completions 非流 状态码异常: ${res.status}`);
  const content = res.data?.choices?.[0]?.message?.content;
  if (!content) {
    log('非流响应内容为空，完整返回体', res.data);
  } else {
    log('测试 /v1/chat/completions (非流) 通过', content.slice(0, 120));
  }
}

async function runAll() {
  try {
    log('开始测试', { baseURL: BASE_URL, hasApiKey: !!apiKey });
    await testHealth();
    await testModels();
    await testChatStream();
    await testChatNonStream();
    await testChatWithRemoteImageUrl();
    await testChatWithImage();
    log('全部测试通过 ✅');
    process.exit(0);
  } catch (e) {
    console.error('测试失败 ❌', e?.message || e);
    if (e?.code === 'ECONNREFUSED') {
      console.error(`无法连接到服务 ${BASE_URL}，请先运行: npm run start`);
    }
    process.exit(1);
  }
}

runAll();