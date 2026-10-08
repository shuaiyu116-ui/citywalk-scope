import { findLocationPhoto } from '/location-photos.mjs';

const $ = selector => document.querySelector(selector);
const icons = () => window.lucide.createIcons();
let storedKey = '';
try { storedKey = sessionStorage.getItem('deepseekKey') || ''; } catch { /* Private sessions may block storage. */ }
const state = { route: null, deepseekKey: storedKey, busy: false, activeStop: 0, view: '2d', source: 'demo', workflow: null, poiSource: null, playing: false };
let scene, map, routeLayer, routePathLayer, routeBounds, mapMarkers = [], playTimer, scrollTimer, scrollLock = 0;
let walkingRequestId = 0;
let locationImageRequestId = 0;
let tileState = '地图正在加载', tileLoaded = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500);
}

function textElement(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text || '';
  return el;
}

function updateConnectionStatus() {
  $('#dataStatus').textContent = state.deepseekKey ? 'Key 已配置' : '演示模式';
}

function coordinates(stop) {
  const lat = Number(stop.location?.lat ?? stop.coordinates?.[1]);
  const lng = Number(stop.location?.lng ?? stop.coordinates?.[0]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

// 高德国内瓦片使用 GCJ-02；路线和携程 POI 仍保留 WGS84，只有绘图时转换。
function wgs84ToGcj02([lat, lng]) {
  const pi = Math.PI;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  const outOfChina = lat < 0.8293 || lat > 55.8271 || lng < 72.004 || lng > 137.8347;
  if (outOfChina) return [lat, lng];
  const transformLat = (x, y) => {
    let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    value += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
    value += (20 * Math.sin(y * pi) + 40 * Math.sin(y / 3 * pi)) * 2 / 3;
    value += (160 * Math.sin(y / 12 * pi) + 320 * Math.sin(y * pi / 30)) * 2 / 3;
    return value;
  };
  const transformLng = (x, y) => {
    let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    value += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
    value += (20 * Math.sin(x * pi) + 40 * Math.sin(x / 3 * pi)) * 2 / 3;
    value += (150 * Math.sin(x / 12 * pi) + 300 * Math.sin(x / 30 * pi)) * 2 / 3;
    return value;
  };
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = lat / 180 * pi;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return [lat + (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * pi), lng + (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * pi)];
}

const mapCoordinates = point => point ? wgs84ToGcj02(point) : point;

function updateMapBadge() {
  $('#mapMode').textContent = state.view === '3d' ? '3D 空间示意 · 建筑非真实建模' : tileState;
}

function initMap() {
  map = L.map('mapCanvas', { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?style=7&lang=zh_cn&size=1&scale=1&version=20230706&x={x}&y={y}&z={z}', {
    subdomains: '1234',
    attribution: '&copy; 高德地图',
    maxZoom: 19, crossOrigin: true
  }).on('tileload', () => {
    tileLoaded = true;
    tileState = '高德地图 · 地理视图';
    updateMapBadge();
  }).on('tileerror', () => {
    tileState = tileLoaded ? '部分底图未加载 · 点位仍可预览' : '底图暂不可用 · 经纬度示意';
    updateMapBadge();
  }).addTo(map);
  window.setTimeout(() => {
    if (!tileLoaded) { tileState = '底图暂不可用 · 经纬度示意'; updateMapBadge(); }
  }, 7000);
  routeLayer = L.layerGroup().addTo(map);
  routePathLayer = L.layerGroup().addTo(map);
  new ResizeObserver(() => {
    if (state.view !== '2d') return;
    map.invalidateSize();
    fitMap();
  }).observe($('#mapCanvas'));
}

function setRoutePathStatus(message) {
  const label = $('#routePathLabel') || document.querySelector('.map-footer > span:first-child');
  if (!label) return;
  const dot = label.querySelector('.legend-dot');
  label.replaceChildren();
  if (dot) label.append(dot);
  label.append(document.createTextNode(message));
}

function drawRoutePath(points, path = null) {
  const hasPathGeometry = Array.isArray(path?.coordinates) && path.coordinates.length > 1;
  const rawGeometry = hasPathGeometry ? path.coordinates : points;
  // Valhalla is decoded to Leaflet's [latitude, longitude]. Other adapters
  // may return GeoJSON [longitude, latitude], so normalize before drawing.
  const valhallaFormat = path?.source === 'valhalla';
  const geometry = rawGeometry.map(pair => {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const lat = Number(!hasPathGeometry || valhallaFormat ? pair[0] : pair[1]);
    const lng = Number(!hasPathGeometry || valhallaFormat ? pair[1] : pair[0]);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? mapCoordinates([lat, lng])
      : null;
  }).filter(Boolean);
  if (geometry.length < 2) return;
  const routed = path?.source === 'valhalla' || path?.status === 'routed';
  routeBounds = L.latLngBounds(points.map(mapCoordinates).concat(geometry));
  routePathLayer.clearLayers();
  const lineStyle = routed ? {} : { dashArray: '7 9' };
  L.polyline(geometry, { color: '#fff', weight: 8, opacity: .95, interactive: false, ...lineStyle }).addTo(routePathLayer);
  L.polyline(geometry, { color: '#df6c50', weight: 4, opacity: 1, interactive: false, ...lineStyle }).addTo(routePathLayer);
  fitMap();
}

function applyWalkingDistance(route) {
  const distance = Number(route.walkingPath?.distanceKm);
  if (!Number.isFinite(distance) || distance <= 0) return;
  route.distance = `${distance.toFixed(2)} km`;
  $('#routeDistance').textContent = route.distance;
  $('#routeDistance').title = '按实际步行道路计算';
}

async function loadWalkingPath(route, points, requestId) {
  if (Array.isArray(route.walkingPath?.coordinates) && route.walkingPath.coordinates.length > 1) {
    drawRoutePath(points, route.walkingPath);
    applyWalkingDistance(route);
    setRoutePathStatus('真实步行路径 · Valhalla');
    return;
  }
  setRoutePathStatus('正在匹配真实步行路径…');
  try {
    const response = await fetch('/api/walking-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
      signal: AbortSignal.timeout(18000)
    });
    const result = await response.json();
    if (!response.ok || !result.walkingPath) throw new Error(result.error || '步行路线不可用');
    if (requestId !== walkingRequestId || state.route !== route) return;
    route.walkingPath = result.walkingPath;
    applyWalkingDistance(route);
    drawRoutePath(points, route.walkingPath);
    setRoutePathStatus('真实步行路径 · Valhalla');
    scene?.setRoute(route);
    scene?.setActiveStop(state.activeStop);
  } catch (error) {
    if (requestId !== walkingRequestId || state.route !== route) return;
    setRoutePathStatus('点位连线 · 步行路径暂不可用');
  }
}

function fitMap() {
  if (routeBounds && state.view === '2d') {
    map.invalidateSize();
    map.fitBounds(routeBounds, { padding: [52, 55], maxZoom: 16, animate: false });
  }
}

function renderMap(route) {
  const requestId = ++walkingRequestId;
  routeLayer.clearLayers();
  routePathLayer.clearLayers();
  mapMarkers = [];
  const points = route.stops.map(coordinates);
  if (points.some(point => !point)) return;
  drawRoutePath(points);
  setRoutePathStatus('正在匹配真实步行路径…');
  route.stops.forEach((stop, index) => {
    const pin = document.createElement('button');
    pin.textContent = index + 1;
    pin.type = 'button';
    pin.title = stop.name;
    pin.setAttribute('aria-label', `查看 ${stop.name}`);
    pin.addEventListener('click', event => { event.stopPropagation(); selectStop(index); });
    const marker = L.marker(mapCoordinates(points[index]), { icon: L.divIcon({ className: 'route-marker', html: pin, iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false });
    marker.bindTooltip(textElement('span', '', stop.name), { direction: 'top', offset: [0, -15] });
    marker.addTo(routeLayer);
    mapMarkers.push({ marker, pin });
  });
  fitMap();
  scene?.setRoute(route);
  loadWalkingPath(route, points, requestId);
}

function setActiveStop(index, { scroll = false } = {}) {
  if (!state.route?.stops.length) return;
  index = Math.max(0, Math.min(index, state.route.stops.length - 1));
  state.activeStop = index;
  const stop = state.route.stops[index];
  document.querySelectorAll('.story-card').forEach((card, i) => {
    card.classList.toggle('active', i === index);
    card.setAttribute('aria-current', i === index ? 'step' : 'false');
  });
  document.querySelectorAll('.stop-list button').forEach((button, i) => {
    button.classList.toggle('active', i === index);
    button.setAttribute('aria-current', i === index ? 'step' : 'false');
  });
  mapMarkers.forEach(({ pin, marker }, i) => {
    pin.classList.toggle('active', i === index);
    marker.setZIndexOffset(i === index ? 1000 : 0);
  });
  scene?.setActiveStop(index);
  $('#activeNumber').textContent = String(index + 1).padStart(2, '0');
  $('#activeName').textContent = stop.name;
  $('#activeNote').textContent = stop.note;
  $('#activeTime').textContent = stop.time;
  $('#walkCounter').textContent = `${String(index + 1).padStart(2, '0')} / ${String(state.route.stops.length).padStart(2, '0')}`;
  $('.progress-line span').style.width = `${((index + 1) / state.route.stops.length) * 100}%`;
  $('#prevStop').disabled = index === 0;
  $('#nextStop').disabled = index === state.route.stops.length - 1;
  if (scroll) {
    const board = $('#storyboard');
    const card = board.children[index];
    scrollLock = performance.now() + 700;
    board.scrollTo({ left: card.offsetLeft - board.children[0].offsetLeft, behavior: reducedMotion ? 'instant' : 'smooth' });
  }
}

function selectStop(index) { stopPlayback(); setActiveStop(index, { scroll: true }); }

function imageLabel(stop, source) {
  if (stop.imageSource) {
    const distance = Number.isFinite(stop.distanceMeters) ? ` · ${stop.distanceMeters} m` : '';
    const kind = stop.imageKind === 'street-photo' ? `街景照片${distance}` : stop.imageKind === 'location-photo' ? '位置照片' : stop.imageKind === 'nearby-photo' ? `附近照片${distance}` : '参考照片';
    return `${kind} · ${stop.imageSource}`;
  }
  return source === 'demo' ? '本地演示图 · 来源说明' : '暂无授权位置照片';
}

async function findBrowserLocationImage(stop, city = '') {
  return findLocationPhoto({ lat: stop.location?.lat, lng: stop.location?.lng, name: stop.name, city });
}

function renderPhotoAttribution(card, stop) {
  card.querySelector('.photo-attribution')?.remove();
  if (!stop.imageAttribution || !stop.imagePageUrl) return;
  const attribution = textElement('a', 'photo-attribution', stop.imageAttribution);
  attribution.href = stop.imagePageUrl;
  attribution.target = '_blank';
  attribution.rel = 'noopener';
  attribution.title = stop.imageTitle || stop.name;
  attribution.addEventListener('click', event => event.stopPropagation());
  card.querySelector('.story-content').appendChild(attribution);
}

function replaceStoryImage(card, stop, source) {
  if (!card) return;
  const imageWrap = card.querySelector('.story-image-wrap');
  if (!imageWrap) return;
  imageWrap.querySelector('.story-image, .story-image-placeholder')?.remove();
  if (stop.image) {
    const image = document.createElement('img');
    image.className = 'story-image';
    image.alt = `${stop.name} · 位置参考照片`;
    image.loading = 'eager';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      if (!imageWrap.contains(image)) return;
      const fallback = stop.fallbackPhoto;
      if (fallback?.image && fallback.image !== stop.image) {
        Object.assign(stop, fallback);
        delete stop.fallbackPhoto;
        replaceStoryImage(card, stop, source);
        return;
      }
      image.remove();
      renderImagePlaceholder(imageWrap, stop, source);
    }, { once: true });
    image.src = storyImageUrl(stop.image);
    imageWrap.insertBefore(image, imageWrap.querySelector('.story-type'));
  } else {
    renderImagePlaceholder(imageWrap, stop, source);
  }
  const oldCredit = imageWrap.querySelector('.story-credit');
  if (oldCredit) oldCredit.remove();
  const credit = stop.imagePageUrl ? document.createElement('a') : document.createElement('span');
  credit.className = 'story-credit';
  credit.textContent = imageLabel(stop, source);
  credit.title = [stop.imageTitle, stop.imageAttribution].filter(Boolean).join(' · ');
  if (credit.tagName === 'A') {
    credit.href = stop.imagePageUrl;
    credit.target = '_blank';
    credit.rel = 'noopener';
    credit.addEventListener('click', event => event.stopPropagation());
  }
  imageWrap.appendChild(credit);
  renderPhotoAttribution(card, stop);
}

function storyImageUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === 'https:' && /^(?:img\d+|t\d+)\.baidu\.com$/i.test(url.hostname)) {
      return `/api/location-photo/image?${new URLSearchParams({ url: url.href })}`;
    }
  } catch { /* Local references and other POI photo providers keep their URLs. */ }
  return value;
}

