const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { normalizeTripInput, resolveTripContext, applyTripContext, createItinerary } = require('../lib/itinerary');

test('valid dates/numbers normalize; invalid and ambiguous values are rejected', () => {
  assert.deepEqual(normalizeTripInput({ startDate: '2028-02-29', dayCount: '2', maxWalkKm: '0', companions: ['children', 'children', 'seniors'], apiKey: 'do-not-copy' }), { startDate: '2028-02-29', dayCount: 2, maxWalkKm: 0, companions: ['children', 'seniors'] });
  for (const input of [null, [], { startDate: '2026-02-29' }, { startDate: '2026-04-31' }, { startDate: '2026-13-01' }, { dayCount: 0 }, { dayCount: 1.5 }, { dayCount: true }, { dayCount: 15 }, { maxWalkKm: -1 }, { maxWalkKm: 'NaN' }, { maxWalkKm: Infinity }, { maxWalkKm: [] }, { dailyStartTime: '24:00' }, { dailyStartTime: '17:00', dailyEndTime: '17:00' }, { transportMode: 'plane' }, { companions: ['none', 'children'] }]) {
    assert.throws(() => normalizeTripInput(input), { name: 'Error' }, JSON.stringify(input));
  }
});

test('explicit zero/time window overrides intent; unknowns remain unknown', () => {
  const intent = { maxWalkKm: 8, durationMinutes: 120 };
  const context = resolveTripContext({ maxWalkKm: 0, dailyStartTime: '09:30', dailyEndTime: '18:00' }, intent);
  const merged = applyTripContext(intent, context);
  assert.equal(merged.maxWalkKm, 0);
  assert.equal(merged.durationMinutes, 510);
  assert.equal(context.fieldSources.maxWalkKm, 'user');
  assert.equal(resolveTripContext({}, intent).fieldSources.maxWalkKm, 'intent');
  assert.equal(resolveTripContext().maxWalkKm, null);
  assert.equal(resolveTripContext().startDate, null);
  assert.equal(resolveTripContext().fieldSources.transportMode, 'default');
});

test('contract identities/references survive serialization and reorder; no invented facts or credentials', () => {
  const secret = 'secret-not-in-export';
  const old = { city: '南京', title: '旧路线', apiKey: secret, stops: [{ id: 'stop-1', name: 'A', time: '15:00', location: { lat: 32, lng: 118, token: secret }, apiKey: secret }, { id: 'stop-2', name: 'B', location: { lat: 32.1, lng: 118.1 } }] };
  const route = createItinerary(old, resolveTripContext({ startDate: '2028-02-28', dayCount: 3, token: secret }));
  assert.equal(JSON.stringify(route).includes(secret), false);
  assert.deepEqual(route.days.map(day => day.date), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.equal(route.days[2].status, 'unplanned');
  assert.equal(route.days[1].stopIds.length, 1);
  assert.equal(route.legs[0].durationMinutes, null);
  assert.equal(route.legs[0].mode, null);
  assert.equal(route.stops[0].schedule.arrival, null);
  assert.equal(route.stops[0].time, '15:00');
  const copy = JSON.parse(JSON.stringify(route));
  copy.stops.reverse();
  assert.equal(copy.stops[1].id, route.days[0].stopIds[0]);
  assert.equal(copy.legs[0].fromStopId, copy.stops[1].id);
  assert.ok(copy.stops.every(stop => stop.evidenceIds.every(id => copy.evidence.some(item => item.id === id))));
  assert.equal(route.revision.number, 1);
});

test('HTTP compatibility, validation before generation, explicit priority and failure fallback', async t => {
  const child = spawn(process.execPath, ['--require', './test/fixtures/w01-offline.cjs', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start')), 10000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited ${code}`)); });
    child.stdout.on('data', buffer => {
      const match = buffer.toString().match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://localhost:${match[1]}`); }
    });
  });
  const post = body => fetch(`${base}/api/generate-route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const city of ['北京', '上海', '南京']) {
    const oldResponse = await post({ prompt: `${city}逛逛`, apiKey: '' });
    const data = await oldResponse.json();
    assert.equal(oldResponse.status, 200);
    assert.equal(data.source, 'demo');
    assert.equal(data.route.city, city);
    assert.equal(data.route.stops.length, 4);
    assert.equal(data.route.schemaVersion, 1);
    assert.equal(data.route.context.maxWalkKm, null);
    const demo = await (await fetch(`${base}/api/demo-route?city=${encodeURIComponent(city)}`)).json();
    assert.equal(demo.route.city, city);
    assert.equal(demo.route.days[0].stopIds.length, 4);
  }
  const invalid = await post({ prompt: '上海', apiKey: 'fail-fixture', context: { startDate: '2026-02-29' } });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).field, 'startDate');
  const data = await (await post({ prompt: '上海走八公里两小时', apiKey: 'test-secret', context: { dayCount: 2, dailyStartTime: '09:00', dailyEndTime: '18:00', maxWalkKm: 0, transportMode: 'taxi', apiKey: 'nested-secret' } })).json();
  assert.equal(data.source, 'deepseek'); // Stubbed model, not a live-service test.
  assert.equal(data.route.summary, 'budget=0;minutes=540;mode=taxi');
  assert.equal(data.route.context.maxWalkKm, 0);
  assert.equal(data.route.context.fieldSources.maxWalkKm, 'user');
  assert.equal(data.route.days.length, 2);
  assert.equal(/test-secret|nested-secret/.test(JSON.stringify(data)), false);
  const failure = await (await post({ prompt: '北京', apiKey: 'fail-fixture', context: { dayCount: 3, maxWalkKm: 2 } })).json();
  assert.equal(failure.source, 'demo-fallback');
  assert.equal(failure.route.context.dayCount, 3);
  assert.equal(failure.route.context.maxWalkKm, 2);
});
