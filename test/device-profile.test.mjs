import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceProfileStore } from '../public/device-profile.mjs';

class Storage {
  values = new Map(); blocked = false;
  getItem(key) { if (this.blocked) throw Error('blocked'); return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.blocked) throw Error('blocked'); this.values.set(key, value); }
}
class Events {
  listeners = new Set();
  addEventListener(type, fn) { if (type === 'storage') this.listeners.add(fn); }
  removeEventListener(type, fn) { this.listeners.delete(fn); }
  emit(event) { for (const listener of this.listeners) listener(event); }
}
const item = (value = '喜欢安静的博物馆', extra = {}) => ({ id: 'interest-1', category: '兴趣', label: '兴趣偏好', value, scope: 'long-term', evidence: '用户主动说明', source: 'ds', ...extra });
const profile = items => ({ schemaVersion: 1, items, updatedAt: '2026-10-18T16:00:00.000Z' });
const response = items => ({ ok: true, json: async () => ({ profile: profile(items) }) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let sequence = 0;
const make = (options = {}) => createDeviceProfileStore({ storage: new Storage(), eventTarget: new Events(), uuid: () => `test-device-${++sequence}`, now: () => Date.parse('2026-10-19T01:00:00Z'), ...options });

test('profiles and manual preferences persist per browser storage and never persist request credentials or transcript', async () => {
  const storage = new Storage(), otherStorage = new Storage();
  let received;
  const store = make({ storage, fetcher: async (_, options) => { received = JSON.parse(options.body); return response([item()]); } });
  store.setPreferences({ interests: ['历史'], pace: '轻松', apiKey: 'secret-preference' });
  await store.enqueue({ prompt: '我喜欢安静的博物馆 apiKey=secret-input', messages: [{ role: 'user', content: '独有对话文本' }, { role: 'assistant', content: '模型说的不是用户偏好' }] }, () => 'secret-key');
  assert.equal(received.apiKey, 'secret-key');
  assert.equal(received.input.messages.length, 1);
  assert.doesNotMatch(received.input.prompt, /secret-input/);
  const saved = [...storage.values.values()].join(' ');
  assert.doesNotMatch(saved, /secret-key|secret-preference|secret-input|独有对话文本/);
  const reloaded = make({ storage }), other = make({ storage: otherStorage });
  assert.equal(reloaded.getSnapshot().deviceId, store.getSnapshot().deviceId);
  assert.deepEqual(reloaded.getProfile(), store.getProfile());
  assert.deepEqual(reloaded.getPreferences().interests, ['历史']);
  assert.equal(other.getProfile().items.length, 0);
  assert.notEqual(other.getSnapshot().deviceId, store.getSnapshot().deviceId);
  for (const current of [store, reloaded, other]) current.dispose();
});

test('the serialized background queue uses the latest saved profile and obtains the current Key only when each job starts', async () => {
  const first = deferred(), started = deferred(), calls = [];
  let key = 'first-key';
  const store = make({ fetcher: async (_, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) { started.resolve(); return first.promise; }
    return response([item('喜欢艺术馆')]);
  } });
  const a = store.enqueue({ prompt: '我喜欢博物馆' }, () => key);
  const b = store.enqueue({ kind: 'edit', prompt: '也喜欢艺术馆', changes: Array.from({ length: 40 }, (_, index) => `调整${index}：${'住宿选择'.repeat(60)}`) }, () => key);
  await started.promise; assert.equal(calls.length, 1); key = 'new-key';
  first.resolve(response([item()])); await Promise.all([a, b]);
  assert.equal(calls.length, 2); assert.equal(calls[1].profile.items[0].value, '喜欢安静的博物馆');
  assert.equal(calls[1].apiKey, 'new-key'); assert.equal(calls[1].input.changes.length, 40);
  assert.ok(calls[1].input.changes[39].length > 200);
  assert.equal(store.getSnapshot().status, 'saved'); store.dispose();
});

test('manual corrections beat an in-flight DS response and a later failed request cannot leave the status updating', async () => {
  for (const rejectResponse of [false, true]) {
    const request = deferred(), started = deferred();
    const store = make({ fetcher: () => { started.resolve(); return request.promise; } });
    store.saveItem(item('旧偏好'));
    const update = store.enqueue({ prompt: '旧对话' }); await started.promise;
    store.saveItem(item('我现在喜欢自然景色'));
    rejectResponse ? request.reject(Error('secret-request-error')) : request.resolve(response([item('过时的模型判断')]));
    assert.equal((await update).skipped, true);
    assert.equal(store.getProfile().items[0].value, '我现在喜欢自然景色');
    assert.equal(store.getProfile().items[0].source, 'user');
    assert.equal(store.getSnapshot().status, 'saved'); assert.equal(store.getSnapshot().error, ''); store.dispose();
  }
});

test('clearing cancels old queued observations and prevents a slow result from resurrecting deleted data', async () => {
  const request = deferred(), started = deferred(); let calls = 0;
  const store = make({ fetcher: () => { calls++; started.resolve(); return request.promise; } });
  const a = store.enqueue({ prompt: '以前喜欢购物' });
  const b = store.enqueue({ prompt: '以前的家庭信息' });
  await started.promise; store.clear();
  assert.equal((await b).skipped, true);
  request.resolve(response([item('过时的信息')])); assert.equal((await a).skipped, true);
  assert.equal(calls, 1); assert.equal(store.getProfile().items.length, 0); store.dispose();
});

test('a newer write in another tab is retained even before a storage event is delivered', async () => {
  const storage = new Storage(), request = deferred(), started = deferred(), events = new Events();
  const first = make({ storage, eventTarget: events, fetcher: () => { started.resolve(); return request.promise; } });
  const second = make({ storage }); let notification;
  first.subscribe(value => { notification = value; });
  const update = first.enqueue({ prompt: '旧输入' }); await started.promise;
  second.saveItem(item('另一标签页刚修正的偏好'));
  request.resolve(response([item('旧模型结果')])); assert.equal((await update).skipped, true);
  assert.equal(first.getProfile().items[0].value, '另一标签页刚修正的偏好');
  events.emit({ key: `citywalk.device.${first.getSnapshot().deviceId}.resources.v1`, storageArea: storage });
  assert.equal(notification.profile.items[0].value, '另一标签页刚修正的偏好');
  first.dispose(); second.dispose();
});

test('failure preserves the existing profile and supports a retry with a new Key', async () => {
  let calls = 0, key = 'expired-key', received;
  const store = make({ fetcher: async (_, options) => {
    received = JSON.parse(options.body);
    return ++calls === 1 ? { ok: false, status: 401 } : response([item('已经更新')]);
  } });
  store.saveItem(item('已有偏好'));
  await store.enqueue({ prompt: '本次需求' }, () => key);
  assert.equal(store.getSnapshot().status, 'error'); assert.equal(store.getProfile().items[0].value, '已有偏好');
  key = 'working-key'; await store.retry();
  assert.equal(received.apiKey, 'working-key'); assert.equal(store.getProfile().items[0].value, '已经更新');
  assert.equal(store.getSnapshot().status, 'saved'); store.dispose();
});

test('storage denial uses page memory and saving after recovery retains that in-memory profile', () => {
  const storage = new Storage(); storage.blocked = true;
  const store = make({ storage }); store.saveItem(item('仅在页面保留'));
  assert.equal(store.getSnapshot().persistent, false); assert.equal(store.getProfile().items.length, 1);
  storage.blocked = false;
  store.saveItem(item('家庭喜欢慢游', { id: 'family-1', category: '家庭' }));
  assert.equal(store.getSnapshot().persistent, true);
  const reloaded = make({ storage }); assert.equal(reloaded.getProfile().items.length, 2);
  store.dispose(); reloaded.dispose();
});

test('manual upserts respect the 40 item limit and trip-only memories do not become new-trip defaults', async () => {
  const store = make({ fetcher: async () => response(Array.from({ length: 40 }, (_, index) => item(`偏好${index}`, { id: `item-${index}`, scope: index === 0 ? 'trip' : 'long-term' }))) });
  await store.enqueue({ prompt: '我的需求' });
  assert.equal(store.saveItem(item('超出的条目', { id: 'overflow' })), false);
  assert.equal(store.saveItem(item('纠正已有条目', { id: 'item-39' })), true);
  assert.equal(store.getProfile().items.length, 40);
  assert.equal(store.getPlanningProfile().items.length, 39);
  assert.equal(store.getPlanningProfile().items.some(entry => entry.id === 'item-0'), false); store.dispose();
});