async function hydrateRouteImages(route, source) {
  const requestId = ++locationImageRequestId;
  const results = await Promise.all(route.stops.map(stop => {
    // Remote POI photos are already location-backed. Relative bundled assets
    // are an immediate visual fallback; the same-origin proxy can replace them
    // with a Baidu result when domestic network access is available.
    if (stop.image && /^https?:\/\//i.test(stop.image)) return Promise.resolve(null);
    return findBrowserLocationImage(stop, route.city);
  }));
  if (requestId !== locationImageRequestId || state.route !== route) return;
  results.forEach((image, index) => {
    if (!image) return;
    Object.assign(route.stops[index], image);
    replaceStoryImage($('#storyboard').children[index], route.stops[index], source);
  });
}

function renderImagePlaceholder(imageWrap, stop, source) {
  const placeholder = textElement('div', 'story-image-placeholder', '');
  placeholder.append(textElement('strong', '', '暂无授权位置照片'), textElement('span', '', source === 'deepseek' ? '可接入携程素材或街景服务' : '当前路线未提供图片'));
  placeholder.setAttribute('aria-label', `${stop.name}暂无授权位置照片`);
  imageWrap.appendChild(placeholder);
}

function renderRoute(route, source = 'demo', metadata = {}) {
  stopPlayback();
  state.route = route;
  state.source = source;
  state.workflow = Array.isArray(metadata.workflow) ? metadata.workflow : null;
  state.poiSource = metadata.poiSource || null;
  state.activeStop = 0;
  $('#routeCity').textContent = route.city;
  $('#routeTitle').textContent = route.title;
  $('#routeSummary').textContent = route.summary;
  const workflow = $('#workflowTrail');
  workflow.textContent = state.workflow?.length ? state.workflow.join('  →  ') : source === 'demo' ? '演示路线 · 未调用外部 AI 与 POI 服务' : '';
  $('#routeMood').textContent = route.mood;
  $('#routeDistance').textContent = route.distance;
  $('#routeDistance').removeAttribute('title');
  $('#routeDuration').textContent = route.duration;
  $('#routeSource').textContent = source === 'deepseek'
    ? `DeepSeek · ${metadata.poiSource === 'ctrip' ? '携程 POI' : 'POI 适配回退'}`
    : source === 'demo-fallback' ? '示例回退' : '示例路线';
  $('#coordinateStatus').textContent = source === 'deepseek'
    ? (metadata.poiSource === 'ctrip' ? '携程 POI 坐标' : '本地示例 POI 坐标') : '示例坐标';
  $('#stopsSummary').textContent = `${route.stops.length} 个地点`;
  $('#startTime').textContent = `${route.stops[0].time} 出发`;
  $('#endTime').textContent = `${route.stops.at(-1).time} 收尾`;
  const board = $('#storyboard');
  board.replaceChildren();
  $('#stopList').replaceChildren();
  route.stops.forEach((stop, index) => {
    const card = document.createElement('article');
    card.className = 'story-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `第 ${index + 1} 站 ${stop.name}`);
    card.addEventListener('click', () => selectStop(index));
    card.addEventListener('keydown', event => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectStop(index); }
    });
    const imageWrap = textElement('div', 'story-image-wrap', '');
    imageWrap.appendChild(textElement('span', 'story-type', stop.type));
    const content = textElement('div', 'story-content', '');
    const heading = textElement('div', 'story-card-heading', '');
    heading.append(textElement('span', 'story-index', `STOP ${String(index + 1).padStart(2, '0')}`), textElement('time', '', stop.time));
    content.append(heading, textElement('h3', '', stop.name), textElement('p', '', stop.note));
    card.append(imageWrap, content);
    replaceStoryImage(card, stop, source);
    board.appendChild(card);
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.append(textElement('span', 'stop-dot', index + 1), textElement('span', 'stop-label', stop.name), textElement('time', '', stop.time));
    button.addEventListener('click', () => selectStop(index));
    item.appendChild(button);
    $('#stopList').appendChild(item);
  });
  scrollLock = performance.now() + 700;
  board.scrollLeft = 0;
  renderMap(route);
  setActiveStop(0);
  hydrateRouteImages(route, source);
}

