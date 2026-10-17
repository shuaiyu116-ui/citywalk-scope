const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { normalizeProposal, matchPlace, matchProposal } = require('../lib/route-planner');
const { createItinerary, resolveTripContext } = require('../lib/itinerary');
const { searchMcpPois } = require('../lib/ctrip-mcp');

const retrievedAt = '2026-10-16T01:00:00.000Z';
const poi = (id, name = '中央公园', city = '上海', address = '') => ({ id, name, city, address, location: { lat: 31, lng: 121 }, retrievedAt, providerUpdatedAt: null });
const result = pois => ({ source: 'ctrip', provider: 'ctrip-http', retrievedAt, pois });

test('identity matching rejects same-name ambiguity, wrong/unknown city, fuzzy names and invalid coordinates', () => {
  const target = { name: '中央公园', city: '上海市' };
  const options = result([poi('a', '中央公园', '上海', '西路100号'), poi('b', '中央公园', '上海', '东路200号')]);
  assert.equal(matchPlace(target, options).status, 'ambiguous');
  assert.equal(matchPlace({ ...target, addressHint: '西路100号' }, options).selected.id, 'a');
  assert.equal(matchPlace({ ...target, addressHint: '南路300号' }, result([poi('a', '中央公园', '上海', '西路100号')])).status, 'address_mismatch');
  assert.equal(matchPlace(target, result([poi('a', '中央公园', '北京')])).status, 'wrong_city');
  assert.equal(matchPlace(target, result([poi('a', '中央公园', '')])).status, 'missing_city');
  assert.equal(matchPlace(target, result([poi('a', '中央公园售票处')])).status, 'not_found');
  assert.equal(matchPlace(target, result([{ ...poi('a'), location: { lat: null, lng: 121 } }])).selected, null);
  assert.equal(matchPlace(target, options).selected, null);
});

test('identity matching accepts only unique scenic suffix variants and preserves exact, city and address boundaries', async () => {
  const target = { name: '西湖', city: '杭州市' };
  const scenic = poi('west-lake', '西湖风景名胜区', '杭州', '西湖区龙井路1号');
  const found = matchPlace(target, result([scenic, poi('boat', '西湖游船', '杭州')]));
  assert.equal(found.status, 'matched'); assert.equal(found.selected.id, 'west-lake');
  assert.equal(found.selected.name, '西湖风景名胜区');
  assert.equal(matchPlace({ ...target, name: '西湖风景区' }, result([scenic])).selected.id, 'west-lake');
  const ambiguous = result([scenic, poi('second', '西湖景区', '杭州', '余杭区北路2号')]);
  assert.equal(matchPlace(target, ambiguous).status, 'ambiguous');
  assert.equal(matchPlace(target, ambiguous).selected, null);
  assert.equal(matchPlace({ ...target, addressHint: '西湖区龙井路1号' }, ambiguous).selected.id, 'west-lake');
  assert.equal(matchPlace({ ...target, addressHint: '上城区南路3号' }, result([scenic])).status, 'address_mismatch');
  assert.equal(matchPlace(target, result([scenic, poi('exact', '西湖', '杭州')])).selected.id, 'exact');
  assert.equal(matchPlace(target, result([scenic, poi('exact-away', '西湖', '惠州')])).selected.id, 'west-lake');
  assert.equal(matchPlace(target, result([poi('away', '西湖风景名胜区', '惠州')])).status, 'wrong_city');
  assert.equal(matchPlace(target, result([poi('unknown', '西湖风景名胜区', '')])).status, 'missing_city');
  assert.equal(matchPlace(target, result([{ ...scenic, location: { lat: null, lng: 120 } }])).status, 'not_found');
  for (const name of ['西湖游船', '西湖公园', '西湖风景名胜区售票处', '西湖外事游船', '西湖水上乐园景区']) {
    assert.equal(matchPlace(target, result([poi('unrelated', name, '杭州')])).status, 'not_found', name);
  }
  assert.equal(matchPlace({ name: '湖', city: '杭州' }, result([poi('short', '湖景区', '杭州')])).status, 'not_found');
  const repeated = await matchProposal(normalizeProposal({ city: '杭州', stops: [{ name: '西湖' }, { name: '西湖风景名胜区' }] }), async () => result([scenic]));
  assert.equal(repeated.route.stops.length, 1);
  assert.equal(repeated.proposal.stops[1].attempts[0].status, 'duplicate');
});

