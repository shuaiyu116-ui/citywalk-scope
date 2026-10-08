const http = require('http');
const fs = require('fs');
const path = require('path');
const { findLocationImage } = require('./lib/location-images');
const { getLocationPhotoBytes } = require('./lib/location-photo-proxy');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const SCENE_IMAGES = [
  '/assets/scene-landmark.jpg',
  '/assets/scene-street.jpg',
  '/assets/scene-cafe.jpg',
  '/assets/scene-evening.jpg'
];
const SCENE_IMAGE_SOURCE = '本地演示参考图（来源说明见素材页）';
const SCENE_IMAGE_META = [
  {
    imagePageUrl: 'https://commons.wikimedia.org/wiki/File:Wukang_Mansion_20250504-2.jpg',
    imageAttribution: 'Suicasmo · CC0 1.0'
  },
  {
    imagePageUrl: 'https://commons.wikimedia.org/wiki/File:Wukang_Road,_Shanghai,_May_2016.JPG',
    imageAttribution: 'SSYoung · CC BY-SA 4.0'
  },
  {
    imagePageUrl: 'https://commons.wikimedia.org/wiki/File:A_brunch_spot_at_Anfu_Rd.jpg',
    imageAttribution: 'RunningTurtle8964 · CC0 1.0'
  },
  {
    imagePageUrl: 'https://commons.wikimedia.org/wiki/File:Wulumuqi_Rd._(M),_Shanghai_20251228_01.jpg',
    imageAttribution: 'Vesekskiy · CC BY-SA 4.0'
  }
];

const demoRoute = {
  city: '上海',
  title: '下午的梧桐线，走到乌鲁木齐中路',
  summary: '从武康大楼出发，沿武康路和安福路慢慢向北，最后在乌鲁木齐中路收住下午的光。',
  duration: '约 2 小时',
  distance: '约 2.2 km',
  mood: '松弛 · 人文 · 适合拍照',
  color: '#e26d4d',
  stops: [
    { id: 'wukang-building', time: '15:00', name: '武康大楼', type: '城市地标', note: '从建筑的弧线开始，把下午的第一段时间留给街角立面和树影。', location: { lat: 31.2062561, lng: 121.4337292 }, coordinateStatus: '地图参考坐标', coordinateSource: '国内地图坐标参考', image: SCENE_IMAGES[0], imageSource: SCENE_IMAGE_SOURCE, imageKind: 'location-photo', ...SCENE_IMAGE_META[0], accent: '#e26d4d' },
    { id: 'wukang-road', time: '15:25', name: '武康路梧桐段', type: '散步路段', note: '沿梧桐树影向北走，留意老洋房门牌和临街的小店。', location: { lat: 31.2079627, lng: 121.4345823 }, coordinateStatus: '地图参考坐标', coordinateSource: '国内地图坐标参考', image: SCENE_IMAGES[1], imageSource: SCENE_IMAGE_SOURCE, imageKind: 'location-photo', ...SCENE_IMAGE_META[1], accent: '#86a87b' },
    { id: 'anfu-road', time: '16:05', name: '安福路转角', type: '生活方式', note: '在安福路放慢脚步，给橱窗、咖啡和临街座位留一点即兴时间。', location: { lat: 31.2156179, lng: 121.4380352 }, coordinateStatus: '地图参考坐标', coordinateSource: '国内地图坐标参考', image: SCENE_IMAGES[2], imageSource: SCENE_IMAGE_SOURCE, imageKind: 'location-photo', ...SCENE_IMAGE_META[2], accent: '#d7a85d' },
    { id: 'urumqi-middle-road', time: '17:00', name: '乌鲁木齐中路', type: '收尾街区', note: '在乌鲁木齐中路结束这段约两小时的城市漫步，顺手记录下午最后的光。', location: { lat: 31.2167538, lng: 121.4403194 }, coordinateStatus: '地图参考坐标', coordinateSource: '国内地图坐标参考', image: SCENE_IMAGES[3], imageSource: SCENE_IMAGE_SOURCE, imageKind: 'location-photo', ...SCENE_IMAGE_META[3], accent: '#7387a6' }
  ]
};