async function generateRoute(event) {
  event?.preventDefault();
  if (state.busy) return;
  const prompt = $('#promptInput').value.trim();
  if (!prompt) { toast('写下你想漫步的城市和偏好'); $('#promptInput').focus(); return; }
  if (prompt.length > 500) { toast('路线描述请控制在 500 字以内'); return; }
  state.busy = true;
  stopPlayback();
  const button = $('#generateButton');
  button.disabled = true;
  button.classList.add('loading');
  button.querySelector('span').textContent = '正在规划…';
  $('#generationStatus').classList.remove('warning');
  $('#generationStatus').textContent = state.deepseekKey ? '正在分析需求、查询地点与编排路线…' : '正在展开城市示例路线…';
  try {
    const response = await fetch('/api/generate-route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, apiKey: state.deepseekKey }), signal: AbortSignal.timeout(150000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '路线生成失败');
    renderRoute(result.route, result.source, result);
    $('#generationStatus').textContent = result.warning || result.poiMessage || (result.source === 'deepseek' ? '路线已生成，出发前请核对地点与开放时间。' : `当前为${result.route?.city || '城市'}示例路线。配置 DeepSeek Key 后可生成自定义路线。`);
    $('#generationStatus').classList.toggle('warning', !!result.warning);
    toast(result.source === 'deepseek' ? '新的路线已就绪' : `${result.route?.city || '城市'}示例路线已就绪`);
  } catch (error) {
    $('#generationStatus').classList.add('warning');
    $('#generationStatus').textContent = error.name === 'TimeoutError' ? '请求超时，请稍后重试。' : error.message;
    toast('暂时无法生成路线，请重试');
  } finally {
    state.busy = false;
    button.disabled = false;
    button.classList.remove('loading');
    button.querySelector('span').textContent = '生成我的路线';
  }
}

let viewRequest = 0;
async function setView(view) {
  const request = ++viewRequest;
  state.view = view;
  document.querySelectorAll('.view-toggle button').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#mapCanvas').hidden = view !== '2d';
  $('#scene3d').hidden = view !== '3d';
  $('#sceneLoading').hidden = true;
  updateMapBadge();
  if (view === '2d') { scene?.setVisible(false); fitMap(); return; }
  if (!scene) {
    $('#sceneLoading').hidden = false;
    try {
      const { createRouteScene } = await import('/scene3d.js');
      if (request !== viewRequest) return;
      scene = createRouteScene($('#scene3d'), { onSelect: selectStop, onReady: () => { $('#sceneLoading').hidden = true; }, onError: () => toast('当前设备暂不支持三维场景，已保留二维地图') });
      if (!scene.available) { scene = null; await setView('2d'); return; }
      if (state.route) scene.setRoute(state.route);
    } catch {
      scene = null;
      await setView('2d');
      toast('三维资源未能加载，请刷新重试');
      return;
    }
  }
  scene.setVisible(true);
  scene.setActiveStop(state.activeStop);
}

function stopPlayback() {
  clearInterval(playTimer);
  state.playing = false;
  $('#playWalk').innerHTML = '<i data-lucide="play"></i>';
  $('#playWalk').setAttribute('aria-label', '自动试走');
  $('#playWalk').title = '自动试走';
  icons();
}

function startPlayback() {
  if (!state.route) return;
  if (state.playing) { stopPlayback(); return; }
  state.playing = true;
  $('#playWalk').innerHTML = '<i data-lucide="pause"></i>';
  $('#playWalk').setAttribute('aria-label', '暂停试走');
  $('#playWalk').title = '暂停试走';
  icons();
  if (state.activeStop === state.route.stops.length - 1) setActiveStop(0, { scroll: true });
  playTimer = setInterval(() => {
    if (document.hidden) return;
    if (state.activeStop === state.route.stops.length - 1) { stopPlayback(); return; }
    setActiveStop(state.activeStop + 1, { scroll: true });
  }, 4200);
}

function saveKey(key) {
  state.deepseekKey = key;
  try { key ? sessionStorage.setItem('deepseekKey', key) : sessionStorage.removeItem('deepseekKey'); } catch { /* Continue with in-memory credentials. */ }
  updateConnectionStatus();
}

$('#routeForm').addEventListener('submit', generateRoute);
$('#promptInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) generateRoute(event);
});
document.querySelectorAll('.prompt-chip').forEach(button => {
  button.addEventListener('click', () => {
    const prompt = button.dataset.prompt || '';
    if (!prompt) return;
    $('#promptInput').value = prompt;
    generateRoute();
  });
});
document.querySelectorAll('.view-toggle button').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#resetView').addEventListener('click', () => state.view === '3d' ? scene?.resetCamera() : fitMap());
$('#prevStop').addEventListener('click', () => selectStop(state.activeStop - 1));
$('#nextStop').addEventListener('click', () => selectStop(state.activeStop + 1));
$('#playWalk').addEventListener('click', startPlayback);
$('#storyboard').addEventListener('keydown', event => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); selectStop(state.activeStop + (event.key === 'ArrowRight' ? 1 : -1)); }
});
$('#storyboard').addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const board = $('#storyboard');
    if (performance.now() < scrollLock || board.scrollWidth <= board.clientWidth + 2 || !state.route) return;
    const cards = [...board.children];
    const left = board.getBoundingClientRect().left;
    const index = cards.reduce((best, card, i) => Math.abs(card.getBoundingClientRect().left - left) < Math.abs(cards[best].getBoundingClientRect().left - left) ? i : best, 0);
    stopPlayback();
    setActiveStop(index);
  }, 130);
});
$('#settingsButton').addEventListener('click', () => {
  $('#deepseekKey').value = state.deepseekKey;
  $('#deepseekKey').type = 'password';
  $('#settingsDialog').showModal();
});
$('#settingsForm').addEventListener('submit', event => event.preventDefault());
$('#closeSettings').addEventListener('click', () => $('#settingsDialog').close());
$('#saveSettings').addEventListener('click', () => {
  const key = $('#deepseekKey').value.trim();
  if (key.length > 256 || /[\r\n]/.test(key)) { toast('API Key 格式不正确'); return; }
  saveKey(key);
  $('#settingsDialog').close();
  toast(state.deepseekKey ? 'Key 已配置，将在生成路线时调用 DeepSeek' : '已清除 Key');
});
$('#clearKey').addEventListener('click', () => { saveKey(''); $('#deepseekKey').value = ''; toast('Key 已清除'); });
$('#toggleKey').addEventListener('click', () => {
  const show = $('#deepseekKey').type === 'password';
  $('#deepseekKey').type = show ? 'text' : 'password';
  $('#toggleKey').setAttribute('aria-label', show ? '隐藏 Key' : '显示 Key');
  $('#toggleKey').title = show ? '隐藏 Key' : '显示 Key';
});
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));