test('multi-day proposals may opt into twelve stops while legacy and absolute bounds remain enforced', () => {
  const raw = count => ({ city: '杭州', stops: Array.from({ length: count }, (_, i) => ({ name: `景点${i + 1}` })) });
  assert.equal(normalizeProposal(raw(12), '', { maxStops: 12 }).stops.length, 12);
  assert.throws(() => normalizeProposal(raw(12)), /Invalid route proposal/);
  assert.throws(() => normalizeProposal(raw(13), '', { maxStops: 12 }), /Invalid route proposal/);
  assert.throws(() => normalizeProposal(raw(15), '', { maxStops: 100 }), /Invalid route proposal/);
  assert.equal(normalizeProposal(raw(14), '', { maxStops: 100 }).stops.length, 14);
});

test('model address hints cannot reject unique identities or resolve ambiguity while user addresses stay strict', () => {
  const raw = { city: '杭州', stops: [
    { name: '西湖', addressHint: '位于杭州市西湖区', addressHintSource: 'user' },
    { name: '雷峰塔', addressHint: '西湖区南山路15号' }
  ] };
  const model = normalizeProposal(raw);
  const scenic = result([poi('lake', '西湖风景名胜区', '杭州', '西湖区龙井路1号')]);
  assert.equal(model.stops[0].addressHintSource, 'model');
  assert.equal(matchPlace(model.stops[0], scenic).status, 'matched');
  const duplicates = result([poi('a', '雷峰塔', '杭州', '西湖区南山路15号'), poi('b', '雷峰塔', '杭州', '余杭区北路2号')]);
  assert.equal(matchPlace(model.stops[1], duplicates).status, 'ambiguous');
  const user = normalizeProposal(raw, '', { userPrompt: '我要去西湖区南山路15号的雷峰塔' });
  assert.equal(user.stops[1].addressHintSource, 'user');
  assert.equal(normalizeProposal(raw, '', { userPrompt: '雷峰塔地址：西湖区，南山路 １５ 号。' }).stops[1].addressHintSource, 'user');
  assert.equal(matchPlace(user.stops[1], duplicates).selected.id, 'a');
  assert.equal(matchPlace(user.stops[1], result([poi('wrong', '雷峰塔', '杭州', '余杭区北路2号')])).status, 'address_mismatch');
  assert.equal(matchPlace({ name: '雷峰塔', city: '杭州', addressHint: '西湖区南山路15号' }, result([poi('wrong', '雷峰塔', '杭州', '余杭区北路2号')])).status, 'address_mismatch');
});

test('semantic identity matching adopts only returned same-city facts, batches aliases once and still deduplicates', async () => {
  const proposal = normalizeProposal({ city: '杭州', stops: [{ name: '浙博孤山馆' }, { name: '雷峰塔' }, { name: '浙江博物馆孤山馆区' }] });
  let searches = 0, batches = 0;
  const museum = poi('museum', '浙江省博物馆（孤山馆区）', '杭州', '西湖区孤山路25号');
  const matched = await matchProposal(proposal, async ({ query }) => {
    searches++;
    return result(query === '雷峰塔' ? [poi('tower', '雷峰塔', '杭州')] : [museum, poi('other-city', '浙江省博物馆（孤山馆区）', '宁波'), { ...poi('invalid', '浙博', '杭州'), location: { lat: null, lng: 120 } }]);
  }, { resolveIdentities: async requests => {
    batches++;
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(request => request.targetId), [`${proposal.stops[0].id}:0`, `${proposal.stops[2].id}:0`]);
    assert.equal(requests.every(request => request.candidates.length === 1 && request.candidates[0].id === 'museum'), true);
    // A resolver only receives a copy; its modifications are not provider facts.
    requests[0].candidates[0].location.lat = 0;
    return requests.map(request => ({ targetId: request.targetId, candidateId: 'museum', decision: 'same', reason: '均指向同城孤山馆区，返回地址一致。' }));
  } });
  assert.equal(searches, 3); assert.equal(batches, 1);
  assert.deepEqual(matched.route.stops.map(stop => stop.poiId), ['museum', 'tower']);
  assert.equal(matched.route.stops[0].location.lat, 31);
  assert.equal(matched.route.stops[0].name, museum.name);
  assert.equal(matched.proposal.stops[0].attempts[0].matchMethod, 'semantic');
  assert.match(matched.proposal.stops[0].attempts[0].matchReason, /孤山馆区/);
  assert.equal(matched.proposal.stops[2].attempts[0].status, 'duplicate');
});

