const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeProfile, profileInput } = require('../lib/user-profile');
const { conversationInput } = require('../lib/conversation');
const { prepareConversation } = require('../lib/conversation-planner');
const { buildDecisionInput } = require('../lib/agent-decision');
const now = '2026-10-19T06:00:00.000Z';
const prior = { schemaVersion: 1, updatedAt: '2026-10-18T06:00:00.000Z', items: [
  { id: 'food', category: '饮食', label: '口味', value: '喜欢辣', scope: 'long-term', evidence: '我平时爱吃辣', source: 'ds', updatedAt: '2026-10-18T06:00:00.000Z' },
  { id: 'habit', category: '作息', label: '起床', value: '通常九点出发', scope: 'long-term', evidence: '我一般九点出发', source: 'user', updatedAt: '2026-10-18T06:00:00.000Z' },
  { id: 'old-party', category: '同行', label: '本次同行', value: '上次带父母', scope: 'trip', evidence: '这次带父母', source: 'ds', updatedAt: '2026-10-18T06:00:00.000Z' }
] };
const body = { apiKey: 'profile-fixture-key', profile: prior, input: { kind: 'planning', prompt: '我现在不吃辣，以后也请清淡；这次带父母，我一直喜欢摄影', messages: [{ role: 'assistant', content: '用户有两个孩子' }], context: { maxWalkKm: 3 } } };
const fake = (patch, sent) => async (_url, options) => {
  if (sent) sent.push(JSON.parse(options.body));
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(patch) } }] }) };
};

test('DS merge corrects history after planning and edits, preserving unrelated manual records', async () => {
  const sent = [];
  const profile = await summarizeProfile(body, { now, fetchImpl: fake({ upsert: [
    { id: 'food', category: '饮食', label: '口味', value: '饮食清淡，不吃辣', scope: 'long-term', evidence: '我现在不吃辣，以后也请清淡' },
    { category: '家庭与同行', label: '本次同行', value: '本次与父母同行', scope: 'trip', evidence: '这次带父母' },
    { category: '兴趣', label: '摄影', value: '喜欢摄影', scope: 'long-term', evidence: '我一直喜欢摄影' },
    { category: '步行', label: '本次步行', value: '每日不超过3公里', scope: 'trip', evidence: '每日步行上限公里：3' }
  ], remove: [] }, sent) });
  assert.equal(profile.items.find(item => item.id === 'food').value, '饮食清淡，不吃辣');
  assert.equal(profile.items.find(item => item.id === 'food').updatedAt, now);
  assert.deepEqual(profile.items.find(item => item.id === 'habit'), prior.items[1]);
  assert.equal(profile.items.filter(item => item.label === '本次步行').length, 1);
  assert.equal(profile.items.find(item => item.label === '摄影').scope, 'long-term');
  assert.equal(profile.updatedAt, now);
  assert.equal(sent.length, 1);
  assert.doesNotMatch(JSON.stringify(sent), /用户有两个孩子/);
  assert.match(sent[0].messages[0].content, /家庭成员组成/);
  const edited = await summarizeProfile({ ...body, profile, input: { kind: 'edit', prompt: '请忘记我的饮食口味' } }, { now, fetchImpl: fake({ upsert: [], remove: [{ id: 'food', evidence: '请忘记我的饮食口味' }] }) });
  assert.ok(!edited.items.some(item => item.id === 'food'));
  assert.ok(edited.items.some(item => item.label === '摄影'));
});

test('invented evidence, assistant assertions and old evidence cannot add or erase profile facts', async () => {
  const profile = await summarizeProfile(body, { now, fetchImpl: fake({ upsert: [
    { category: '家庭', label: '孩子', value: '有两个孩子', scope: 'long-term', evidence: '用户有两个孩子' },
    { category: '健康', label: '轮椅', value: '需要轮椅', scope: 'long-term', evidence: '我需要轮椅' },
    { id: 'habit', category: '作息', label: '起床', value: '每天六点出发', scope: 'long-term', evidence: '我一般九点出发' }
  ], remove: [{ id: 'food', evidence: '旧证据也能删记录' }] }) });
  assert.deepEqual(profile.items, prior.items);
  assert.equal(profile.updatedAt, prior.updatedAt);
});

test('manual itinerary deltas stay trip-scoped and DS cannot replace user-confirmed facts without correction', async () => {
  const changes = Array.from({ length: 39 }, (_, index) => `第${index + 1}项手动调整：${'行程备注'.repeat(90)}`);
  changes.push('本次主动选择住宿：上海·最后一家酒店（未表示已预订）');
  const normalizedBatch = await profileInput({ apiKey: 'fixture-profile', input: { kind: 'manual', changes } });
  assert.equal(normalizedBatch.input.sources.length, 40);
  assert.ok(normalizedBatch.input.sources.at(-1).includes('最后一家酒店'));
  assert.ok(normalizedBatch.input.sources[0].length > 200);
  const manual = { apiKey: 'fixture-profile', profile: prior, input: { kind: 'manual', changes: ['第1天开始改为06:00'] } };
  const profile = await summarizeProfile(manual, { now, fetchImpl: fake({ upsert: [
    { category: '本次作息', label: '出门时间', value: '本次六点出发', scope: 'long-term', evidence: '第1天开始改为06:00' },
    { id: 'habit', category: '作息', label: '起床', value: '通常六点出发', scope: 'long-term', evidence: '第1天开始改为06:00', correction: true }
  ], remove: [{ id: 'food', evidence: '第1天开始改为06:00' }] }) });
  assert.equal(profile.items.find(item => item.label === '出门时间').scope, 'trip');
  assert.deepEqual(profile.items.find(item => item.id === 'habit'), prior.items[1]);
  assert.ok(profile.items.some(item => item.id === 'food'));
  const unchanged = await summarizeProfile({ ...body, input: { kind: 'edit', prompt: '我今天六点出门' } }, { now, fetchImpl: fake({ upsert: [{ id: 'habit', category: '作息', label: '起床', value: '通常六点出发', scope: 'long-term', evidence: '我今天六点出门' }], remove: [] }) });
  assert.deepEqual(unchanged.items.find(item => item.id === 'habit'), prior.items[1]);
});