$('#syncButton').addEventListener('click', async () => {
  $('#poiDialog').showModal();
  $('#poiStatus').textContent = '正在读取地点…';
  $('#poiList').replaceChildren();
  try {
    const response = await fetch('/api/ctrip/pois', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: state.route?.title || '', city: state.route?.city || '' }), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '地点暂不可用');
    $('#poiStatus').textContent = result.source === 'mock' ? '演示地点 · 携程接口待接入，尚未同步到携程行程。' : `已获取 ${result.pois.length} 个携程 POI`;
    result.pois.forEach(poi => {
      const item = textElement('div', 'poi-item', '');
      item.append(textElement('strong', '', poi.name), textElement('span', '', poi.type), textElement('p', '', poi.note));
      $('#poiList').appendChild(item);
    });
    if (result.source !== 'mock') { $('#poiConnection').textContent = '已接入'; $('#ctripConfigStatus').textContent = '服务端 POI 已连接'; }
  } catch (error) { $('#poiStatus').textContent = error.message; }
});
$('#closePoi').addEventListener('click', () => $('#poiDialog').close());
$('#exportButton').addEventListener('click', () => {
  if (!state.route) return;
  const blob = new Blob([JSON.stringify({ source: state.source, route: state.route, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'citywalk-route.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

icons();
initMap();
updateConnectionStatus();
try {
  const response = await fetch('/api/demo-route');
  if (!response.ok) throw new Error('示例路线加载失败');
  const result = await response.json();
  renderRoute(result.route || result, 'demo');
} catch (error) {
  $('#generationStatus').textContent = `${error.message}，请刷新或生成一条路线。`;
  $('#generationStatus').classList.add('warning');
}
