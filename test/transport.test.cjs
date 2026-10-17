const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { solveTransport, TransportInputError, routeRoad } = require('../lib/transport');
const { createItinerary, resolveTripContext } = require('../lib/itinerary');
// Avoid importing the preload into this process: it intentionally overrides fetch.
function encode(points) {
  let previous = [0, 0], output = '';
  for (const point of points) for (let i = 0; i < 2; i++) {
    const n = Math.round(point[i] * 1e6), delta = n - previous[i]; previous[i] = n;
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 32) { output += String.fromCharCode((value & 31) + 95); value >>>= 5; }
    output += String.fromCharCode(value + 63);
  }
  return output;
}
const make = (mode = 'walking') => createItinerary({ city: '上海', stops: [0, .001, .021].map((n, i) => ({ name: `P${i}`, city: '上海', location: { lat: 31 + n, lng: 121 } })) }, resolveTripContext({ transportMode: mode, dayCount: 2 }));
const success = calls => async (_, options) => {
  const body = JSON.parse(options.body); calls.push(body);
  const points = body.locations.map(l => [l.lat, l.lon]);
  return new Response(JSON.stringify({ trip: { summary: { length: Math.abs(points[1][0] - points[0][0]) * 130, time: 600 }, legs: [{ shape: encode(points) }] } }));
};

test('mode-specific routing, WGS84 geometry, stable IDs and guarded input', async () => {
  const { transportRequest } = await import('../public/transport.mjs');
  for (const [mode, costing] of Object.entries({ walking: 'pedestrian', cycling: 'bicycle', driving: 'auto', taxi: 'auto' })) {
    const route = make(mode), calls = [];
    const request = transportRequest(route);
    const result = await solveTransport({ ...request, apiKey: 'secret' }, { fetchImpl: success(calls) });
    assert.ok(calls.every(c => c.costing === costing));
    assert.equal(result.legs[0].mode, mode);
    assert.equal(result.legs[0].id, route.legs[0].id);
    assert.equal(result.legs[0].status, 'routed');
    assert.deepEqual(result.legs[0].geometry.coordinates[0], [31, 121]);
    assert.equal(result.legs[0].geometry.coordinateOrder, 'lat-lng');
    assert.ok(result.legs[0].retrievedAt);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  const body = transportRequest(make()); body.stops[0].location.lat = null;
  await assert.rejects(solveTransport(body), TransportInputError);
  const wrongMode = transportRequest(make()); wrongMode.legs[0].preferredMode = 'plane';
  await assert.rejects(solveTransport(wrongMode), TransportInputError);
});

test('mixed budget selection, unavailable transit/cross-city, transparent fallback and invalid upstream', async () => {
  const { transportRequest } = await import('../public/transport.mjs');
  const route = make('mixed'), calls = [];
  const result = await solveTransport(transportRequest(route), { fetchImpl: success(calls) });
  assert.deepEqual(result.legs.map(l => l.mode), ['walking', 'taxi']);
  const zero = transportRequest(route); zero.context.maxWalkKm = 0;
  assert.ok((await solveTransport(zero, { fetchImpl: success([]) })).legs.every(l => l.mode === 'taxi'));
  const outage = async () => { throw new Error('secret upstream failure'); };
  const fallback = await solveTransport(transportRequest(make('cycling')), { fetchImpl: outage });
  assert.equal(fallback.legs[0].status, 'estimated');
  assert.equal(fallback.legs[0].retrievedAt, null);
  assert.equal(fallback.legs[0].routingStatus, 'failed');
  assert.equal(fallback.legs[0].estimate.speedKmh, 15);
  assert.equal(fallback.legs[0].geometry.kind, 'straight-line');
  assert.ok(!JSON.stringify(fallback).includes('secret'));
  for (const mode of ['mixed', 'walking', 'cycling', 'transit']) {
    const input = transportRequest(make(mode)); input.stops[1].city = '南京';
    const answer = await solveTransport(input, { fetchImpl: () => { assert.fail('unsupported must not call road router'); } });
    assert.ok(answer.legs.every(l => l.status === 'unavailable' && l.durationMinutes === null && l.geometry === null && l.mode === null));
  }
  const driving = transportRequest(make('driving')); driving.stops[1].city = '南京';
  assert.ok((await solveTransport(driving, { fetchImpl: outage })).legs.every(l => l.status === 'unavailable'));
  await assert.rejects(routeRoad([31, 121], [31.01, 121], 'walking', async () => new Response(JSON.stringify({ trip: { summary: {}, legs: [{ shape: 'bad' }] } }))));
});

test('shared render geometry, daily incomplete totals and stale/reordered response rejection', async () => {
  const { transportRequest, transportFingerprint, mergeTransport, transportSegments, summarizeLegs } = await import('../public/transport.mjs');
  const route = make('mixed'), fingerprint = transportFingerprint(route);
  const result = await solveTransport(transportRequest(route), { fetchImpl: success([]) });
  const edited = structuredClone(route); edited.legs[0].preferredMode = 'cycling';
  assert.equal(mergeTransport(edited, result, fingerprint), false);
  const moved = structuredClone(route); moved.stops[0].location.lng += .1;
  assert.equal(mergeTransport(moved, result, fingerprint), false);
  result.legs.reverse();
  assert.ok(mergeTransport(route, result, fingerprint));
  assert.deepEqual(route.legs.map(l => l.mode), ['walking', 'taxi']);
  assert.equal(route.days[0].transport.durationMinutes, 20);
  assert.equal(route.days[1].transport.legCount, 0);
  assert.equal(transportSegments(route)[0].coordinates, route.legs[0].geometry.coordinates);
  route.legs[1] = { ...route.legs[1], status: 'unavailable', durationMinutes: null, geometry: null };
  const total = summarizeLegs(route.legs);
  assert.equal(total.durationMinutes, 10); assert.equal(total.unknownCount, 1);
  assert.equal(transportSegments(route)[1].illustrative, true);
});

test('local HTTP generation → transport → portable contract; legacy walking compatibility', async t => {
  const child = spawn(process.execPath, ['--require', './test/fixtures/w03-offline.cjs', 'server.js'], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, PORT: '0', TRANSPORT_ROUTER_URL: 'https://router.invalid/route', WALKING_ROUTER_URL: 'https://router.invalid/route' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    child.once('error', reject);
    child.stdout.on('data', buffer => { const m = buffer.toString().match(/localhost:(\d+)/); if (m) { clearTimeout(timeout); resolve(`http://localhost:${m[1]}`); } });
  });
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const { route } = await (await post('/api/generate-route', { prompt: '上海', context: { transportMode: 'cycling' } })).json();
  const { transportRequest, transportFingerprint, mergeTransport } = await import('../public/transport.mjs');
  const response = await post('/api/transport-route', transportRequest(route));
  assert.equal(response.status, 200);
  assert.ok(mergeTransport(route, await response.json(), transportFingerprint(route)));
  assert.ok(route.legs.every(l => l.status === 'estimated' && l.mode === 'cycling'));
  assert.equal((await post('/api/transport-route', { legs: [] })).status, 400);
  const old = await post('/api/walking-route', { points: [[31, 121], [31.001, 121]] });
  assert.equal(old.status, 200); assert.equal((await old.json()).walkingPath.status, 'routed');
});
