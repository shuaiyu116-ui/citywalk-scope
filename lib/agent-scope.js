'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();

// Scoped to this request; never replace global fetch or cross-wire concurrent keys.
function scopedFetch(url, options = {}) {
  const run = scope.getStore();
  if (!run) return fetch(url, options);
  run.check();
  if (run.usage.networkCalls >= run.limits.networkCalls) throw Object.assign(new Error('budget'), { code: 'AGENT_LIMIT' });
  run.usage.networkCalls++;
  const controller = new AbortController();
  const signals = [run.signal, options.signal].filter(Boolean);
  const abort = () => controller.abort();
  signals.forEach(signal => signal.aborted ? abort() : signal.addEventListener('abort', abort, { once: true }));
  // Keep cancellation active through body consumption, not only response headers.
  return fetch(url, { ...options, signal: controller.signal }).then(response => {
    const cleanup = () => signals.forEach(signal => signal.removeEventListener('abort', abort));
    if (!response.ok) { cleanup(); response.body?.cancel().catch(() => {}); }
    return new Proxy(response, { get(target, key) {
      if (['json', 'text', 'arrayBuffer'].includes(key)) return async (...args) => { try { return await target[key](...args); } finally { cleanup(); } };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }, error => { signals.forEach(signal => signal.removeEventListener('abort', abort)); throw error; });
}
function recordModelUsage(payload) {
  const run = scope.getStore();
  if (!run) return;
  run.modelReports++;
  for (const [field, key] of [['promptTokens','prompt_tokens'], ['completionTokens','completion_tokens']]) {
    if (Number.isFinite(payload?.usage?.[key]) && payload.usage[key] >= 0) run.usage[field] += payload.usage[key];
    else run.usage.tokenUsageComplete = false;
  }
}
module.exports = { scope, scopedFetch, recordModelUsage };
