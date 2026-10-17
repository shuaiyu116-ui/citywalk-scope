const test = require('node:test');
const assert = require('node:assert/strict');
const { decideNextStep, buildDecisionInput } = require('../lib/agent-decision');
const { scope } = require('../lib/agent-scope');

const make = () => {
  const route = {
    id: 'trip1', city: '上海', context: { dayCount: 1, maxWalkKm: 3 },
    days: [{ id: 'day1', index: 1, stopIds: ['s1', 's2'], requestedWindow: { start: '09:00', end: '17:00' }, schedule: { status: 'conflict', walkingMeters: 6000, checks: [{ code: 'walking-budget', status: 'conflict', message: '步行超限' }] } }],
    stops: [{ id: 's1', name: '甲馆', city: '上海', dayId: 'day1', locked: true, location: { lat: 31.2, lng: 121.4 }, visit: { stayMinutes: 90 }, openingHours: { status: 'unknown', text: null }, schedule: { arrival: '2026-10-17T09:00' } }, { id: 's2', name: '乙馆', city: '上海', dayId: 'day1' }],
    legs: [{ id: 'l1', fromStopId: 's1', toStopId: 's2', preferredMode: 'walking', mode: 'walking', status: 'routed', distanceMeters: 6000, durationMinutes: 80, source: 'router', booking: { label: '用户车次', departure: '2026-10-17T12:00', arrival: '2026-10-17T13:00', beforeMinutes: 30 } }],
    proposal: { status: 'partial', stops: [{ id: 'p1', name: '待核主选馆', city: '上海', reason: '符合艺术兴趣', status: 'unresolved', selectedPoiId: null, selectedIndex: null, attempts: [
      { role: 'primary', name: '待核主选馆', city: '上海', status: 'not_found', reason: '符合艺术兴趣', candidates: [] },
      { role: 'alternative', name: '待核备选馆', city: '上海', status: 'ambiguous', reason: '附近备选', candidates: [{ id: 'candidate1', name: '备选馆东馆', city: '上海', address: '真实候选地址', source: 'ctrip', proof: 'private-poi-proof', detailUrl: 'https://internal.invalid/private-link' }] }
    ] }] },
    proof: 'internal-route-proof', apiKey: 'do-not-send'
  };
  return { route, versions: [{ id: 'v0', label: '初始路线', route, metrics: { conflicts: 1, unknowns: 2, unknownLegs: 0, stops: 2 } }], canAct: true, request: '想少走路，远的可以打车', feedback: { status: 'failed', actions: [{ type: 'move', stopId: 's1', offset: -1 }], error: { code: 'CLARIFY', message: '已在第一站', stack: 'internal-stack' } }, conversation: { messages: [{ role: 'user', content: '保留甲馆' }, { role: 'system', content: 'not-history' }] } };
};

