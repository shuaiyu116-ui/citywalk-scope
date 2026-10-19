import test from 'node:test';
import assert from 'node:assert/strict';
import { planningProfileInput, manualProfileInput } from '../public/profile-input.mjs';

const baseRoute = () => ({
  id: 'trip', revision: { number: 1, reason: 'user-edit' },
  context: { transportMode: 'walking', maxWalkKm: 8, companions: [], dailyStartTime: '09:00', dailyEndTime: '18:00' },
  days: [{ id: 'd1', requestedWindow: { start: '09:00', end: '18:00' }, restMinutes: 0, lodging: { source: 'user', text: '' } }],
  stops: [{ id: 'a', name: '艺术馆', visit: { stayMinutes: 30 } }, { id: 'b', name: '公园', visit: {} }],
  legs: [{ id: 'ab', dayId: 'd1', fromStopId: 'a', toStopId: 'b', preferredMode: 'walking', durationMinutes: 20 }],
  hotels: { selectedId: 'h1', candidates: [{ id: 'h1', name: '模型推荐酒店', city: '上海' }, { id: 'h2', name: '用户选择酒店', city: '上海', price: 666 }] }
});

test('planning evidence includes only this prompt and explicit form fields, with credentials scrubbed', () => {
  const input = planningProfileInput({
    prompt: '我们一家三口，我平时喜欢建筑 sk-private token=hidden-token；custom-secret', apiKey: 'custom-secret',
    context: { dailyStartTime: '10:00', maxWalkKm: 4, companions: ['children'], apiKey: 'custom-secret', fieldSources: { maxWalkKm: 'user' } },
    conversation: { mode: 'edit', messages: [{ role: 'assistant', content: '你喜欢购物、预算高' }, { role: 'system', content: 'unexpected-system' }, { role: 'user', content: '这次坐公交 token=hidden-token；custom-secret' }], summary: { city: '不得使用的城市' }, changes: ['模型调整停留60分钟'] },
    currentRoute: { context: { transportMode: 'driving' }, stops: [{ name: '模型推荐景点' }] }
  });
  assert.equal(input.kind, 'edit');
  assert.deepEqual(input.context, { dailyStartTime: '10:00', maxWalkKm: 4, companions: ['children'] });
  assert.deepEqual(input.messages, []);
  assert.match(input.prompt, /一家三口.*建筑/);
  const content = JSON.stringify(input);
  for (const excluded of ['购物', 'unexpected-system', '不得使用', '模型调整', 'driving', '模型推荐', 'sk-private', 'custom-secret', 'hidden-token']) assert.ok(!content.includes(excluded), excluded);
});

test('clarification retains the original user request when only a brief answer remains', () => {
  const original = '南京三天，这次带父母，想轻松一些';
  const input = { prompt: '同时', conversation: { pending: { request: original, question: '不要当成用户事实' }, messages: [{ role: 'assistant', content: '不要当成用户事实' }] } };
  assert.deepEqual(planningProfileInput(input).messages, [{ role: 'user', content: original }]);
  input.conversation.messages.push({ role: 'user', content: original });
  assert.equal(planningProfileInput(input).messages.length, 1);
  assert.ok(!JSON.stringify(planningProfileInput(input)).includes('不要当成用户事实'));
});

test('a later unrelated request never replays deleted profile facts from completed user turns', () => {
  const result = planningProfileInput({
    prompt: '这次去南京三天',
    conversation: {
      mode: 'new', profile: { items: [] }, pending: null,
      messages: [{ role: 'user', content: '我平时喜欢咖啡，家里有一个孩子' }, { role: 'assistant', content: '行程已经规划完成' }]
    }
  });
  assert.equal(result.prompt, '这次去南京三天');
  assert.deepEqual(result.messages, []);
  assert.ok(!/咖啡|孩子|行程已经规划完成/.test(JSON.stringify(result)));
});

