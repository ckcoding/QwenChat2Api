// 请求头构造：生成接近浏览器的请求头，减少上游风控拦截
const { randomUUID } = require('crypto');
const { getCookie } = require('./config');

function buildBrowserLikeHeaders(token, { includeCookie = true } = {}) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'x-request-id': randomUUID(),
    'source': 'web',
    'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not=A?Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'referer': 'https://chat.qwen.ai/'
  };
  if (includeCookie) {
    const cookie = getCookie();
    if (cookie) headers['Cookie'] = cookie;
  }
  return headers;
}

module.exports = { buildBrowserLikeHeaders };


