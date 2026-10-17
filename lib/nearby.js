'use strict';
const { searchNearbyMcpPois } = require('./ctrip-mcp');
const { solveTransport } = require('./transport');
const { sealPoi } = require('./conversation-route');
const { scope } = require('./agent-scope');

class NearbyInputError extends Error {}
class NearbyUnavailableError extends Error {}
function normalizeNearbyInput(body) {
  const fail = () => { throw new NearbyInputError('请填写城市、有效的 WGS84 起点、0.2–8 公里范围和交通方式'); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  if (typeof body.city !== 'string' || !body.city.trim() || body.city.length > 80 || /[<>\r\n]/.test(body.city)) fail();
  const { lat, lng } = body.origin || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) fail();
  const radiusKm = body.radiusKm === undefined ? 2 : body.radiusKm;
  const mode = body.mode === undefined ? 'walking' : body.mode;
  if (!Number.isFinite(radiusKm) || radiusKm < .2 || radiusKm > 8 || !['walking', 'cycling', 'driving', 'taxi', 'transit'].includes(mode)) fail();
  return { city: body.city.trim().replace(/市$/, ''), origin: { lat, lng }, radiusKm, mode };
}

async function discoverNearby(body, { signal, ...options } = {}) {
  const input = normalizeNearbyInput(body);
  if (!(options.token ?? process.env.CTRIP_MCP_TOKEN)) throw new NearbyUnavailableError('附近发现需要服务端配置携程 MCP，目前未配置；没有使用示例地点代替');
  // Reuse request-scoped cancellation and upstream timeout composition. One POI
  // query plus at most six road queries; no model or synthetic place lookup.
  const run = { signal, usage: { networkCalls: 0 }, limits: { networkCalls: 7 }, check() { if (signal?.aborted) throw new Error('cancelled'); } };
  return scope.run(run, async () => {
    run.check();
    const result = await searchNearbyMcpPois(input, options);
    run.check();
    const stops = [{ id: 'nearby-origin', city: input.city, location: input.origin }, ...result.pois];
    const legs = result.pois.map(p => ({ id: `nearby-${p.id}`, dayId: 'nearby-day', fromStopId: 'nearby-origin', toStopId: p.id, preferredMode: input.mode }));
    const roads = legs.length ? await solveTransport({ stops, legs, context: {} }, options) : { legs: [] };
    run.check();
    return { ...result, origin: input.origin, radiusKm: input.radiusKm, mode: input.mode,
      pois: result.pois.map((p, i) => ({ ...sealPoi(p), travel: roads.legs[i] })),
      message: result.pois.length ? '附近地点来自携程。范围和直线距离按坐标计算；前往耗时请区分道路预计、粗估与未知。检索不代表收录全部附近地点。' : '携程未返回所选城市及范围内的有效地点；可调整城市、起点或范围。没有使用示例地点代替。' };
  });
}
module.exports = { normalizeNearbyInput, discoverNearby, NearbyInputError, NearbyUnavailableError };