test('decision receives real tool facts, versions and failures, and uses scoped model accounting', async t => {
  let sent;
  t.mock.method(global, 'fetch', async (url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ actions: [{ type: 'mode', legId: 'l1', mode: 'taxi' }], reason: '按你的偏好，长距离改为打车。' }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) };
  });
  const run = { check() {}, signal: new AbortController().signal, limits: { networkCalls: 5 }, modelReports: 0, usage: { networkCalls: 0, promptTokens: 0, completionTokens: 0, tokenUsageComplete: true } };
  const result = await scope.run(run, () => decideNextStep('fixture-only-key', make()));
  assert.equal(result.actions[0].mode, 'taxi');
  assert.equal(sent.model, 'deepseek-chat');
  assert.match(sent.messages[0].content, /^你是 Citywalk Scope 的行程决策助手/);
  const input = JSON.parse(sent.messages[1].content);
  assert.equal(input.current.stops[0].visit.stayMinutes, 90);
  assert.equal(input.current.stops[0].openingHours.status, 'unknown');
  assert.equal(input.current.stops[0].location.lat, 31.2);
  assert.equal(input.current.days[0].schedule.checks[0].status, 'conflict');
  assert.equal(input.current.days[0].schedule.checks[0].message, '步行超限');
  assert.equal(input.current.legs[0].durationMinutes, 80);
  assert.equal(input.current.legs[0].booking.beforeMinutes, 30);
  assert.equal(input.versions[0].metrics.conflicts, 1);
  assert.equal(input.feedback.error.message, '已在第一站');
  const unresolved = input.current.proposal.stops[0];
  assert.equal(unresolved.name, '待核主选馆');
  assert.equal(unresolved.status, 'unresolved');
  assert.equal(unresolved.selectedPoiId, null);
  assert.equal(unresolved.attempts[1].name, '待核备选馆');
  assert.equal(unresolved.attempts[1].city, '上海');
  assert.equal(unresolved.attempts[1].status, 'ambiguous');
  assert.equal(unresolved.attempts[1].candidates[0].name, '备选馆东馆');
  assert.equal(input.conversation.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(input), /internal-route-proof|do-not-send|internal-stack|not-history|fixture-only-key|private-poi-proof|private-link/);
  assert.equal(run.usage.networkCalls, 1);
  assert.equal(run.modelReports, 1);
  assert.equal(run.usage.promptTokens, 100);
  assert.equal(run.usage.completionTokens, 20);
});

test('terminal decision can choose any existing version and action payload cannot carry invented facts', async t => {
  let answer = { versionId: 'v0', reason: '保留原来的游玩内容。' };
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }));
  assert.deepEqual(await decideNextStep('fixture', { ...make(), canAct: false }), answer);
  answer = { actions: [{ add: { name: '新馆', city: '上海', recommended: true, location: { lat: 1, lng: 2 }, openingHours: '全天', proof: 'fake-proof' } }], reason: '先查询新馆。' };
  const result = await decideNextStep('fixture', make());
  assert.deepEqual(result.actions, [{ type: 'add', name: '新馆', city: '上海', recommended: true }]);
});

test('malformed decisions are planning errors and never permit actions in terminal selection', async t => {
  let content;
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }));
  for (const value of ['{broken', '[]', '{"reason":7}', '{"reason":"ok","actions":"move"}', '{"reason":"ok","actions":[{"type":"execute-code"}]}', '{"reason":"ok","actions":[{"type":"visit","stopId":{}}]}', '{"reason":"ok","versionId":"not-a-version"}']) {
    content = value;
    await assert.rejects(decideNextStep('fixture', make()), error => error.code === 'MODEL_RESPONSE');
  }
  content = JSON.stringify({ actions: [{ type: 'move', stopId: 's1', offset: 1 }], reason: '继续改' });
  await assert.rejects(decideNextStep('fixture', { ...make(), canAct: false }), error => error.code === 'MODEL_RESPONSE');
});

test('credentials are removed from input and reason; HTTP bodies and network errors do not escape', async t => {
  const input = make();
  input.request = '我输入 fixture-private-value sk-other-secret Bearer upstream-secret';
  const serialized = JSON.stringify(buildDecisionInput(input, 'fixture-private-value'));
  assert.doesNotMatch(serialized, /fixture-private-value|sk-other-secret|upstream-secret/);
  let mode = 'ok';
  t.mock.method(global, 'fetch', async () => {
    if (mode === 'network') throw Error('private upstream stack fixture-private-value');
    if (mode === 'http') return { ok: false, status: 401, text: async () => 'private upstream fixture-private-value' };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reason: '说明 fixture-private-value sk-other-secret Bearer upstream-secret' }) } }] }) };
  });
  assert.doesNotMatch((await decideNextStep('fixture-private-value', input)).reason, /fixture-private-value|sk-other-secret|upstream-secret/);
  mode = 'http';
  await assert.rejects(decideNextStep('fixture-private-value', input), error => error.code === 'MODEL_AUTH' && !/private|fixture/.test(error.message));
  mode = 'network';
  await assert.rejects(decideNextStep('fixture-private-value', input), error => error.code === 'MODEL_UNAVAILABLE' && !/private|fixture/.test(error.message));
});