// Local fallbacks let the judges try several representative cities without an
// API key.  Coordinates are WGS84; the browser converts them for the domestic
// GCJ-02 basemap when drawing the map.
const demoRouteVariants = {
  '北京': {
    city: '北京',
    title: '从城墙根走到胡同深处',
    summary: '从天安门广场出发，经过景山的树影，沿南锣鼓巷慢慢走到什刹海。',
    duration: '约 2 小时 15 分', distance: '约 3.4 km', mood: '人文 · 胡同 · 慢慢走', color: '#e26d4d',
    stops: [
      { id: 'tiananmen', time: '14:30', name: '天安门广场', type: '城市地标', note: '从开阔的广场开始，把城市尺度和午后的光一起收进镜头。', location: { lat: 39.9087, lng: 116.3975 }, accent: '#e26d4d' },
      { id: 'jingshan', time: '15:05', name: '景山公园', type: '城市公园', note: '登上景山南望故宫屋脊，再从林荫里下山。', location: { lat: 39.9254, lng: 116.3963 }, accent: '#86a87b' },
      { id: 'nanluoguxiang', time: '15:50', name: '南锣鼓巷', type: '胡同街区', note: '在胡同的门楼、树影和小店之间放慢脚步。', location: { lat: 39.9404, lng: 116.4036 }, accent: '#d7a85d' },
      { id: 'shichahai', time: '16:35', name: '什刹海', type: '湖畔收尾', note: '沿后海水岸收住这段漫步，让风把最后一站变得轻一点。', location: { lat: 39.9472, lng: 116.3867 }, accent: '#7387a6' }
    ]
  },
  '南京': {
    city: '南京',
    title: '秦淮河畔的旧城一下午',
    summary: '从夫子庙出发，走进老门东，再沿城墙和秦淮河的光线慢慢收尾。',
    duration: '约 2 小时', distance: '约 2.8 km', mood: '旧城 · 水岸 · 烟火气',
    stops: [
      { id: 'fuzimiao', time: '15:00', name: '夫子庙', type: '历史街区', note: '从秦淮河边的牌楼和水声开始，先感受旧城的热闹。', location: { lat: 32.0210, lng: 118.7880 }, accent: '#e26d4d' },
      { id: 'laomendong', time: '15:30', name: '老门东', type: '街巷生活', note: '穿过老门东的青砖街巷，给小店和屋檐留一点时间。', location: { lat: 32.0161, lng: 118.7850 }, accent: '#86a87b' },
      { id: 'zhonghuamen', time: '16:05', name: '中华门城堡', type: '城市地标', note: '沿城墙边走一段，看旧城门把城市层次拉开。', location: { lat: 32.0111, lng: 118.7661 }, accent: '#d7a85d' },
      { id: 'qinhuai-riverside', time: '16:40', name: '秦淮河畔', type: '水岸收尾', note: '回到河岸，让水面和晚一点的光替这次散步收尾。', location: { lat: 32.0192, lng: 118.7838 }, accent: '#7387a6' }
    ]
  }
};

function demoCityKey(city = '') {
  const value = String(city).trim().toLowerCase();
  if (/(北京|beijing)/i.test(value)) return '北京';
  if (/(南京|nanjing)/i.test(value)) return '南京';
  return '上海';
}

function demoRouteForCity(city = '') {
  return demoRouteVariants[demoCityKey(city)] || demoRoute;
}

function cityFromPrompt(prompt = '') {
  return demoCityKey(prompt);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      body += chunk;
      if (body.length > 1e6) {
        settled = true;
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on('error', error => { if (!settled) { settled = true; reject(error); } });
  });
}

