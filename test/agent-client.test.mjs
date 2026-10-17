import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAgent } from '../public/agent-client.mjs';

test('planner client preserves actionable errors and complete clarification state across split NDJSON', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [200, 401]) {
      const failure = { type: 'error', error: 'AI Key 无效，请更新后重试。', code: 'MODEL_AUTH', action: 'settings' };
      globalThis.fetch = async () => new Response(status === 200 ? JSON.stringify(failure) + '\n' : JSON.stringify(failure), { status });
      await assert.rejects(requestAgent({ prompt: '杭州' }), error => error.code === 'MODEL_AUTH' && error.action === 'settings' && /Key/.test(error.message));
    }
    const pending = { request: '想旅行六天', city: '', conditions: { dayCount: 6 }, question: '想去哪座城市？' };
    const value = { type: 'result', result: { conversation: { status: 'clarify', question: pending.question, pending } } };
    const bytes = new TextEncoder().encode(JSON.stringify(value) + '\n');
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
      // One-byte chunks force splits inside Chinese UTF-8 characters and JSON fields.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }));
    const result = await requestAgent({ prompt: '六天' });
    assert.deepEqual(result.conversation.pending, pending);
    assert.equal(result.route, undefined);
    globalThis.fetch = async () => new Response(JSON.stringify({ type:'result', result:{ conversation:{status:'reply',reply:'可以解释安排，不修改行程。'} } })+'\n');
    assert.equal((await requestAgent({prompt:'为什么？'})).conversation.status,'reply');
  } finally { globalThis.fetch = original; }
});