test('computed route updates and generated recommendations do not create manual preference evidence', () => {
  const before = baseRoute(), after = structuredClone(before);
  after.stops[0].schedule = { stayMinutes: 90, arrival: { time: '09:00' } };
  after.stops[0].note = '模型认为你喜欢艺术'; after.stops[0].progress = { completed: true };
  after.stops.push({ id: 'c', name: '新加入商场', visit: {}, schedule: { stayMinutes: 60 } });
  after.days.push({ id: 'd2', requestedWindow: { start: '09:00', end: '18:00' } });
  after.legs[0].durationMinutes = 40; after.legs[0].mode = 'cycling';
  after.legs.push({ dayId: 'd2', fromStopId: 'b', toStopId: 'c', preferredMode: 'taxi' });
  after.hotels.candidates.push({ id: 'h3', name: '新推荐酒店' });
  assert.equal(manualProfileInput(before, after), null);
  assert.equal(manualProfileInput(null, after), null);
});

test('explicit settings applied to a new day or stop in the same draft remain evidence without learning the place itself', () => {
  const before = baseRoute(), after = structuredClone(before);
  after.days.push({ id: 'd2', requestedWindow: { start: '09:00', end: '18:00' } });
  after.stops.push({ id: 'c', name: '新加入商场', visit: {} });
  assert.equal(manualProfileInput(before, after), null, 'new entities with inherited defaults are not evidence');
  after.days[1].requestedWindow.start = '11:00';
  after.days[1].restMinutes = 30;
  after.days[1].lodging = { source: 'user', text: '这次住在车站附近' };
  after.stops[2].visit = { stayMinutes: 75, restMinutes: 10 };
  const result = manualProfileInput(before, after), content = result.changes.join('\n');
  assert.equal(result.changes.length, 5);
  for (const expected of ['第 2 天游玩时段改为11:00–18:00', '出发前休息改为30分钟', '这次住在车站附近', '新加入商场停留时长改为75分钟', '新加入商场休息时长改为10分钟']) assert.ok(content.includes(expected), expected);
  assert.ok(!/喜欢|兴趣|偏好|经常/.test(content));
  assert.ok(result.changes.every(change => change.startsWith('本次')));
});

test('manual evidence captures requested deltas instead of replaying the route or inferring family habits', () => {
  const before = baseRoute(), after = structuredClone(before);
  after.context.companions = ['children'];
  after.days[0].requestedWindow.start = '10:00'; after.days[0].restMinutes = 20;
  after.days[0].lodging.text = '这次住亲子房 token=secret-value';
  after.stops[0].visit.stayMinutes = 45;
  after.legs[0].id = 'new-ab'; after.legs[0].preferredMode = 'taxi';
  after.hotels.selectedId = 'h2';
  const result = manualProfileInput(before, after);
  assert.equal(result.kind, 'manual'); assert.deepEqual(result.context, {});
  assert.ok(result.changes.every(change => change.startsWith('本次')));
  const content = result.changes.join('\n');
  for (const expected of ['带儿童', '10:00', '休息改为20分钟', '亲子房', '停留时长改为45分钟', '交通方式改为打车', '主动选择住宿：上海·用户选择酒店']) assert.ok(content.includes(expected), expected);
  for (const excluded of ['secret-value', '一家', '已育', '长期', '666', '模型推荐酒店', 'durationMinutes']) assert.ok(!content.includes(excluded), excluded);
  assert.equal(before.stops[0].visit.stayMinutes, 30);
});

test('unchanged constraints and reordered companions stay quiet; clearing a value produces a trip correction', () => {
  const before = baseRoute(); before.context.companions = ['children', 'seniors'];
  const after = structuredClone(before); after.context.companions.reverse();
  assert.equal(manualProfileInput(before, after), null);
  delete after.stops[0].visit.stayMinutes;
  after.context.maxWalkKm = null;
  assert.match(manualProfileInput(before, after).changes.join('\n'), /取消明确的每日步行上限/);
  assert.match(manualProfileInput(before, after).changes.join('\n'), /取消明确的停留时长/);
});

test('undo, adoption, restoration and switching to another route never become manual learning events', () => {
  const before = baseRoute(), after = structuredClone(before); after.stops[0].visit.stayMinutes = 80;
  for (const reason of ['undo', 'agent-version-selection', 'library-restore', 'generated']) {
    after.revision.reason = reason; assert.equal(manualProfileInput(before, after), null, reason);
  }
  after.revision.reason = 'user-edit'; after.id = 'another-trip';
  assert.equal(manualProfileInput(before, after), null);
});