// Valhalla returns an encoded polyline with six decimal places. Decode it on
// the server so the browser only receives the small, renderer-ready path.
function decodeValhallaPolyline(encoded, precision = 6) {
  if (typeof encoded !== 'string' || !encoded) throw new Error('Walking route has no geometry');
  const factor = 10 ** precision;
  const coordinates = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= encoded.length) throw new Error('Invalid walking route geometry');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude += (result & 1) ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      if (index >= encoded.length) throw new Error('Invalid walking route geometry');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude += (result & 1) ? ~(result >> 1) : result >> 1;
    coordinates.push([latitude / factor, longitude / factor]);
  }
  return coordinates;
}

function normalizeWalkingPoints(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) {
    throw new Error('Walking route needs 2 to 12 points');
  }
  return value.map(point => {
    const rawLat = Array.isArray(point) ? point[0] : point?.lat;
    const rawLng = Array.isArray(point) ? point[1] : point?.lng ?? point?.lon;
    const lat = coordinateNumber(rawLat);
    const lng = coordinateNumber(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error('Invalid walking route coordinates');
    }
    return { lat, lon: lng };
  });
}

async function getWalkingRoute(points) {
  const locations = normalizeWalkingPoints(points);
  const response = await fetch(process.env.WALKING_ROUTER_URL || 'https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations, costing: 'pedestrian', units: 'kilometers', shape_match: 'map_snap' }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Walking router returned ${response.status}`);
  const payload = await response.json();
  const trip = payload?.trip;
  if (!trip || !Array.isArray(trip.legs) || !trip.legs.length) throw new Error('Walking router returned no route');
  const coordinates = trip.legs.flatMap((leg, index) => {
    const legCoordinates = decodeValhallaPolyline(leg.shape);
    return index ? legCoordinates.slice(1) : legCoordinates;
  });
  if (coordinates.length < 2) throw new Error('Walking router returned an incomplete path');
  const summary = trip.summary || {};
  return {
    coordinates,
    distanceKm: Number(Number(summary.length ?? 0).toFixed(2)),
    durationMinutes: Math.max(1, Math.round(Number(summary.time ?? 0) / 60)),
    source: 'valhalla',
    status: 'routed'
  };
}

function textField(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${field}`);
  return value.trim().slice(0, 500);
}

function coordinateNumber(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return NaN;
  return Number(value);
}

function normalizeLocation(value) {
  const rawLat = value?.lat ?? value?.latitude;
  const rawLng = value?.lng ?? value?.longitude ?? value?.lon;
  const lat = coordinateNumber(rawLat);
  const lng = coordinateNumber(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error('Invalid stop coordinates');
  }
  return { lat, lng };
}

function externalImage(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function parseJsonContent(content) {
  return JSON.parse(String(content || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
}

function normalizeIntent(value, prompt) {
  const interests = Array.isArray(value?.interests)
    ? value.interests.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 8)
    : [];
  const durationMinutes = Number(value?.durationMinutes);
  const maxWalkKm = Number(value?.maxWalkKm);
  return {
    city: typeof value?.city === 'string' ? value.city.trim().slice(0, 80) : '',
    interests,
    startingPoint: typeof value?.startingPoint === 'string' ? value.startingPoint.trim().slice(0, 120) : '',
    durationMinutes: Number.isFinite(durationMinutes) ? Math.max(30, Math.min(720, Math.round(durationMinutes))) : null,
    maxWalkKm: Number.isFinite(maxWalkKm) ? Math.max(0.5, Math.min(30, maxWalkKm)) : null,
    pace: typeof value?.pace === 'string' ? value.pace.trim().slice(0, 40) : '',
    timeOfDay: typeof value?.timeOfDay === 'string' ? value.timeOfDay.trim().slice(0, 40) : '',
    constraints: Array.isArray(value?.constraints) ? value.constraints.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 8) : [],
    originalRequest: prompt.slice(0, 500)
  };
}

async function analyzeIntent(prompt, apiKey) {
  const response = await fetch(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是旅行需求分析器。只返回JSON，不要markdown。提取city、interests（数组）、startingPoint、durationMinutes、maxWalkKm、pace、timeOfDay、constraints。用户未提供的字段用空字符串、空数组或null。不要编造具体POI。' },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!response.ok) throw new Error(`DeepSeek intent returned ${response.status}`);
  const payload = await response.json();
  return normalizeIntent(parseJsonContent(payload.choices?.[0]?.message?.content), prompt);
}

function ctripMockPois(city) {
  if (city && !/(上海|shanghai|北京|beijing|南京|nanjing)/i.test(city)) return [];
  const route = demoRouteForCity(city);
  return route.stops.map((stop, index) => ({
    id: `mock-${stop.id}`,
    name: stop.name,
    type: stop.type,
    note: stop.note,
    location: stop.location,
    image: stop.image || '',
    imageSource: stop.imageSource || ''
  }));
}

async function enrichLocationImages(pois, city = '') {
  const enriched = await Promise.all(pois.slice(0, 20).map(async poi => {
    if (poi.image) return poi;
    const located = await findLocationImage({
      lat: poi.location?.lat,
      lng: poi.location?.lng,
      name: poi.name,
      city
    });
    return located ? { ...poi, ...located } : poi;
  }));
  return enriched;
}

async function enrichRouteImages(route) {
  if (!route || !Array.isArray(route.stops)) return route;
  const stops = await Promise.all(route.stops.map(async stop => {
    if (stop.image && /^https?:\/\//i.test(stop.image)) return stop;
    const located = await findLocationImage({
      lat: stop.location?.lat,
      lng: stop.location?.lng,
      name: stop.name,
      city: route.city
    });
    return located ? { ...stop, ...located } : stop;
  }));
  return { ...route, stops };
}

async function getDemoRoute(city = '上海') {
  const baseRoute = demoRouteForCity(city);
  // Keep local references as a reliable fallback, but try to replace them
  // with a domestic image-search result whenever the network is available.
  const route = {
    ...baseRoute,
    stops: baseRoute.stops.map(stop => ({ ...stop, image: '' }))
  };
  const enriched = await enrichRouteImages(route);
  return {
    ...enriched,
    stops: enriched.stops.map((stop, index) => ({
      ...stop,
      image: stop.image || baseRoute.stops[index]?.image || '',
      ...(baseRoute.stops[index]?.image ? {
        fallbackPhoto: {
          image: baseRoute.stops[index].image,
          imageSource: SCENE_IMAGE_SOURCE,
          imageKind: 'reference-photo',
          imagePageUrl: baseRoute.stops[index].imagePageUrl,
          imageAttribution: baseRoute.stops[index].imageAttribution,
          imageTitle: `${baseRoute.city} · ${baseRoute.stops[index].name}本地参考图`,
          distanceMeters: null
        }
      } : {})
    }))
  };
}

function normalizeRoute(value, candidatePois = [], poiSource = 'ctrip') {
  if (!Array.isArray(candidatePois) || candidatePois.length < 2) {
    throw new Error('Route generation requires at least two valid POIs');
  }
  if (!value || !Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > 8) {
    throw new Error('DeepSeek returned an incomplete route');
  }
  const poisById = new Map(candidatePois.map(poi => [poi.id, poi]));
  const stops = value.stops.map((stop, index) => {
    if (!stop || typeof stop !== 'object') throw new Error('Invalid route stop');
    const matchedPoi = poisById.get(String(stop.poiId ?? ''));
    // Once the POI adapter returned candidates, every generated stop must be
    // traceable to one of them. Otherwise the model could silently invent a
    // place/coordinate while the response still claims to be POI-backed.
    if (!matchedPoi) {
      throw new Error('DeepSeek route referenced an unknown POI');
    }
    const coordinateStatus = matchedPoi
      ? (poiSource === 'mock' ? '本地演示 POI 坐标' : '携程 POI 坐标')
      : 'AI 估计，待核实';
    const poiImage = matchedPoi && externalImage(matchedPoi.image);
    return {
      id: `stop-${index + 1}`,
      poiId: matchedPoi?.id,
      time: textField(stop.time, 'stop time'),
      name: matchedPoi?.name || textField(stop.name, 'stop name'),
      type: textField(stop.type, 'stop type'),
      note: textField(stop.note, 'stop note'),
      location: matchedPoi?.location || normalizeLocation(stop.location),
      coordinateStatus,
      coordinateSource: matchedPoi ? poiSource : 'deepseek',
      image: poiImage || '',
      // Keep the source empty when no licensed image was found. The client uses
      // the empty value to render an explicit placeholder instead of treating
      // a missing-image message as an image attribution label.
      imageSource: poiImage ? (matchedPoi.imageSource || '携程 POI 素材') : '',
      imageKind: matchedPoi?.imageKind || '',
      imagePageUrl: matchedPoi?.imagePageUrl || '',
      imageAttribution: matchedPoi?.imageAttribution || '',
      distanceMeters: Number.isFinite(matchedPoi?.distanceMeters) ? matchedPoi.distanceMeters : null,
      imageTitle: matchedPoi?.imageTitle || matchedPoi?.title || '',
      ...(Number.isFinite(matchedPoi?.imageCapturedAt) ? { imageCapturedAt: matchedPoi.imageCapturedAt } : {}),
      accent: ['#e26d4d', '#86a87b', '#d7a85d', '#7387a6'][index % 4]
    };
  });
  return {
    city: textField(value.city, 'city'),
    title: textField(value.title, 'title'),
    summary: textField(value.summary, 'summary'),
    duration: textField(value.duration, 'duration'),
    distance: textField(value.distance, 'distance'),
    mood: textField(value.mood, 'mood'),
    stops
  };
}

function normalizePoi(poi, index) {
  const suppliedId = poi?.id ?? poi?.poiId;
  const normalizedId = typeof suppliedId === 'string'
    ? suppliedId.trim()
    : Number.isFinite(suppliedId) ? String(suppliedId) : '';
  const id = normalizedId
    ? normalizedId.slice(0, 120)
    : `poi-${index + 1}`;
  return {
    id,
    name: textField(poi.name ?? poi.title, 'POI name'),
    type: String(poi.type ?? poi.category ?? '途经点').trim().slice(0, 80),
    note: String(poi.note ?? poi.description ?? '').trim().slice(0, 500),
    location: normalizeLocation(poi.location ?? poi),
    image: externalImage(poi.image ?? poi.imageUrl ?? poi.photoUrl),
    imageSource: typeof poi.imageSource === 'string' ? poi.imageSource.slice(0, 160) : '',
    imageKind: typeof poi.imageKind === 'string' ? poi.imageKind.slice(0, 40) : '',
    imagePageUrl: externalImage(poi.imagePageUrl),
    imageAttribution: typeof poi.imageAttribution === 'string' ? poi.imageAttribution.slice(0, 160) : '',
    imageTitle: typeof poi.imageTitle === 'string' ? poi.imageTitle.slice(0, 240) : '',
    ...(Number.isFinite(poi.imageCapturedAt) ? { imageCapturedAt: poi.imageCapturedAt } : {})
  };
}

async function searchCtripPois({ query, city, intent = {} }) {
  const endpoint = process.env.CTRIP_API_BASE_URL;
  const apiKey = process.env.CTRIP_API_KEY;
  if (!endpoint || !apiKey) {
    const pois = await enrichLocationImages(ctripMockPois(city), city);
    return { source: 'mock', pois, message: '未配置携程接口，当前使用本地演示 POI；图片优先通过百度图片搜索。' };
  }
  const url = new URL(endpoint);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid Ctrip endpoint');
  // Generic JSON/Bearer adapter only. Replace request signing and field mapping after obtaining Ctrip's actual API contract.
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, city, intent }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Ctrip POI endpoint returned ${response.status}`);
  const payload = await response.json();
  const rawPois = Array.isArray(payload) ? payload : payload.pois ?? payload.data?.pois ?? payload.data?.items;
  if (!Array.isArray(rawPois)) throw new Error('Ctrip POI response has no pois array');
  // Bound the untrusted upstream collection before normalizing or enriching it.
  const normalizedPois = rawPois.slice(0, 20).map(normalizePoi);
  const uniquePois = normalizedPois.filter((poi, index) => normalizedPois.findIndex(candidate => candidate.id === poi.id) === index);
  return { source: 'ctrip', pois: await enrichLocationImages(uniquePois, city) };
}

