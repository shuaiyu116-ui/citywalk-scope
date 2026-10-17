// NDJSON may split a UTF-8 character or JSON record across network chunks.
function planningError(value, fallback) {
  const error = new Error(typeof value?.error === 'string' ? value.error : fallback);
  error.code = typeof value?.code === 'string' ? value.code : '';
  error.action = value?.action === 'settings' ? 'settings' : '';
  return error;
}
export async function requestAgent(body, { signal, onProgress = () => {} } = {}) {
  const response = await fetch('/api/agent-route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal
  });
  if (!response.ok) { const value=await response.json().catch(()=>({}));throw planningError(value, '规划服务暂不可用，请重试。'); }
  if (!response.body) throw new Error('规划服务暂不可用，请重试。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', result = null;
  const consume = line => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('规划结果传输中断，请重试。'); }
    if (event.type === 'progress') onProgress(event);
    else if (event.type === 'error') throw planningError(event, '规划未完成，请重试。');
    else if (event.type === 'result') result = event.result;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) consume(line);
      if (buffer.length > 4 * 1024 * 1024) throw new Error('规划结果过大，请减少地点后重试。');
      if (done) break;
    }
    consume(buffer);
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (!result?.route?.stops?.length && !['clarify','reply'].includes(result?.conversation?.status)) throw new Error('规划未完整返回，当前路线已保留，请重试。');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
