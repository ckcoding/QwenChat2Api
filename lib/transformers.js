// 转换器集合：将上游千问响应转换为 OpenAI 兼容格式（流/非流）
const { Transform } = require('stream');
const { randomUUID } = require('crypto');
const { logger } = require('./logger');

// 流式：qwen -> openai sse
function createQwenToOpenAIStreamTransformer() {
  const messageId = randomUUID();
  const sentImageUrls = new Set();
  let buffer = '';
  const MAX_BUFFER_SIZE = 100000; // 100KB

  return new Transform({
    readableObjectMode: false,
    writableObjectMode: false,
    transform(chunk, _enc, callback) {
      try {
        const raw = chunk.toString('utf-8');
        buffer += raw;
        if (buffer.length > MAX_BUFFER_SIZE) {
          logger.error(`检测到缓冲区溢出 (大小: ${buffer.length})，清空缓冲`);
          buffer = '';
          return callback();
        }
        if (buffer.includes('[DONE]')) {
          this.push(`data: [DONE]\n\n`);
          buffer = '';
          return callback();
        }
        let lines = [];
        if (buffer.includes('\n\n')) {
          lines = buffer.split('\n\n');
          buffer = lines.pop() || '';
        } else if (buffer.includes('\n')) {
          lines = buffer.split('\n');
          const lastLine = lines[lines.length - 1];
          if (lastLine && !lastLine.startsWith('data:')) {
            buffer = lines.pop() || '';
          } else {
            buffer = '';
          }
        }
        for (const line of lines) {
          if (!line || line.trim() === '') continue;
          let dataStr = line.startsWith('data:') ? line.replace(/^data:\s?/, '').trim() : line.trim();
          if (!dataStr) continue;
          if (dataStr === '[DONE]') { this.push(`data: [DONE]\n\n`); continue; }

          let content = '';
          let isFinished = false;
          try {
            const q = JSON.parse(dataStr);
            if (q.success === false) {
              const errorMessage = q.data?.details || q.data?.code || '通义千问API未知错误';
              const openAIError = { id: `chatcmpl-${messageId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'qwen-proxy', choices: [{ index: 0, delta: { content: `错误: ${errorMessage}` }, finish_reason: 'stop' }] };
              this.push(`data: ${JSON.stringify(openAIError)}\n\n`);
              this.push(`data: [DONE]\n\n`);
              continue;
            }
            if (q.choices && q.choices.length > 0) {
              const choice = q.choices[0];
              const delta = choice.delta || choice.message;
              if (delta) {
                content = delta.content || '';
                if (delta.phase === 'image_gen') {
                  if (content && content.startsWith('https://')) {
                    if (!sentImageUrls.has(content)) { sentImageUrls.add(content); content = `![Image](${content})`; } else { content = ''; }
                  }
                } else if ((delta.chat_type === 't2i' || delta.chat_type === 'image_edit') && typeof content === 'string' && content.startsWith('https://')) {
                  if (!sentImageUrls.has(content)) { sentImageUrls.add(content); content = `![Image](${content})`; } else { content = ''; }
                }
                if (delta.status === 'finished') {
                  isFinished = true;
                }
                isFinished = isFinished || choice.finish_reason === 'stop';
              }
            } else if (q.content) {
              content = q.content;
              if (typeof content === 'string' && content.startsWith('https://') && content.includes('cdn.qwenlm.ai')) {
                if (!sentImageUrls.has(content)) { sentImageUrls.add(content); content = `![Image](${content})`; } else { content = ''; }
              }
              isFinished = q.status === 'finished' || q.finish_reason === 'stop';
            } else if (q.result || q.data) {
              const data = q.result || q.data;
              if (typeof data === 'string') content = data; else if (data.content) content = data.content;
            }
          } catch (_) {
            if (dataStr && !dataStr.startsWith('{')) { content = dataStr; }
          }

          if (content || isFinished) {
            const openAIChunk = { id: `chatcmpl-${messageId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'qwen-proxy', choices: [{ index: 0, delta: { content }, finish_reason: isFinished ? 'stop' : null }] };
            this.push(`data: ${JSON.stringify(openAIChunk)}\n\n`);
          }
        }
        callback();
      } catch (e) {
        logger.error('转换流处理失败', e);
        callback();
      }
    }
  });
}

// 非流式：将完整上游响应整合为 OpenAI 完成体
function convertQwenResponseToOpenAI(json) {
  const id = `chatcmpl-${randomUUID()}`;

  const coerceToString = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
      // 支持 OpenAI 风格 content parts: [{type:'text',text:'...'}]
      const texts = val
        .map((p) => (typeof p === 'string' ? p : (p?.text || p?.content || '')))
        .filter(Boolean);
      return texts.join('');
    }
    if (typeof val === 'object') {
      // 常见字段
      return val.text || val.content || '';
    }
    return '';
  };

  const pick = (...cands) => {
    for (const c of cands) {
      const s = coerceToString(c);
      if (s) return s;
    }
    return '';
  };

  // 逐层尝试提取上游内容
  let content = pick(
    json?.choices?.[0]?.message?.content,
    json?.choices?.[0]?.delta?.content,
    json?.choices?.[0]?.content,
    json?.message?.content,
    json?.content,
    json?.result?.content,
    json?.data?.content,
    json?.output?.text,
    json?.output_text,
    json?.result?.data?.content
  );

  // URL 图片兜底（部分响应直接返回图片直链）
  if (!content) {
    const url = [
      json?.url,
      json?.image_url,
      json?.data?.url,
      json?.result?.url,
      json?.choices?.[0]?.url
    ].find((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
    if (url) content = url.includes('cdn.qwenlm.ai') ? `![Image](${url})` : url;
  }

  // data/ result 为字符串时的兜底
  if (!content) {
    if (typeof json?.data === 'string') content = json.data;
    else if (typeof json?.result === 'string') content = json.result;
  }

  // 最终兜底：避免返回空串
  if (!content) content = '';

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now()/1000),
    model: 'qwen-proxy',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop'
      }
    ]
  };
}

