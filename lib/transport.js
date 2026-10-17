'use strict';

const MODES = ['walking', 'cycling', 'driving', 'taxi', 'transit', 'mixed'];
const COSTING = { walking: 'pedestrian', cycling: 'bicycle', driving: 'auto', taxi: 'auto' };
class TransportInputError extends Error {}
const fail = () => { throw new TransportInputError('交通请求中的地点、路段或方式无效'); };
const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 100;
function normalizeTransportInput(body) {
  if (!body || !Array.isArray(body.stops) || body.stops.length < 2 || body.stops.length > 50 || !Array.isArray(body.legs) || body.legs.length > 49) fail();
  const stops = body.stops.map(s => {
    const point = [s?.location?.lat, s?.location?.lng];
    if (!id(s?.id) || !validPoint(point) || typeof s.city !== 'string' || s.city.length > 80) fail();
    return { id: s.id, city: s.city, point };
  });
  const byId = new Map(stops.map(s => [s.id, s]));
  if (byId.size !== stops.length) fail();
  const legs = body.legs.map(l => {
    if (!id(l?.id) || !id(l.dayId) || !byId.has(l.fromStopId) || !byId.has(l.toStopId) || l.fromStopId === l.toStopId || !MODES.includes(l.preferredMode)) fail();
    return { id: l.id, dayId: l.dayId, fromStopId: l.fromStopId, toStopId: l.toStopId, preferredMode: l.preferredMode };
  });
  if (new Set(legs.map(l => l.id)).size !== legs.length) fail();
  const maxWalkKm = body.context?.maxWalkKm ?? null;
  if (maxWalkKm !== null && (!Number.isFinite(maxWalkKm) || maxWalkKm < 0 || maxWalkKm > 50)) fail();
  return { stops: byId, legs, maxWalkKm };
}

