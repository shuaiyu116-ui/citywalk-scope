'use strict';
const { scopedFetch } = require('./agent-scope');

const ENDPOINT = 'https://u.ctrip.com/faas/mcp';
let requestId = 0;

function parseRpcResponse(text, id) {
  const frames = text.trim().startsWith('{')
    ? [JSON.parse(text)]
    : text.replace(/\r\n/g, '\n').split('\n\n').flatMap(frame => {
      const data = frame.split('\n').filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      return data ? [JSON.parse(data)] : [];
    });
  const reply = frames.find(frame => frame.id === id);
  // Never forward upstream errors: they may include credentials or request headers.
  if (!reply || reply.error) throw new Error('携程 MCP 响应失败');
  if (reply.result?.isError) throw new Error('携程 MCP 工具查询失败');
  if (!reply.result) throw new Error('携程 MCP 响应缺少结果');
  return reply.result;
}

async function callTool(name, args, { token = process.env.CTRIP_MCP_TOKEN, fetchImpl = scopedFetch } = {}) {
  if (!token || /[\r\n]/.test(token)) throw new Error('未配置有效的携程 MCP Token');
  const id = ++requestId;
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(12000),
      redirect: 'error'
    });
    if (!response.ok) throw new Error('HTTP failure');
    return parseRpcResponse(await response.text(), id);
  } catch {
    throw new Error('携程 MCP 查询失败，请检查服务端 Token 或稍后重试');
  }
}

function readProducts(result) {
  const products = [];
  for (const part of result.content || []) {
    if (part.type !== 'text') continue;
    try {
      const value = JSON.parse(part.text);
      if (Array.isArray(value)) products.push(...value);
    } catch { /* Plain text/search links do not constitute geolocated POIs. */ }
  }
  return products;
}

function wgs84ToGcj02({ lat, lng }) {
  if (lat < 0.8293 || lat > 55.8271 || lng < 72.004 || lng > 137.8347) return { lat, lng };
  const pi = Math.PI;
  const x = lng - 105;
  const y = lat - 35;
  let dLat = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  let dLng = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  const shared = (20*Math.sin(6*x*pi) + 20*Math.sin(2*x*pi))*2/3;
  dLat += shared + (20*Math.sin(y*pi) + 40*Math.sin(y/3*pi))*2/3 + (160*Math.sin(y/12*pi) + 320*Math.sin(y*pi/30))*2/3;
  dLng += shared + (20*Math.sin(x*pi) + 40*Math.sin(x/3*pi))*2/3 + (150*Math.sin(x/12*pi) + 300*Math.sin(x/30*pi))*2/3;
  const rad = lat*pi/180;
  const magic = 1 - 0.00669342162296594323*Math.sin(rad)**2;
  return {
    lat: lat + dLat*180/((6378245*(1-0.00669342162296594323))/(magic*Math.sqrt(magic))*pi),
    lng: lng + dLng*180/(6378245/Math.sqrt(magic)*Math.cos(rad)*pi)
  };
}

function gcj02ToWgs84(point) {
  let result = { ...point };
  for (let i = 0; i < 4; i++) {
    const projected = wgs84ToGcj02(result);
    result = { lat: result.lat + point.lat - projected.lat, lng: result.lng + point.lng - projected.lng };
  }
  return result;
}

function cleanText(value, max = 500) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\\n|\s+/g, ' ').trim().slice(0, max) : '';
}