async function generateWithDeepSeek(prompt, apiKey, candidatePois = [], intent = {}, poiSource = 'ctrip') {
  const response = await fetch(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是Citywalk路线策划师。只返回一个JSON对象，不要markdown。JSON字段必须是 city,title,summary,duration,distance,mood,stops。stops为2到6个按步行顺序排列的对象，每个包含time,name,type,note,location,poiId。只能从给定候选POI中选择地点，必须填写精确poiId，不得编造名称或坐标。叙事要有空间感，地点间可步行，时间与距离合理。' },
        { role: 'user', content: JSON.stringify({ request: prompt, intent, candidatePois: candidatePois.map(poi => ({ id: poi.id, name: poi.name, type: poi.type, location: poi.location, note: poi.note })) }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`DeepSeek returned ${response.status}`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || '';
  const parsed = parseJsonContent(content);
  return normalizeRoute(parsed, candidatePois, poiSource);
}

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    return sendJson(res, 400, { error: 'Invalid URL' });
  }
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC, relative));
  const relativeToPublic = path.relative(PUBLIC, filePath);
  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(res, 404, { error: 'Not found' });
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/location-photo/image') {
    try {
      const requestUrl = new URL(req.url, 'http://localhost');
      const photo = await getLocationPhotoBytes(requestUrl.searchParams.get('url'));
      res.writeHead(200, {
        'Content-Type': photo.contentType,
        'Content-Length': photo.data.length,
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(photo.data);
    } catch (error) {
      return sendJson(res, error.statusCode === 400 ? 400 : 502, { error: '图片暂时无法加载' });
    }
  }
  if (req.method === 'GET' && req.url.startsWith('/api/location-photo')) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const name = requestUrl.searchParams.get('name') || '';
      const city = requestUrl.searchParams.get('city') || '';
      const photo = await findLocationImage({ name, city });
      return sendJson(res, 200, { photo: photo || null });
    } catch (error) {
      return sendJson(res, 502, { photo: null, error: '图片搜索暂时不可用' });
    }
  }
  if (req.method === 'GET' && req.url.startsWith('/api/demo-route')) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    return sendJson(res, 200, { route: await getDemoRoute(requestUrl.searchParams.get('city') || '上海'), source: 'demo' });
  }
  if (req.method === 'POST' && req.url === '/api/generate-route') {
    try {
      const body = await readBody(req);
      if (typeof body.prompt !== 'string' || !body.prompt.trim()) return sendJson(res, 400, { error: '请输入路线描述' });
      const prompt = body.prompt.trim();
      const demoCity = cityFromPrompt(prompt);
      if (prompt.length > 500) return sendJson(res, 400, { error: '路线描述请控制在 500 字以内' });
      if (body.apiKey !== undefined && typeof body.apiKey !== 'string') return sendJson(res, 400, { error: 'API Key 格式不正确' });
      const apiKey = body.apiKey?.trim() || process.env.DEEPSEEK_API_KEY;
      if (body.apiKey !== undefined && (body.apiKey.length > 256 || /[\r\n]/.test(body.apiKey))) {
        return sendJson(res, 400, { error: 'API Key 格式不正确' });
      }
      if (apiKey) {
        let pipelineStage = '意图解析';
        let poiSource = 'unavailable';
        let intent = null;
        try {
          // The production order is intentional: parse the request, query POI, then let
          // DeepSeek compose the route only from the returned POIs.
          intent = await analyzeIntent(prompt, apiKey);
          const city = intent.city || (typeof body.city === 'string' ? body.city.trim().slice(0, 80) : '');
          pipelineStage = 'POI 查询';
          const poiResult = await searchCtripPois({ query: prompt, city, intent });
          poiSource = poiResult.source;
          const candidatePois = Array.isArray(poiResult.pois) ? poiResult.pois.slice(0, 20) : [];
          if (candidatePois.length < 2) {
            const sourceLabel = poiSource === 'mock' ? '本地演示 POI' : '携程 POI';
            return sendJson(res, 200, {
              route: await getDemoRoute(demoCity),
              source: 'demo-fallback',
              poiSource,
              intent,
              workflow: ['DeepSeek 意图解析', `${sourceLabel} 查询`],
              warning: `${sourceLabel} 未返回至少两个有效地点，已切换为${demoCity}示例路线。`,
              ...(poiResult.message ? { poiMessage: poiResult.message } : {})
            });
          }
          pipelineStage = '路线生成';
          const route = await enrichRouteImages(await generateWithDeepSeek(prompt, apiKey, candidatePois, intent, poiSource));
          return sendJson(res, 200, {
            route,
            source: 'deepseek',
            poiSource,
            intent,
            workflow: ['DeepSeek 意图解析', `${poiSource === 'ctrip' ? '携程 POI' : '本地演示 POI'} 查询`, 'DeepSeek 基于 POI 生成路线'],
            ...(poiResult.message ? { poiMessage: poiResult.message } : {}),
            ...(poiResult.warning ? { warning: poiResult.warning } : {})
          });
        } catch (error) {
          const sourceLabel = poiSource === 'mock' ? '本地演示 POI' : '携程 POI';
          const warning = pipelineStage === 'POI 查询'
            ? `${sourceLabel} 服务暂时不可用，已切换为${demoCity}示例路线。`
            : pipelineStage === '路线生成'
              ? `路线模型返回的数据无法校验，已切换为${demoCity}示例路线。`
              : `需求分析暂时不可用，已切换为${demoCity}示例路线。`;
          const workflow = pipelineStage === '意图解析'
            ? []
            : pipelineStage === 'POI 查询'
              ? ['DeepSeek 意图解析']
              : ['DeepSeek 意图解析', `${sourceLabel} 查询`];
          return sendJson(res, 200, {
            route: await getDemoRoute(demoCity),
            source: 'demo-fallback',
            poiSource,
            ...(intent ? { intent } : {}),
            workflow,
            warning
          });
        }
      }
      return sendJson(res, 200, { route: await getDemoRoute(demoCity), source: 'demo' });
    } catch (error) {
      return sendJson(res, 400, { error: '请求格式不正确' });
    }
  }
  if (req.method === 'POST' && req.url === '/api/walking-route') {
    try {
      const body = await readBody(req);
      const points = body.points ?? body.coordinates;
      const walkingPath = await getWalkingRoute(points);
      return sendJson(res, 200, { walkingPath });
    } catch (error) {
      return sendJson(res, 502, { error: '步行路线服务暂时不可用', detail: error.message });
    }
  }
  if (req.method === 'POST' && req.url === '/api/ctrip/pois') {
    try {
      const body = await readBody(req);
      const query = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : '';
      const city = typeof body.city === 'string' ? body.city.trim().slice(0, 80) : '';
      return sendJson(res, 200, await searchCtripPois({ query, city, intent: body.intent || {} }));
    } catch (error) {
      return sendJson(res, 502, { source: 'ctrip-error', error: '携程 POI 接口暂时不可用', detail: error.message });
    }
  }
  serveStatic(req, res);
});

server.listen(PORT, () => console.log(`Citywalk Scope running at http://localhost:${PORT}`));
