// SSE 工具：统一设置响应头、Keepalive 与安全收尾
function setSseHeaders(res, requestId) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (requestId) res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function createKeepAlive(res) {
  let respondedDone = false;
  const safeWriteDone = () => {
    if (respondedDone) return;
    respondedDone = true;
    try { if (!res.writableEnded) res.write('data: [DONE]\n\n'); } catch (_) {}
    try { if (!res.writableEnded) res.end(); } catch (_) {}
  };
  const keepalive = setInterval(() => {
    try { if (!res.writableEnded) res.write(': keepalive\n\n'); } catch (_) {}
  }, 15000);
  const cleanup = () => { clearInterval(keepalive); respondedDone = true; };
  return { safeWriteDone, cleanup };
}

module.exports = { setSseHeaders, createKeepAlive };