test('semantic identity matching rejects invented IDs, uncertainty, cross-city facts and explicit address conflicts', async () => {
  const proposal = normalizeProposal({ city: '杭州', stops: [
    { name: '别名甲' }, { name: '别名乙' }, { name: '别名丙' },
    { name: '别名丁', addressHint: '西湖区南山路15号' }, { name: '别名戊' }
  ] }, '', { userPrompt: '别名丁的地址必须是西湖区南山路15号' });
  let received;
  const matched = await matchProposal(proposal, async ({ query }) => {
    if (query === '别名丙') return result([poi('away', '正式名称丙', '宁波')]);
    if (query === '别名丁') return result([poi('wrong-address', '正式名称丁', '杭州', '余杭区北路2号')]);
    if (query === '别名戊') return { ...result([poi('demo', '正式名称戊', '杭州')]), source: 'mock' };
    return result([poi(query, `正式名称${query.at(-1)}`, '杭州')]);
  }, { resolveIdentities: async requests => {
    received = requests;
    return requests.map((request, index) => ({ targetId: request.targetId, candidateId: index ? request.candidates[0].id : 'invented', decision: index ? 'uncertain' : 'same', reason: '信息不足。' }));
  } });
  assert.deepEqual(received.map(request => request.target.name), ['别名甲', '别名乙']);
  assert.equal(matched.route.stops.length, 0);
  assert.equal(matched.proposal.stops.every(slot => slot.status === 'unresolved'), true);
});

test('semantic resolver failure preserves deterministic matches without exposing upstream errors', async () => {
  const proposal = normalizeProposal({ city: '杭州', stops: [{ name: '雷峰塔' }, { name: '浙博' }] });
  const matched = await matchProposal(proposal, async ({ query }) => result([poi(query, query === '雷峰塔' ? query : '浙江省博物馆', '杭州')]), {
    resolveIdentities: async () => { throw new Error('secret upstream error'); }
  });
  assert.deepEqual(matched.route.stops.map(stop => stop.name), ['雷峰塔']);
  assert.match(matched.warning, /名称核对暂未完成/);
  assert.equal(JSON.stringify(matched).includes('secret'), false);
});

test('proposal matching selects backups, preserves unknowns, deduplicates, bounds concurrency and never adopts model facts', async () => {
  const raw = { city: '上海', title: '测试', rationale: '主题', apiKey: 'secret', stops: [
    { name: '不存在', city: '上海', location: { lat: 0, lng: 0 }, openingHours: '模型虚构', alternatives: [{ name: '中央公园', city: '上海' }] },
    { name: '中央公园', city: '上海', alternatives: [{ name: '夫子庙', city: '南京' }] },
    { name: '异常地点', city: '上海' }
  ] };
  const proposal = normalizeProposal(raw);
  assert.equal(/secret|模型虚构|location/.test(JSON.stringify(proposal)), false);
  let active = 0; let maximum = 0; const calls = [];
  const matched = await matchProposal(proposal, async args => {
    calls.push(`${args.city}:${args.query}`); maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (args.query === '异常地点') throw new Error('secret upstream error');
    return result(args.query === '中央公园' ? [poi('a')] : args.query === '夫子庙' ? [{ ...poi('b', '夫子庙', '南京'), openingHours: { status: 'reported', text: '09:00–17:00', providerUpdatedAt: '2026-10-14T01:00:00Z' } }] : []);
  });
  assert.ok(maximum <= 3);
  assert.equal(calls.filter(call => call === '上海:中央公园').length, 1);
  assert.deepEqual(matched.route.stops.map(stop => stop.poiId), ['a', 'b']);
  assert.deepEqual(matched.proposal.stops.map(stop => stop.status), ['substituted', 'substituted', 'unresolved']);
  assert.equal(matched.proposal.stops[1].attempts[0].status, 'duplicate');
  assert.equal(matched.proposal.stops[2].attempts[0].status, 'service_error');
  assert.equal(matched.route.stops[0].openingHours.status, 'unknown');
  matched.route.proposal.apiKey = 'secret'; matched.route.proposal.stops[0].attempts[0].apiKey = 'secret';
  matched.route.stops[0].selection.apiKey = 'secret';
  const trip = createItinerary(matched.route, resolveTripContext(), { source: 'deepseek', poiSource: 'ctrip' });
  assert.equal(JSON.stringify(trip).includes('secret'), false);
  assert.equal(trip.stops[0].proposalCandidateId, trip.proposal.stops[0].id);
  const location = trip.evidence.find(item => item.field === 'location');
  assert.equal(location.retrievedAt, retrievedAt);
  assert.equal(location.providerUpdatedAt, null); assert.equal(location.verifiedAt, null);
  assert.equal(trip.stops[1].openingHours.status, 'reported');
  assert.equal(trip.stops[1].schedule.status, 'unknown');
});

