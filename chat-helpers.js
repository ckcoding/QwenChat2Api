const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { uploadFileToQwenOss } = require('./upload');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

function sha256Encrypt(input) { return crypto.createHash('sha256').update(input).digest('hex'); }
function generateUUID() { return crypto.randomUUID(); }

function isChatType(model) {
  if (!model) return 't2t';
  if (model.includes('-search')) return 'search';
  else if (model.includes('-image-edit')) return 'image_edit';
  else if (model.includes('-image')) return 't2i';
  else if (model.includes('-video')) return 't2v';
  else if (model.includes('-deep-research')) return 'deep_research';
  return 't2t';
}

function isThinkingEnabled(model, enableThinking, thinkingBudget) {
  const cfg = { output_schema: 'phase', thinking_enabled: false, thinking_budget: 81920 };
  if (model?.includes('-thinking') || enableThinking) cfg.thinking_enabled = true;
  if (thinkingBudget && !Number.isNaN(Number(thinkingBudget)) && Number(thinkingBudget) > 0 && Number(thinkingBudget) < 38912) cfg.budget = Number(thinkingBudget);
  return cfg;
}

function parserModel(model) {
  if (!model) return 'qwen3-coder-plus';
  try {
    model = String(model);
    model = model.replace('-search','').replace('-thinking','').replace('-edit','').replace('-video','').replace('-deep-research','').replace('-image','');
    return model;
  } catch { return 'qwen3-coder-plus'; }
}

async function parserMessages(messages, thinking_config, chat_type) {
  try {
    const feature_config = thinking_config;
    const cache = new Map();
    for (let message of messages) {
      if (message.role === 'user' || message.role === 'assistant') {
        message.chat_type = 't2t';
        message.extra = {};
        message.feature_config = { output_schema: 'phase', thinking_enabled: false };
        if (!Array.isArray(message.content)) continue;
        const newContent = [];
        for (let item of message.content) {
          if (item.type === 'image' || item.type === 'image_url') {
            let base64 = null;
            if (item.type === 'image_url') base64 = item.image_url.url;
            if (base64) {
              const regex = /data:(.+);base64,/; const fileType = base64.match(regex);
              const ext = fileType && fileType[1] ? (fileType[1].split('/')[1] || 'png') : 'png';
              const filename = `${generateUUID()}.${ext}`;
              base64 = base64.replace(regex, '');
              const signature = sha256Encrypt(base64);
              try {
                const buffer = Buffer.from(base64, 'base64');
                if (cache.has(signature)) {
                  delete item.image_url; item.type = 'image'; item.image = cache.get(signature); newContent.push(item);
                } else {
                  const uploadResult = await uploadFileToQwenOss(buffer, filename, config.QWEN_TOKEN);
                  if (uploadResult && uploadResult.status === 200) {
                    delete item.image_url; item.type = 'image'; item.image = uploadResult.file_url; cache.set(signature, uploadResult.file_url); newContent.push(item);
                  }
                }
              } catch (_) { /* ignore single item error */ }
            }
          } else if (item.type === 'text') {
            item.chat_type = 't2t'; item.feature_config = { output_schema: 'phase', thinking_enabled: false };
            if (newContent.length >= 2) {
              messages.push({ role: 'user', content: item.text, chat_type: 't2t', extra: {}, feature_config: { output_schema: 'phase', thinking_enabled: false } });
            } else { newContent.push(item); }
          }
        }
        message.content = newContent;
      } else {
        if (Array.isArray(message.content)) {
          let system_prompt = '';
          for (let item of message.content) if (item.type === 'text') system_prompt += item.text;
          if (system_prompt) message.content = system_prompt;
        }
      }
    }
    messages[messages.length - 1].feature_config = feature_config;
    messages[messages.length - 1].chat_type = chat_type;
    return messages;
  } catch (e) {
    return [{ role: 'user', content: "直接返回字符串：'聊天历史处理有误...'", chat_type: 't2t', extra: {}, feature_config: { output_schema: 'phase', enabled: false } }];
  }
}

module.exports = { isChatType, isThinkingEnabled, parserModel, parserMessages };


