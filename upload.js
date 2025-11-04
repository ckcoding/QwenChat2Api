const axios = require('axios');
const OSS = require('ali-oss');
const mime = require('mime-types');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { http } = require('./lib/http');
const { logger } = require('./lib/logger');

const { getQwenToken } = require('./lib/config');

const UPLOAD_CONFIG = {
  stsTokenUrl: 'https://chat.qwen.ai/api/v2/files/getstsToken',
  maxRetries: 3,
  timeout: 30000,
  maxFileSize: 100 * 1024 * 1024,
  retryDelay: 1000,
};

const SUPPORTED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
  video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv'],
  audio: ['audio/mp3', 'audio/wav', 'audio/aac', 'audio/ogg'],
  document: ['application/pdf', 'text/plain', 'application/msword'],
};

const validateFileSize = (size) => size > 0 && size <= UPLOAD_CONFIG.maxFileSize;
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const getSimpleFileType = (mimeType) => {
  if (!mimeType) return 'file';
  const main = String(mimeType).split('/')[0].toLowerCase();
  return Object.keys(SUPPORTED_TYPES).includes(main) ? main : 'file';
};

async function requestStsToken(filename, filesize, filetypeSimple, authToken, retryCount = 0) {
  try {
    if (!filename || !authToken) throw new Error('文件名和认证令牌不能为空');
    if (!validateFileSize(filesize)) throw new Error(`文件大小超出限制，最大允许 ${UPLOAD_CONFIG.maxFileSize / 1024 / 1024}MB`);
    const requestId = randomUUID();
    const bearerToken = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
    const headers = { Authorization: bearerToken, 'Content-Type': 'application/json', 'x-request-id': requestId, 'User-Agent': 'Mozilla/5.0' };
    const payload = { filename, filesize, filetype: filetypeSimple };
    const resp = await http.post(UPLOAD_CONFIG.stsTokenUrl, payload, { headers, timeout: UPLOAD_CONFIG.timeout });
    if (resp.status === 200 && resp.data) {
      const s = resp.data;
      return {
        credentials: { access_key_id: s.access_key_id, access_key_secret: s.access_key_secret, security_token: s.security_token },
        file_info: { url: s.file_url, path: s.file_path, bucket: s.bucketname, endpoint: `${s.region}.aliyuncs.com`, id: s.file_id },
      };
    }
    throw new Error(`获取STS令牌失败，状态码: ${resp.status}`);
  } catch (e) {
    if (e.response?.status === 403) throw new Error('认证失败，请检查令牌权限');
    if (retryCount < UPLOAD_CONFIG.maxRetries && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || e.response?.status >= 500)) {
      const ms = UPLOAD_CONFIG.retryDelay * Math.pow(2, retryCount); await delay(ms); return requestStsToken(filename, filesize, filetypeSimple, authToken, retryCount + 1);
    }
    throw e;
  }
}

async function uploadToOssWithSts(fileBuffer, stsCredentials, ossInfo, contentType, retryCount = 0) {
  try {
    if (!fileBuffer || !stsCredentials || !ossInfo) throw new Error('缺少必要的上传参数');
    const client = new OSS({ accessKeyId: stsCredentials.access_key_id, accessKeySecret: stsCredentials.access_key_secret, stsToken: stsCredentials.security_token, bucket: ossInfo.bucket, endpoint: ossInfo.endpoint, secure: true, timeout: UPLOAD_CONFIG.timeout });
    const result = await client.put(ossInfo.path, fileBuffer, { headers: { 'Content-Type': contentType || 'application/octet-stream' } });
    if (result?.res?.status === 200) return { success: true, result };
    throw new Error(`OSS上传失败，状态码: ${result.res?.status || '未知'}`);
  } catch (e) {
    if (retryCount < UPLOAD_CONFIG.maxRetries) { const ms = UPLOAD_CONFIG.retryDelay * Math.pow(2, retryCount); await delay(ms); return uploadToOssWithSts(fileBuffer, stsCredentials, ossInfo, contentType, retryCount + 1); }
    throw e;
  }
}

async function uploadFileToQwenOss(fileBuffer, originalFilename, authToken) {
  // 如果需要可切换为直传逻辑；此处实现完整的 STS + OSS 上传
  if (!fileBuffer || !originalFilename || !authToken) throw new Error('缺少必要的上传参数');
  const filesize = fileBuffer.length;
  const mimeType = mime.lookup(originalFilename) || 'application/octet-stream';
  const filetypeSimple = getSimpleFileType(mimeType);
  if (!validateFileSize(filesize)) throw new Error(`文件大小超出限制，最大允许 ${UPLOAD_CONFIG.maxFileSize / 1024 / 1024}MB`);
  const { credentials, file_info } = await requestStsToken(originalFilename, filesize, filetypeSimple, authToken);
  await uploadToOssWithSts(fileBuffer, credentials, file_info, mimeType);
  return { status: 200, file_url: file_info.url, file_id: file_info.id, message: '文件上传成功' };
}

module.exports = { uploadFileToQwenOss };