// 将上游 SSE 流聚合为一次性文本（用于非流降级实现）
function collectOpenAICompletionFromSSE(readable) {
  return new Promise((resolve) => {
    let remainder = '';
    let content = '';
    const sentImageUrls = new Set();

    function pickContentFromQwen(q) {
      try {
        if (q.success === false) return `错误: ${q.data?.details || q.data?.code || '通义千问API未知错误'}`;
        if (q.choices && q.choices.length > 0) {
          const choice = q.choices[0];
          const delta = choice.delta || choice.message || {};
          let c = delta.content || '';
          if (delta.phase === 'image_gen' && typeof c === 'string' && c.startsWith('https://')) {
            if (!sentImageUrls.has(c)) { sentImageUrls.add(c); c = `![Image](${c})`; } else { c = ''; }
          } else if ((delta.chat_type === 't2i' || delta.chat_type === 'image_edit') && typeof c === 'string' && c.startsWith('https://')) {
            if (!sentImageUrls.has(c)) { sentImageUrls.add(c); c = `![Image](${c})`; } else { c = ''; }
          }
          return c || '';
        }
        if (typeof q.content === 'string') {
          const c = q.content;
          if (c.startsWith('https://') && c.includes('cdn.qwenlm.ai')) {
            if (!sentImageUrls.has(c)) { sentImageUrls.add(c); return `![Image](${c})`; }
            return '';
          }
          return c;
        }
        if (q.result || q.data) {
          const data = q.result || q.data;
          if (typeof data === 'string') return data;
          if (data?.content) return data.content;
        }
      } catch (_) { /* ignore */ }
      return '';
    }

    const onData = (buf) => {
      remainder += buf.toString('utf-8');
      let idx;
      while ((idx = remainder.indexOf('\n')) >= 0) {
        const line = remainder.slice(0, idx);
        remainder = remainder.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === 'data: [DONE]') {
          try { readable.destroy?.(); } catch (_) {}
          resolve(content);
          return;
        }
        if (trimmed.startsWith('data: ')) {
          const payload = trimmed.slice(6);
          try {
            const q = JSON.parse(payload);
            const piece = pickContentFromQwen(q);
            if (piece) content += piece;
          } catch (_) {
            // 非JSON，直接拼
            if (payload && !payload.startsWith('{')) content += payload;
          }
        }
      }
    };

    const finalize = () => resolve(content);
    readable.on('data', onData);
    readable.on('end', finalize);
    readable.on('close', finalize);
    readable.on('error', finalize);
  });
}

module.exports = { createQwenToOpenAIStreamTransformer, convertQwenResponseToOpenAI, collectOpenAICompletionFromSSE };