function safeUrl(value, image = false) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    const allowed = image ? host.endsWith('.c-ctrip.com') : host.endsWith('.ctrip.com');
    return url.protocol === 'https:' && allowed && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function normalizeProducts(products, city, coordinateSystem = 'gcj02', { retrievedAt = null } = {}) {
  if (!['gcj02', 'wgs84'].includes(coordinateSystem)) throw new Error('CTRIP_MCP_COORDINATE_SYSTEM 只能为 gcj02 或 wgs84');
  const seen = new Set();
  return products.slice(0, 60).flatMap(product => {
    const basic = product?.basicInfo;
    const extra = product?.additionalInfo;
    const raw = extra?.coordinate;
    const name = cleanText(basic?.name, 120);
    const id = extra?.poiId;
    if (!name || !id || basic.available === false || !raw) return [];
    if (city && cleanText(basic.cityName).replace(/市$/, '') !== city.replace(/市$/, '')) return [];
    if (raw.lat == null || raw.lng == null || raw.lat === '' || raw.lng === '') return [];
    const point = { lat: Number(raw.lat), lng: Number(raw.lng) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180 || (point.lat === 0 && point.lng === 0)) return [];
    const key = `ctrip-${id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const image = safeUrl(basic.imageURL, true);
    const detailUrl = safeUrl(product.urlInfo?.h5Url) || safeUrl(product.urlInfo?.pcUrl);
    const tags = Array.isArray(extra.addTags) ? extra.addTags : [];
    return [{
      id: key, name, city: cleanText(basic.cityName, 80).replace(/市$/, ''),
      source: 'ctrip', provider: 'ctrip-mcp', retrievedAt, providerUpdatedAt: null,
      // query_ticket's documented/observed fields do not establish current
      // opening hours or a provider fact-update time. Product availability and
      // ticket descriptions are not evidence that the attraction is open.
      openingHours: { status: 'unknown', text: null, source: null, url: null, retrievedAt: null, providerUpdatedAt: null, verifiedAt: null },
      type: tags.map(t => cleanText(t, 40)).filter(Boolean).slice(0, 2).join(' · ') || '景点',
      note: cleanText(extra.pmRecommand || extra.introduce),
      location: coordinateSystem === 'gcj02' ? gcj02ToWgs84(point) : point,
      coordinateSource: `ctrip-mcp-${coordinateSystem}`, coordinateSystem: 'wgs84',
      address: cleanText(basic.address, 200), detailUrl,
      image, imageSource: image ? '携程 MCP 景点图片' : '',
      imageKind: image ? 'location-photo' : '', imageTitle: name,
      imagePageUrl: image ? detailUrl : '', imageAttribution: image ? '携程 · 查看地点详情' : ''
    }];
  });
}

function distanceKm(a, b) {
  const rad = x => x*Math.PI/180;
  const h = Math.sin(rad(b.lat-a.lat)/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
  return 12742*Math.asin(Math.sqrt(Math.min(1, h)));
}

async function searchMcpPois({ city, intent = {}, placeName, matchMode = 'nearby', matchTarget }, options = {}) {
  if (matchTarget) { city = matchTarget.city; placeName = matchTarget.name; matchMode = 'identity'; }
  const cityName = cleanText(city, 80).replace(/市$/, '');
  if (!cityName) throw new Error('请指定要查询的城市');
  const coordinateSystem = options.coordinateSystem || process.env.CTRIP_MCP_COORDINATE_SYSTEM || 'gcj02';
  const requested = cleanText(placeName || intent.startingPoint || intent.requestedPlaces?.[0], 120);
  if (matchMode === 'identity' && !requested) throw new Error('地点匹配查询需要地点名称');
  const args = { cityName, resourceSize: 1, ...(requested ? { scenicSpotName: requested } : {}) };
  const result = await callTool('query_ticket', args, options);
  const retrievedAt = new Date().toISOString();
  let pois = normalizeProducts(readProducts(result), cityName, coordinateSystem, { retrievedAt });
  if (!pois.length) return { source: 'ctrip', provider: 'ctrip-mcp', retrievedAt, providerUpdatedAt: null, pois: [] };
  // Identity lookup deliberately retains all same-city candidates for the
  // downstream matcher to disambiguate. A walking-radius heuristic would drop
  // valid proposals for cycling, multi-day or cross-city trips.
  if (matchMode === 'identity' || (intent.context?.transportMode && intent.context.transportMode !== 'walking') || intent.context?.dayCount > 1) {
    return { source: 'ctrip', provider: 'ctrip-mcp', retrievedAt, providerUpdatedAt: null, pois,
      message: '已按城市和地点名查询携程候选；身份匹配与开放状态分别处理。' };
  }
  const radius = Math.min(8, Math.max(1, Number(intent.maxWalkKm) || 4));
  // City-wide results include distant theme parks. Pick an urban cluster, then
  // query nearby candidates rather than handing a cross-city tour to the model.
  const anchor = (requested && pois.find(p => p.name.includes(requested) || requested.includes(p.name)))
    || [...pois].sort((a, b) =>
      pois.filter(p => distanceKm(b.location, p.location) <= radius).length -
      pois.filter(p => distanceKm(a.location, p.location) <= radius).length)[0];
  let warning;
  try {
    const point = coordinateSystem === 'gcj02' ? wgs84ToGcj02(anchor.location) : anchor.location;
    const nearby = await callTool('query_ticket', { cityName, latitude: point.lat, longitude: point.lng, resourceSize: 1 }, options);
    pois = [...pois, ...normalizeProducts(readProducts(nearby), cityName, coordinateSystem, { retrievedAt: new Date().toISOString() })];
  } catch { warning = '附近地点补充查询暂不可用，当前使用已取得的携程地点。'; }
  const unique = new Map(pois.map(p => [p.id, p]));
  pois = [...unique.values()].filter(p => distanceKm(anchor.location, p.location) <= radius)
    .sort((a, b) => distanceKm(anchor.location, a.location) - distanceKm(anchor.location, b.location)).slice(0, 20);
  return { source: 'ctrip', provider: 'ctrip-mcp', retrievedAt, providerUpdatedAt: null, pois, message: '地点和图片来自携程 MCP 实时查询。', ...(warning ? { warning } : {}) };
}

// Unlike the legacy city-cluster search, discovery is anchored to the user's
// explicit WGS84 position. Empty/error results must never become demo places.
async function searchNearbyMcpPois({ city, origin, radiusKm }, options = {}) {
  const coordinateSystem = options.coordinateSystem || process.env.CTRIP_MCP_COORDINATE_SYSTEM || 'gcj02';
  if (!['gcj02', 'wgs84'].includes(coordinateSystem)) throw new Error('携程坐标配置无效');
  const point = coordinateSystem === 'gcj02' ? wgs84ToGcj02(origin) : origin;
  const result = await callTool('query_ticket', { cityName: city, latitude: point.lat, longitude: point.lng, resourceSize: 1 }, options);
  const retrievedAt = new Date().toISOString();
  const pois = normalizeProducts(readProducts(result), city, coordinateSystem, { retrievedAt })
    .map(p => ({ ...p, straightLineMeters: Math.round(distanceKm(origin, p.location) * 1000) }))
    .filter(p => distanceKm(origin, p.location) <= radiusKm)
    .sort((a, b) => a.straightLineMeters - b.straightLineMeters).slice(0, 6);
  return { source: 'ctrip', provider: 'ctrip-mcp', retrievedAt, coordinateSystem: 'wgs84', pois };
}

module.exports = { callTool, parseRpcResponse, readProducts, normalizeProducts, searchMcpPois, searchNearbyMcpPois, gcj02ToWgs84, wgs84ToGcj02 };