function meters(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function decodePolyline(encoded) {
  if (typeof encoded !== 'string' || !encoded || encoded.length > 500000) throw new Error('Invalid shape');
  let offset = 0, lat = 0, lng = 0;
  const points = [];
  const number = () => {
    let result = 0, shift = 0, byte;
    do {
      if (offset >= encoded.length || shift > 30) throw new Error('Invalid shape');
      byte = encoded.charCodeAt(offset++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid shape');
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (offset < encoded.length) {
    lat += number(); lng += number();
    const point = [lat / 1e6, lng / 1e6];
    if (!validPoint(point)) throw new Error('Invalid coordinates');
    points.push(point);
  }
  return points;
}

async function routeRoad(from, to, mode, fetchImpl = fetch) {
  // WALKING_ROUTER_URL remains a walking-only compatibility override.
  const url = process.env.TRANSPORT_ROUTER_URL || (mode === 'walking' && process.env.WALKING_ROUTER_URL) || 'https://valhalla1.openstreetmap.de/route';
  const response = await fetchImpl(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: [from, to].map(([lat, lon]) => ({ lat, lon })), costing: COSTING[mode], units: 'kilometers' }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('Router unavailable');
  const trip = (await response.json())?.trip;
  const distance = trip?.summary?.length, seconds = trip?.summary?.time;
  if (!Array.isArray(trip?.legs) || !trip.legs.length || !Number.isFinite(distance) || distance < 0 || !Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid summary');
  const coordinates = trip.legs.flatMap((leg, i) => { const p = decodePolyline(leg.shape); return i ? p.slice(1) : p; });
  if (coordinates.length < 2 || meters(coordinates[0], from) > 1000 || meters(coordinates.at(-1), to) > 1000 || distance * 1000 < meters(from, to) * 0.8) throw new Error('Invalid route');
  return { geometry: { type: 'LineString', coordinateSystem: 'wgs84', coordinateOrder: 'lat-lng', kind: 'road', coordinates }, distanceMeters: Math.round(distance * 1000), durationMinutes: Math.ceil(seconds / 60) };
}

async function solveTransport(body, { fetchImpl = require('./agent-scope').scopedFetch, now = () => new Date().toISOString() } = {}) {
  const input = normalizeTransportInput(body);
  // Deterministic mixed selection in route order, with a provisional daily walking
  // allowance. This is not a hard budget guarantee; W04 checks routed distances.
  const walkingUsed = new Map();
  const plans = input.legs.map(leg => {
    const from = input.stops.get(leg.fromStopId), to = input.stops.get(leg.toStopId);
    const straight = meters(from.point, to.point);
    const crossCity = !from.city || !to.city || from.city.replace(/市$/, '') !== to.city.replace(/市$/, '');
    let mode = leg.preferredMode;
    let selectionReason = '采用本段交通偏好';
    if (mode === 'mixed') {
      const used = walkingUsed.get(leg.dayId) || 0;
      mode = !crossCity && straight <= 1500 && (input.maxWalkKm === null || used + straight * 1.3 <= input.maxWalkKm * 1000) ? 'walking' : 'taxi';
      if (mode === 'walking') walkingUsed.set(leg.dayId, used + straight * 1.3);
      selectionReason = mode === 'walking' ? '混合建议：短途步行（按直线距离与暂估步行预算选择）' : '混合建议：较远路段或步行预算不足，采用打车；不含候车';
    }
    const unsupported = mode === 'transit' ? '未接入公交时刻与换乘数据，请另行确认' : crossCity && !['driving', 'taxi'].includes(leg.preferredMode) ? '跨城移动待安排；需选择交通方式或在后续分日安排中填写交通' : null;
    return { leg, from, to, straight, mode, selectionReason, unsupported, crossCity };
  });
  const results = new Array(plans.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, plans.length) }, async () => {
    while (cursor < plans.length) {
      const index = cursor++, p = plans[index];
      const base = { ...p.leg, mode: p.unsupported ? null : p.mode, selectionReason: p.selectionReason, status: 'unavailable', geometry: null, distanceMeters: null, durationMinutes: null, source: null, retrievedAt: null, attemptedAt: null, computedAt: now(), evidenceIds: [], warning: p.unsupported, routingStatus: 'unsupported', routingSource: null };
      if (!p.unsupported) {
        base.attemptedAt = now(); base.routingSource = 'valhalla';
        try {
          const road = await routeRoad(p.from.point, p.to.point, p.mode, fetchImpl);
          Object.assign(base, road, { status: 'routed', routingStatus: 'success', source: 'valhalla', retrievedAt: now(), warning: p.mode === 'taxi' ? '道路预计耗时，不含候车、实时拥堵与上下车步行' : p.mode === 'driving' ? '道路预计耗时，不含实时拥堵、停车与停车后步行' : '道路模型预计耗时；通行限制与现场情况仍需确认' });
        } catch {
          Object.assign(base, { routingStatus: 'failed', warning: '道路服务不可用，不能确认实际通行' });
          // No straight-line travel-time claim for long/cross-city journeys.
          if (!p.crossCity && p.straight <= 50000) {
            const factor = p.mode === 'walking' ? 1.3 : p.mode === 'cycling' ? 1.35 : 1.4;
            const speedKmh = { walking: 4.5, cycling: 15, driving: 25, taxi: 25 }[p.mode];
            const distanceMeters = Math.round(p.straight * factor);
            Object.assign(base, { status: 'estimated', source: 'local-estimate', geometry: { type: 'LineString', coordinateSystem: 'wgs84', coordinateOrder: 'lat-lng', kind: 'straight-line', coordinates: [p.from.point, p.to.point] }, distanceMeters, durationMinutes: Math.ceil(distanceMeters / (speedKmh * 1000 / 60)), estimate: { straightLineMeters: Math.round(p.straight), detourFactor: factor, speedKmh }, warning: '粗估：直线距离乘绕行系数及固定速度；未验证通行，不含候车、停车、拥堵或换乘' });
          }
        }
      }
      results[index] = base;
    }
  }));
  return { legs: results };
}
module.exports = { TransportInputError, solveTransport, routeRoad, decodePolyline };