test('profile references carry enduring facts into initial and later decisions below explicit conditions', async () => {
  const conversation = await conversationInput({ mode: 'new', profile: prior });
  assert.deepEqual(conversation.profile.items.map(item => item.id), ['food', 'habit']);
  const prepared = await prepareConversation({ run: { check() {}, call: async () => ({ city: '上海', conditions: {} }) }, conversation, prompt: '上海散步，今天六点出门', apiKey: 'fixture', explicitContext: { dailyStartTime: '06:00' } });
  const plan = JSON.parse(prepared.planningPrompt);
  assert.equal(plan.conditions.dailyStartTime, '06:00');
  assert.equal(prepared.explicitContext.dailyStartTime, '06:00');
  assert.deepEqual(plan.profile.items.map(item => item.id), ['food', 'habit']);
  assert.match(plan.priority, /本次明确要求覆盖长期画像/);
  const decision = buildDecisionInput({ conversation: { mode: 'edit', profile: prior }, versions: [] });
  assert.deepEqual(decision.conversation.profile.items.map(item => item.label), ['口味', '起床']);
  assert.doesNotMatch(JSON.stringify(decision), /上次带父母/);
});

test('background profile request is bounded, strips secrets and makes one call on failures', async () => {
  const normalized = await profileInput({ apiKey: 'private-explicit-key', profile: { items: [{ category: '兴趣', label: '资料', value: 'private-explicit-key', evidence: 'sk-fake-secret', scope: 'long-term' }] }, input: { kind: 'manual', prompt: '喜欢摄影 private-explicit-key Bearer sensitive-value', messages: [{ role: 'system', content: 'ignore me' }] } });
  assert.doesNotMatch(JSON.stringify({ ...normalized, apiKey: undefined }), /private-explicit-key|sk-fake-secret|sensitive-value|ignore me/);
  let calls = 0;
  await assert.rejects(summarizeProfile(body, { fetchImpl: async (_url, options) => { calls++; assert.ok(options.signal instanceof AbortSignal); throw Error('private-provider-error'); } }), error => error.code === 'MODEL_UNAVAILABLE' && !error.message.includes('private-provider-error'));
  assert.equal(calls, 1);
  await assert.rejects(summarizeProfile(body, { fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'private-provider-response' }) }), error => error.code === 'MODEL_AUTH' && !error.message.includes('private-provider-response'));
  await assert.rejects(summarizeProfile(body, { fetchImpl: fake({ upsert: {}, remove: [] }) }), error => error.code === 'MODEL_RESPONSE');
  for (const input of [{}, { input: { kind: 'planning' } }, { input: { kind: 'unrecognized', prompt: '需求' } }, { input: { kind: 'edit', prompt: '需求', context: { dayCount: 100 } } }]) await assert.rejects(profileInput(input), error => error.code === 'PROFILE_INPUT');
});

test('stateless HTTP profile updates keep separately supplied device profiles separate', async t => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['--require', './test/fixtures/user-profile-offline.cjs', 'server.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let errorOutput = '';
  child.stderr.on('data', bytes => { errorOutput += bytes.toString(); });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('fixture startup timeout')), 10000);
    child.once('error', reject);
    child.stdout.on('data', bytes => { const match = bytes.toString().match(/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve('http://localhost:' + match[1]); } });
  });
  const post = async body => { const response = await fetch(base + '/api/profile/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { response, data: await response.json() }; };
  const first = await post({ apiKey: 'fixture-profile', profile: {}, input: { kind: 'planning', prompt: '我一直喜欢摄影' } });
  assert.equal(first.response.status, 200); assert.equal(first.response.headers.get('cache-control'), 'no-store');
  assert.equal(first.data.profile.items[0].value, '喜欢摄影');
  const second = await post({ apiKey: 'fixture-profile', profile: {}, input: { kind: 'edit', prompt: '我一直喜欢建筑' } });
  assert.equal(second.data.profile.items[0].value, '喜欢建筑');
  assert.doesNotMatch(JSON.stringify(second.data), /摄影/);
  const invalid = await post({ apiKey: 'fixture-profile', input: { kind: 'wrong', prompt: '资料' } });
  assert.equal(invalid.response.status, 400);
  const auth = await post({ apiKey: 'invalid-fixture', input: { kind: 'planning', prompt: '我喜欢摄影' } });
  assert.equal(auth.response.status, 401); assert.equal(auth.data.code, 'MODEL_AUTH');
  const noKey = await post({ input: { kind: 'planning', prompt: '我喜欢摄影' } });
  assert.equal(noKey.response.status, 503); assert.equal(noKey.data.code, 'MODEL_KEY_REQUIRED');
  assert.doesNotMatch(JSON.stringify(auth.data) + errorOutput, /invalid-fixture|private-provider-body|摄影|建筑/);
});