test('MCP matchTarget and nonwalking/multiday discovery do not apply walking radius', async () => {
  const calls = [];
  const options = { token: 'test', coordinateSystem: 'wgs84', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body.params.arguments);
    const products = [31, 32].map((lat, index) => ({ basicInfo: { name: '公园', cityName: '上海' }, additionalInfo: { poiId: index + 1, coordinate: { lat, lng: 121 } } }));
    return new Response(JSON.stringify({ id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(products) }] } }));
  } };
  for (const args of [{ city: '上海', matchTarget: { name: '公园', city: '上海' }, intent: { startingPoint: '别处', maxWalkKm: 1 } }, { city: '上海', intent: { context: { transportMode: 'cycling' } } }, { city: '上海', intent: { context: { dayCount: 2 } } }]) {
    const data = await searchMcpPois(args, options); assert.equal(data.pois.length, 2);
  }
  assert.equal(calls.length, 3); assert.equal(calls[0].scenicSpotName, '公园');
});

test('HTTP pipeline proposes before MCP, returns partial matched data and traceable fallback', async t => {
  const child = spawn(process.execPath, ['--require', './test/fixtures/w02-offline.cjs', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server startup timeout')), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}`)); });
    child.stdout.on('data', buffer => { const match = buffer.toString().match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timeout); resolve(`http://localhost:${match[1]}`); } });
  });
  const post = async prompt => (await fetch(`${base}/api/generate-route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, apiKey: 'not-exported-secret', context: { dayCount: 2, transportMode: 'cycling', maxWalkKm: 1 } }) })).json();
  const data = await post('上海南京两天骑行');
  assert.equal(data.source, 'deepseek');
  assert.equal(data.route.stops.length, 3); assert.equal(data.route.poiSource, 'ctrip');
  assert.deepEqual(data.route.stops.map(stop => stop.location), [{ lat: 31.206, lng: 121.434 }, { lat: 31.216, lng: 121.55 }, { lat: 32.02, lng: 118.79 }]);
  assert.equal(data.route.context.maxWalkKm, 1);
  assert.equal(data.route.summary, 'budget=1;mode=cycling');
  assert.equal(data.route.proposal.status, 'partial');
  assert.match(data.warning, /备选/); assert.match(data.warning, /尚未唯一匹配/);
  assert.equal(data.route.evidence.filter(item => item.field === 'location').every(item => item.status === 'matched' && item.retrievedAt && item.providerUpdatedAt === null), true);
  assert.equal(data.route.evidence.filter(item => item.field === 'openingHours').every(item => item.status === 'unknown'), true);
  assert.equal(/not-exported-secret|模型虚构|全年开放/.test(JSON.stringify(data)), false);
  const failed = await post('上海全都查不到');
  assert.equal(failed.source, 'demo-fallback'); assert.equal(failed.route.poiSource, 'mock');
  assert.equal(failed.route.proposal.status, 'partial'); assert.match(failed.warning, /并非本次需求结果/);
  assert.equal(failed.route.proposal.stops.every(slot => slot.status === 'unresolved'), true);
  const generic = await post('上海通用接口');
  assert.equal(generic.source, 'deepseek');
  assert.equal(generic.route.stops.length, 2);
  assert.equal(generic.route.stops[0].openingHours.status, 'reported');
  assert.equal(generic.route.stops[0].openingHours.verifiedAt, null);
  assert.equal(generic.route.evidence[0].providerUpdatedAt, '2026-10-15T00:00:00.000Z');
  assert.equal(JSON.stringify(generic).includes('must-be-stripped'), false);
});
