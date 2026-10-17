import { wgs84ToGcj02 } from '/coordinates.mjs';
import { findLocationPhoto } from '/location-photos.mjs';
import { initTripContext, readTripContext, validateTripForm, renderTripContext } from '/trip-context.mjs';
import { transportRequest, transportFingerprint, mergeTransport, summarizeLegs, transportSegments } from '/transport.mjs';
import { applySchedule, formatStamp } from '/schedule.mjs';
import { renderSchedule, refreshStopTimes, refreshStopPhoto } from '/schedule-view.mjs';
import { EditSession } from '/itinerary-editor.mjs';
import { createEditorView } from '/editor-view.mjs';
import { daySubset } from '/day-plan.mjs';
import { requestAgent } from '/agent-client.mjs';
import { createAgentView } from '/agent-view.mjs';
import { ConversationState } from '/conversation-state.mjs';
import { createConversationView } from '/conversation-view.mjs';
import { createNavigationView } from '/navigation-view.mjs';
import { createRoadbookView } from '/roadbook-view.mjs';
import { createShareView } from '/share-view.mjs';
import { createLibraryView } from '/library-view.mjs';
import { enableOffline } from '/offline-register.mjs';
import { initWorkspaceUI } from '/ui-interactions.mjs';
import { createWorkspaceRouter } from '/workspace-router.mjs';

const $ = selector => document.querySelector(selector);
const icons = () => window.lucide.createIcons();
let storedKey = '';
try { storedKey = sessionStorage.getItem('deepseekKey') || ''; } catch { /* Private sessions may block storage. */ }
const state = { route: null, deepseekKey: storedKey, serverAI: null, busy: false, activeStop: 0, view: '2d', source: 'demo', workflow: null, poiSource: null, playing: false };
const conversationMemory = new ConversationState();
let scene, map, routeLayer, routePathLayer, routeBounds, mapMarkers = [], playTimer;
let transportRequestId = 0, transportController;
let editSession, workspaceRouter;
const visibleElement = node => node && !node.closest('[data-workspace-view][hidden]');
function focusPrompt() { if (visibleElement($('#promptInput'))) $('#promptInput').focus(); }
function viewOnMap(index) {
  workspaceRouter?.navigate('explore', { focus: false });
  selectStop(index);
  $('#routeTitle').focus({ preventScroll: true });
}
const roadbookView = createRoadbookView({ getRoute: () => state.route, hasDraft: () => !!editSession?.draft, toast });
let generationController, generationRequestId = 0, lastGenerationInput = null;
let selectedDayId = null;
let hotelSelectionBusy = false;
const visibleRoute = () => daySubset(state.route, selectedDayId);
const sceneStopIndex = () => visibleRoute().stops.findIndex(s => s.id === state.route.stops[state.activeStop]?.id);
function renderDayNavigation() {
  for (const panelId of ['dayNavigation', 'roadbookDayNavigation']) {
    const panel = document.getElementById(panelId);
    panel.replaceChildren(textElement('strong', '', '按日预览'));
    const label = textElement('label', '', '查看日期'), select = document.createElement('select');
    select.setAttribute('aria-label', panelId === 'dayNavigation' ? '地图查看日期' : '路书查看日期');
    const all = document.createElement('option'); all.value = ''; all.textContent = '全部行程'; select.append(all);
    for (const day of state.route.days) {
      const option = document.createElement('option'); option.value = day.id;
      option.textContent = `第 ${day.index} 天 · ${day.date || '日期未定'} · ${day.stopIds.length} 个地点`; select.append(option);
    }
    select.value = selectedDayId || '';
    select.addEventListener('change', () => {
      selectedDayId = select.value || null;
      stopPlayback(); renderDayNavigation(); applyDayVisibility(); updateTransportView(state.route);
      document.getElementById(panelId).querySelector('select').focus({ preventScroll: true });
      const index = state.route.stops.findIndex(stop => !selectedDayId || stop.dayId === selectedDayId);
      if (index >= 0) setActiveStop(index, { scroll: true });
      else { $('#walkCounter').textContent = '当天未安排地点'; $('#prevStop').disabled = true; $('#nextStop').disabled = true; }
    });
    label.append(select); panel.append(label);
    const empty = textElement('p', '', '当天还没有地点，请在行程编辑中移入或检索加入。');
    empty.dataset.dayEmpty = ''; empty.hidden = !!visibleRoute().stops.length; panel.append(empty);
  }
}
function applyDayVisibility() {
  const empty=!visibleRoute().stops.length;
  $('#playWalk').disabled=empty;
  document.querySelectorAll('[data-day-empty]').forEach(node => { node.hidden = !empty; });$('.active-stop-strip').hidden=empty;
  state.route.stops.forEach((s,i)=>{
    const shown=!selectedDayId || s.dayId===selectedDayId;
    if($('#storyboard').children[i]) $('#storyboard').children[i].hidden=!shown;
    const item=mapMarkers[i];if(item){if(shown)routeLayer.addLayer(item.marker);else routeLayer.removeLayer(item.marker);}
  });
}
const invalidateEdits = () => { transportController?.abort(); transportRequestId++; };
const editorView = createEditorView({ getSession: () => editSession, selectStop: viewOnMap, invalidate: invalidateEdits,
resetForms: () => { delete $('#scheduleDetails').dataset.revision; updateScheduleView(state.route); }, publish: route => {
  invalidateEdits();
  const activeId = state.route?.stops[state.activeStop]?.id;
  renderRoute(route, route.source, { poiSource: route.poiSource, workflow: state.workflow, edited: true });
  setActiveStop(Math.max(0, route.stops.findIndex(s => s.id === activeId)));
} });
const navigationView = createNavigationView({root:$('#navigationDetails'),getSession:()=>editSession,stage:action=>editorView.stage(action),commit:allow=>editorView.commit(allow),selectStop:viewOnMap,isBusy:()=>state.busy,retryTransport:()=>loadTransport(state.route),revealEditor:()=>workspaceRouter.reveal('itineraryEditor')});
const conversationView = createConversationView({root:$('#conversationPanel'),preferencesRoot:$('#preferencesRoot'),memory:conversationMemory,getRoute:()=>state.route,onMode:mode=>{
  if(state.busy || editSession?.draft || editSession?.busy){toast('请先取消规划、提交或放弃编辑草稿。');return;}
  if(mode==='new'){conversationMemory.reset();conversationView.resetMessages();$('#resetTripConditions').click();}else{conversationMemory.mode='edit';conversationMemory.pending=null;}
  lastGenerationInput=null;$('#retryGeneration').hidden=true;agentView.clear();conversationView.clearQuestion();conversationView.render();
  $('#promptInput').value='';$('#promptInput').placeholder=mode==='edit'?'例如：第一站停留20分钟；把安福路移到第二天。':'告诉我城市和想体验的内容。';focusPrompt();
  $('#generateButton span').textContent=mode==='edit'?'发送修改要求':'生成我的路线';
}});
const agentView = createAgentView({ root: $('#agentReview'), discard: () => {
  conversationView.reply('已放弃这条方案。可以重新提出需求，当前地图中的行程未改变。');
  $('#generationStatus').textContent = '方案已放弃，可以继续输入。';
  focusPrompt();
}, adopt: async (version, result) => {
  if (state.busy) throw new Error('请先等待当前规划结束。');
  if (editSession?.draft || editSession?.busy) throw new Error('还有行程编辑草稿，请先提交或放弃草稿，再采用规划版本。');
  if(result.uiBase && (state.route?.id!==result.uiBase.id || state.route?.revision.number!==result.uiBase.revision))throw new Error('行程已改变，请重新发送要求后再采用。');
  if (!version.route?.stops?.length) throw new Error('此版本没有可用路线，请重试规划。');
  invalidateEdits();
  if (!editSession) editSession = new EditSession(structuredClone(version.route));
  editSession.draft = structuredClone(version.route);
  const route = await editSession.commit(async () => { throw new Error('请在采用后重试交通'); }, { allowIncomplete: true });
  if (!route) throw new Error('采用已取消，当前路线保持不变。');
  route.revision.reason = 'agent-version-selection';
  renderRoute(route, result.source, { ...result, edited: true, transportReady: true });
  result.uiBase={id:route.id,revision:route.revision.number};
  conversationMemory.accept(route,version.id==='current'?[]:version.changes || result.conversation?.changes || []);conversationView.clearQuestion();conversationView.render();
  $('#generateButton span').textContent='发送修改要求';$('#promptInput').value='';$('#promptInput').placeholder='继续说明修改，例如：第一站停留20分钟。';
  conversationView.reply('已更新行程。你可以继续告诉我想调整什么，或查看地图、编辑每日安排。');
  $('#generationStatus').textContent = '行程已更新，可在“行程编辑”中撤销。';
  $('#generationStatus').classList.remove('warning');
  toast('行程已更新');
  return route;
} });
let locationImageRequestId = 0;
const shareView = createShareView({ getRoute: () => state.route, blocked: () => state.busy || !!editSession?.draft || editSession?.busy || agentView.isAdopting(), toast,
  adopt: async candidate => {
    invalidateEdits();
    const revision = structuredClone(candidate.revision);
    if (editSession) {
      editSession.draft = structuredClone(candidate);
      candidate = await editSession.commit(async () => { throw Error('交通待重算'); }, { allowIncomplete: true });
      if (!candidate) throw Error('复制采用已取消，当前行程未改变');
      candidate.revision = revision;
    } else editSession = new EditSession(candidate);
    conversationMemory.reset(); conversationMemory.accept(candidate, []); conversationView.clearQuestion();
    agentView.clear(); lastGenerationInput = null; $('#retryGeneration').hidden = true; $('#promptInput').value = '';
    renderRoute(candidate, candidate.source, { edited: true, poiSource: candidate.poiSource });
    $('#generateButton span').textContent = '发送修改要求';
    $('#generationStatus').textContent = '已建立分享的新副本，原作者的个人记录未沿用；请核对日期及交通未知项。';
    loadTransport(candidate);
    workspaceRouter.navigate('explore');
  }
});
let tileState = '地图正在加载', tileLoaded = false;
const libraryView = createLibraryView({root:$('#libraryRoot'),getRoute:()=>state.route,
  blocked:()=>state.busy || !!editSession?.draft || editSession?.busy || agentView.isAdopting(),
  adopt:async (candidate, rechecked)=>{
    invalidateEdits(); locationImageRequestId++; editorView.reset();
    if(editSession)candidate=editSession.restoreSnapshot(candidate);else editSession=new EditSession(candidate);
    conversationMemory.reset(); conversationMemory.accept(candidate,[]);conversationView.clearQuestion();agentView.clear();
    lastGenerationInput=null;$('#retryGeneration').hidden=true;$('#promptInput').value='';
    renderRoute(candidate,candidate.source,{edited:true,transportReady:true,poiSource:candidate.poiSource});
    $('#generateButton span').textContent='发送修改要求';
    $('#generationStatus').textContent=rechecked?'已采用重新查询的地点；用户条件未独立核实，交通正在重算。':'本机完整快照已恢复，原计划保留但所有来源未重核；可本地编辑。继续可信多轮前请在收藏中联网重核。';
    if(rechecked)loadTransport(candidate);
    workspaceRouter.navigate('explore');
  }
});
$('#libraryButton').addEventListener('click',()=>workspaceRouter.navigate('library'));
window.addEventListener('offline',()=>{
  $('#generationStatus').textContent='当前离线：生成、地图瓦片、地点查询与在线导航不可用。请打开“行程收藏”或独立本机行程库阅读已保存路书。';
  $('#generationStatus').classList.add('warning');
});
document.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href]');
  if(!navigator.onLine && link && new URL(link.href,location.href).origin!==location.origin){event.preventDefault();event.stopPropagation();toast('当前离线，在线导航与来源链接需要网络；可继续阅读已保存路书。');}
},true);
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
  const ready = !!state.deepseekKey || state.serverAI === true;
  $('#dataStatus').textContent = ready ? 'AI 已配置' : state.serverAI === null ? '连接设置' : '设置 AI 后可定制行程';
  const hint = $('#aiSetupHint');
  if (hint) hint.textContent = ready ? '已配置 AI，发送需求即可规划。' : '定制行程需要 DeepSeek Key；也可以先体验示例。';
}

async function loadCapabilities() {
  try {
    const response = await fetch('/api/capabilities');
    if (!response.ok) return;
    const capabilities = await response.json();
    state.serverAI = capabilities.aiConfigured === true;
    updateConnectionStatus();
    if (!state.deepseekKey && !state.serverAI) $('#configureGeneration').hidden = false;
  } catch { /* A failed configuration lookup must not block the planner. */ }
}

function coordinates(stop) {
  const lat = Number(stop.location?.lat ?? stop.coordinates?.[1]);
  const lng = Number(stop.location?.lng ?? stop.coordinates?.[0]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

// 高德国内瓦片使用 GCJ-02；路线和携程 POI 仍保留 WGS84，只有绘图时转换。
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
    if (state.view !== '2d' || !visibleElement($('#mapCanvas'))) return;
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

function drawRoutePath(route) {
  route = daySubset(route,selectedDayId);
  routePathLayer.clearLayers();
  const bounds = route.stops.map(coordinates).filter(Boolean).map(mapCoordinates);
  for (const segment of transportSegments(route)) {
    const geometry = segment.coordinates.map(mapCoordinates);
    bounds.push(...geometry);
    const style = segment.illustrative ? { dashArray: '7 9' } : {};
    L.polyline(geometry, { color: '#fff', weight: 8, opacity: .95, interactive: false, ...style }).addTo(routePathLayer);
    L.polyline(geometry, { color: segment.color, weight: 4, ...style }).bindTooltip(textElement('span', '', `${segment.mode || '待确认'} · ${segment.status}`)).addTo(routePathLayer);
  }
  routeBounds = bounds.length ? L.latLngBounds(bounds) : null;
  fitMap();
}

function updateTransportView(route, busy = false) {
  updateScheduleView(route);
  navigationView.render();
  const total = summarizeLegs(route.legs || []);
  $('#routeDistance').textContent = total.unknownCount === total.legCount ? '高德查看' : `${total.unknownCount ? '已查 ' : total.estimatedCount ? '约 ' : ''}${(total.distanceMeters / 1000).toFixed(2)} km`;
  $('#routeDistance').title = '已获取的交通距离；实际出行路线可在高德导航中查看';
  setRoutePathStatus(busy ? '正在准备路线…' : total.unknownCount || total.estimatedCount ? '虚线路段为空间示意 · 实际路线查看高德' : '路线预览 · 高德导航出行');
  drawRoutePath(route);
  scene?.setRoute(visibleRoute());
  scene?.setActiveStop(sceneStopIndex());
}

function updateScheduleView(route) {
  if(!route.restoration || route.stops.some(s=>!s.schedule) || route.days.some(d=>!d.schedule)) applySchedule(route);
  renderSchedule(route, { selectStop, dayId:selectedDayId, selectHotel: chooseHotel, hotelBusy: hotelSelectionBusy || state.busy });
  markTravelStop(route.stops[state.activeStop]?.id);
  refreshStopTimes(route);
  const activeArrival = route.stops[state.activeStop]?.schedule?.arrival;
  $('#activeTime').textContent = activeArrival ? formatStamp(activeArrival) : '自由安排';
  const first = route.days.find(d => d.stopIds.length), last = route.days.filter(d => d.stopIds.length).at(-1);
  $('#startTime').textContent = first?.schedule?.start ? `${formatStamp(first.schedule.start)} 计划出发` : '按每日计划出发';
  $('#endTime').textContent = last?.schedule?.end ? `${formatStamp(last.schedule.end)} 计划结束` : '按旅途节奏收尾';
  const planned = route.days.filter(d => d.stopIds.length);
  $('#routeDuration').textContent = planned.some(d => d.schedule.elapsedMinutes == null) ? `${route.days.length} 天行程` : `约 ${planned.reduce((n, d) => n + d.schedule.elapsedMinutes, 0)} 分钟`;
  $('#routeDuration').title = '计划时段参考，实际出行时间请结合高德导航与现场安排';
}

async function chooseHotel(hotelId) {
  if (hotelSelectionBusy || state.busy || editSession?.busy || agentView.hasPending()) { toast('请先完成当前规划或采用方案，再选择住宿。'); return; }
  if (editSession?.draft) { toast('请先到“行程编辑”提交或放弃草稿，再选择住宿。'); return; }
  const session = editSession;
  if (!session) return;
  hotelSelectionBusy = true; updateScheduleView(state.route);
  try {
    if (!editorView.stage({ type: 'hotel', hotelId }, true, false)) { toast('酒店选择未保存，请到“行程编辑”查看原因。'); return; }
    await editorView.commit(true);
    if (session === editSession && session.current.hotels?.selectedId === hotelId) toast('住宿已加入出游计划，可在“行程编辑”撤销选择。');
  } finally { hotelSelectionBusy = false; if (state.route) updateScheduleView(state.route); }
}

async function loadTransport(route) {
  transportController?.abort();
  const controller = new AbortController();
  transportController = controller;
  const requestId = ++transportRequestId;
  const revision = route.revision?.number;
  const fingerprint = transportFingerprint(route);
  const current = () => requestId === transportRequestId && state.route === route && route.revision?.number === revision && transportFingerprint(route) === fingerprint;
  updateTransportView(route, true);
  const timeout = setTimeout(() => controller.abort(), 210000);
  try {
    const response = await fetch('/api/transport-route', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transportRequest(route)), signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error('交通暂不可用');
    if (!current()) return;
    if (!mergeTransport(route, result, fingerprint)) throw new Error('交通版本不匹配');
    if(route.restoration)applySchedule(route);
    updateTransportView(route);
  } catch {
    if (!current()) return;
    // Preserve earlier successful results when only a refresh failed.
    if (!(route.legs || []).some(l => ['routed', 'estimated'].includes(l.status))) {
      route.legs = route.legs.map(l => l.booking ? l : ({ ...l, status: 'unavailable', warning: '交通请求未完成，请重试；没有可用耗时' }));
      route.planning.transportStatus = 'incomplete';
    }
    updateTransportView(route);
    setRoutePathStatus('路线预览 · 实际出行请打开高德导航');
  } finally { clearTimeout(timeout); }
}
function fitMap() {
  if (map && routeBounds && state.view === '2d' && visibleElement($('#mapCanvas'))) {
    map.invalidateSize();
    map.fitBounds(routeBounds, { padding: [52, 55], maxZoom: 16, animate: false });
  }
}

function renderMap(route, calculate = true) {
  transportController?.abort();
  routeLayer.clearLayers();
  routePathLayer.clearLayers();
  mapMarkers = [];
  const points = route.stops.map(coordinates);
  if (points.some(point => !point)) return;
  drawRoutePath(route);
  setRoutePathStatus('正在准备路线预览…');
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
  applyDayVisibility();
  scene?.setRoute(visibleRoute());
  if (calculate) loadTransport(route); else updateTransportView(route);
}

function markTravelStop(stopId, scroll = false) {
  document.querySelectorAll('#scheduleDetails .travel-stop').forEach(row => {
    const active = row.dataset.stopId === stopId;
    row.classList.toggle('active', active);
    row.querySelector('.travel-stop-title')?.setAttribute('aria-current', active ? 'step' : 'false');
    if (active && scroll && visibleElement(row)) row.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' });
  });
}

function setActiveStop(index, { scroll = false } = {}) {
  if (!state.route?.stops.length) return;
  index = Math.max(0, Math.min(index, state.route.stops.length - 1));
  state.activeStop = index;
  const stop = state.route.stops[index];
  if(selectedDayId && stop.dayId!==selectedDayId){selectedDayId=stop.dayId;renderDayNavigation();applyDayVisibility();updateTransportView(state.route);}
  markTravelStop(stop.id, scroll);
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
  scene?.setActiveStop(sceneStopIndex());
  $('#activeNumber').textContent = String(index + 1).padStart(2, '0');
  $('#activeName').textContent = stop.name;
  $('#activeNote').textContent = stop.note;
  $('#activeTime').textContent = stop.schedule?.arrival ? formatStamp(stop.schedule.arrival) : '自由安排';
  $('#walkCounter').textContent = `${String(index + 1).padStart(2, '0')} / ${String(state.route.stops.length).padStart(2, '0')}`;
  $('.progress-line span').style.width = `${((index + 1) / state.route.stops.length) * 100}%`;
  $('#prevStop').disabled = index === 0 || Boolean(selectedDayId && state.route.stops[index-1]?.dayId!==selectedDayId);
  $('#nextStop').disabled = index === state.route.stops.length - 1 || Boolean(selectedDayId && state.route.stops[index+1]?.dayId!==selectedDayId);
}

function selectStop(index) { stopPlayback(); setActiveStop(index, { scroll: true }); }

function imageLabel(stop, source) {
  if (stop.imageSource) {
    const distance = Number.isFinite(stop.distanceMeters) ? ` · ${stop.distanceMeters} m` : '';
    const kind = stop.imageKind === 'street-photo' ? `街景照片${distance}` : stop.imageKind === 'location-photo' ? '位置照片' : stop.imageKind === 'nearby-photo' ? `附近照片${distance}` : '参考照片';
    return `${kind} · ${stop.imageSource}`;
  }
  return stop.image && source === 'demo' ? '本地演示图 · 来源说明' : '暂无授权位置照片';
}

async function findBrowserLocationImage(stop, city = '') {
  return findLocationPhoto({ lat: stop.location?.lat, lng: stop.location?.lng, name: stop.name, city: stop.city || city });
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
      if (!imageWrap.contains(image) || !$('#storyboard').contains(card) || !state.route?.stops.includes(stop)) return;
      const fallback = stop.fallbackPhoto;
      if (fallback?.image && fallback.image !== stop.image) {
        Object.assign(stop, fallback);
        delete stop.fallbackPhoto;
        replaceStoryImage(card, stop, source);
        refreshStopPhoto(stop);
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
  updateScheduleView(route);
}

function renderImagePlaceholder(imageWrap, stop, source) {
  const placeholder = textElement('div', 'story-image-placeholder', '');
  placeholder.append(textElement('strong', '', '暂无地点照片'), textElement('span', '', '仍可查看地点和路线安排'));
  placeholder.setAttribute('aria-label', `${stop.name}暂无地点照片`);
  imageWrap.appendChild(placeholder);
}

function renderRoute(route, source = 'demo', metadata = {}) {
  stopPlayback();
  if (!metadata.edited) {
    editSession?.discard();
    editorView.reset();
    editSession = new EditSession(route);
  }
  state.route = route;
  conversationView.render();
  if(!metadata.edited || !route.days.some(d=>d.id===selectedDayId)) selectedDayId=null;
  renderDayNavigation();
  editorView.render();
  navigationView.render();
  renderTripContext(route);
  state.source = source;
  state.workflow = Array.isArray(metadata.workflow) ? metadata.workflow : null;
  state.poiSource = metadata.poiSource || null;
  if (state.poiSource === 'ctrip') {
    $('#poiConnection').textContent = '已接入';
    $('#ctripConfigStatus').textContent = '携程地点查询已连接';
  }
  state.activeStop = 0;
  $('#routeCity').textContent = route.city;
  $('#routeTitle').textContent = route.title;
  document.querySelectorAll('[data-current-route-title]').forEach(node => { node.textContent = route.title; });
  $('#routeSummary').textContent = route.summary;
  const workflow = $('#workflowTrail');
  workflow.textContent = state.workflow?.length ? state.workflow.join('  →  ') : source === 'demo' ? '演示路线 · 未调用外部 AI 与 POI 服务' : '';
  $('#routeMood').textContent = route.mood;
  $('#routeDistance').textContent = route.distance;
  $('#routeDistance').removeAttribute('title');
  $('#routeDuration').textContent = route.duration;
  $('#routeSource').textContent = source === 'deepseek'
    ? `AI 规划 · ${metadata.poiSource === 'ctrip' ? '携程地点' : '示例地点'}`
    : source === 'demo-fallback' ? '示例回退' : '示例路线';
  $('#coordinateStatus').textContent = source === 'deepseek'
    ? (metadata.poiSource === 'ctrip' ? '地点来自携程' : '示例地点') : '示例地点';
  if (route.revision.reason !== 'generated') {
    $('#routeSource').textContent = source === 'deepseek' ? 'AI 规划 · 已调整' : '示例行程 · 已调整';
    $('#coordinateStatus').textContent = '地点来源可查看';
    $('#routeSummary').textContent = '行程已调整，具体安排以当前地点和每日时间表为准。';
    $('#workflowTrail').textContent = '用户编辑已提交 · 地点来源逐点保留 · 交通与时间轴已重新检查';
  }
  if (source === 'shared-copy') {
    $('#routeSource').textContent = '分享行程 · 地点已重新查询';
    $('#routeSummary').textContent = route.summary;
    $('#workflowTrail').textContent = '新行程身份 · 地点重新查询 · 日期与停留沿用用户计划 · 交通见分段状态';
    $('#coordinateStatus').textContent = '地点来自携程';
  }
  if (source === 'local-rechecked') {
    $('#routeSource').textContent='收藏行程 · 地点已重新查询';
    $('#workflowTrail').textContent='地点重新查询 · 个人条件与已游览为用户记录 · 交通见分段状态';
    $('#coordinateStatus').textContent='地点已重新查询';
  }
  if(route.restoration?.status==='unverified-local') {
    $('#routeSource').textContent='收藏行程 · 地点待重新核对';
    $('#workflowTrail').textContent='文件/本机来源声明均未重核 · 原计划快照不保证今日可行 · 可信多轮需在收藏中联网重核';
    $('#coordinateStatus').textContent='地点待重新核对';
    $('#poiConnection').textContent='未重核';
    $('#ctripConfigStatus').textContent='本机快照不能证明当前服务连接';
  }
  $('#stopsSummary').textContent = `${route.stops.length} 个地点`;
  $('#startTime').textContent = `${route.stops[0].time} 出发`;
  $('#endTime').textContent = `${route.stops.at(-1).time} 收尾`;
  const board = $('#storyboard');
  board.replaceChildren();
  $('#stopList').replaceChildren();
  route.stops.forEach((stop, index) => {
    const card = document.createElement('article');
    card.className = 'story-card';
    card.dataset.stopId = stop.id;
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
    item.dataset.stopId = stop.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.append(textElement('span', 'stop-dot', index + 1), textElement('span', 'stop-label', stop.name), textElement('time', '', stop.time));
    button.title = `在地图查看 ${stop.name}`;
    button.addEventListener('click', () => viewOnMap(index));
    item.appendChild(button);
    $('#stopList').appendChild(item);
  });
  board.scrollLeft = 0;
  renderMap(route, !metadata.edited && !metadata.transportReady);
  setActiveStop(0);
  if(!route.restoration)hydrateRouteImages(route, source);
}

async function generateRoute(event, retry = false, example = false) {
  event?.preventDefault();
  if(!navigator.onLine){toast('当前离线，请打开本机行程库阅读缓存路书；生成与在线导航需要网络。');return;}
  if(!example && conversationMemory.mode==='edit' && state.route?.restoration?.status==='unverified-local'){toast('本机恢复尚未核实：请在收藏中联网重核全部地点后采用，或使用手动编辑。');return;}
  if (state.busy || agentView.isAdopting()) return;
  if (!example && agentView.hasPending()) {
    $('#generationStatus').textContent = '请先使用或放弃下方方案，再继续调整；你的输入已保留。';
    if (workspaceRouter.current() === 'explore') $('#agentReview').scrollIntoView({ block:'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    toast('先使用这条行程，就能继续对话调整');
    return;
  }
  if(editSession?.draft || editSession?.busy){toast('请先提交或放弃编辑草稿，再继续规划。');return;}
  let input;
  if (retry && lastGenerationInput) input = lastGenerationInput;
  else {
    const prompt = $('#promptInput').value.trim();
    if (!prompt) { toast('写下你想漫步的城市和偏好'); focusPrompt(); return; }
    if (prompt.length > 500) { toast('路线描述请控制在 500 字以内'); return; }
    if (!example && conversationMemory.mode==='new' && !validateTripForm(target => workspaceRouter.reveal(target, { focus: false }))) return;
    input = { prompt, context: conversationMemory.mode==='new'?readTripContext():{} };
    if(!example)input.conversation=conversationMemory.request(state.route);
    else input.exampleCity = /北京|南京|上海/.exec(prompt)?.[0] || '上海';
  }
  if(input.conversation?.mode==='edit') input={...input,currentRoute:structuredClone(state.route)};
  const uiBase=state.route?{id:state.route.id,revision:state.route.revision.number}:null;
  lastGenerationInput = structuredClone(input);
  const requestId = ++generationRequestId;
  const controller = generationController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 240000);
  const current = () => generationRequestId === requestId && !controller.signal.aborted;
  let canRetry = false;
  state.busy = true;
  if (!retry) conversationView.submitted(input.exampleCity ? `看看${input.exampleCity}示例` : input.prompt);
  const focusPlanning = [$('#generateButton'),$('#retryGeneration')].includes(document.activeElement);
  conversationView.busy(true);
  if (input.exampleCity) agentView.clear(); else agentView.start();
  $('#cancelGeneration').hidden = false;
  $('#retryGeneration').hidden = true;
  $('#configureGeneration').hidden = true;
  stopPlayback();
  const button = $('#generateButton');
  button.disabled = true;
  button.classList.add('loading');
  button.querySelector('span').textContent = '正在规划…';
  if(focusPlanning)$('#cancelGeneration').focus({preventScroll:true});
  $('#generationStatus').classList.remove('warning');
  $('#generationStatus').textContent = input.exampleCity ? '正在打开示例…' : '正在整理你的旅行需求…';
  try {
    if (input.exampleCity) {
      const response = await fetch(`/api/demo-route?city=${encodeURIComponent(input.exampleCity)}`, { signal: controller.signal });
      if (!response.ok) throw Error('示例暂时无法打开，请重试。');
      const exampleResult = await response.json();
      if (!current()) return;
      invalidateEdits();
      renderRoute(exampleResult.route, 'demo');
      conversationMemory.accept(exampleResult.route, []);
      conversationView.clearQuestion();conversationView.render();
      conversationView.reply(`已打开${input.exampleCity}示例。可以在地图预览，也可以编辑、收藏或导出这条行程。`);
      $('#promptInput').value = '';
      $('#promptInput').placeholder = '继续调整，例如：第一站停留20分钟。';
      $('#generationStatus').textContent = '当前为示例行程。定制新路线请点“新行程”。';
      return;
    }
    const result = await requestAgent({ ...input, apiKey: state.deepseekKey }, { signal: controller.signal, onProgress: event => {
      if (!current()) return;
      agentView.progress(event);
      $('#generationStatus').textContent = agentView.message();
    } });
    if (!current()) return;
    if(result.conversation?.status==='reply'){
      conversationMemory.pending=null;conversationView.clearQuestion();agentView.clear();
      conversationView.reply(result.conversation.reply);$('#generationStatus').textContent='可以继续对话，当前行程未改变。';
      $('#promptInput').value='';focusPrompt();return;
    }
    if(result.conversation?.status==='clarify'){
      conversationView.clarify(result.conversation);agentView.clear();
      $('#generationStatus').textContent='回答上面的问题即可继续。';$('#promptInput').value='';$('#promptInput').placeholder='在这里回答…';focusPrompt();return;
    }
    result.uiBase=uiBase;
    conversationMemory.pending=null;conversationView.clearQuestion();conversationView.render();
    agentView.complete(result);
    conversationView.reply([result.conversation?.reply || result.agent?.reason || '行程方案准备好了。查看下方安排，点击“使用这条行程”后地图会更新。', ...new Set(result.conversation?.notices || [])].join(' '));
    $('#generationStatus').textContent = '请查看下方方案并确认使用。';
    $('#generationStatus').classList.remove('warning');
    $('#promptInput').value='';
    if (workspaceRouter.current() === 'explore') $('#agentReview').scrollIntoView({ block:'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  } catch (error) {
    if (generationRequestId !== requestId) return;
    const message = controller.signal.aborted ? timedOut ? '规划超时，当前路线已保留，可重试。' : '规划已取消，当前路线已保留。' : error instanceof TypeError ? '网络连接中断，当前路线已保留，可重试。' : error.message;
    $('#generationStatus').classList.add('warning');
    $('#generationStatus').textContent = message;
    if (workspaceRouter.current() !== 'explore') toast(message);
    agentView.clear();
    conversationView.reply(message);
    canRetry = true;
    if (error.action === 'settings' || ['MODEL_KEY_REQUIRED','MODEL_AUTH'].includes(error.code)) $('#configureGeneration').hidden = false;
  } finally {
    clearTimeout(timeout);
    if (generationRequestId !== requestId) return;
    state.busy = false;
    conversationView.busy(false);
    generationController = null;
    const returnFocus = document.activeElement === $('#cancelGeneration');
    $('#cancelGeneration').hidden = true;
    $('#retryGeneration').hidden = !canRetry;
    button.disabled = false;
    button.classList.remove('loading');
    button.querySelector('span').textContent = conversationMemory.pending?'回答并继续':conversationMemory.mode==='edit'?'发送修改要求':'生成我的路线';
    if(returnFocus && workspaceRouter.current() === 'explore')(canRetry?$('#retryGeneration'):$('#promptInput')).focus();
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
      scene = createRouteScene($('#scene3d'), { onSelect: i => selectStop(state.route.stops.findIndex(s=>s.id===visibleRoute().stops[i]?.id)), onReady: () => { $('#sceneLoading').hidden = true; }, onError: () => toast('当前设备暂不支持三维场景，已保留二维地图') });
      if (!scene.available) { scene = null; await setView('2d'); return; }
      if (state.route) scene.setRoute(visibleRoute());
    } catch {
      scene = null;
      await setView('2d');
      toast('三维资源未能加载，请刷新重试');
      return;
    }
  }
  scene.setVisible(workspaceRouter?.current() === 'explore');
  scene.setActiveStop(sceneStopIndex());
}

function stopPlayback() {
  clearInterval(playTimer);
  state.playing = false;
  $('#playWalk').innerHTML = '<i data-lucide="play"></i>';
  $('#playWalk').setAttribute('aria-label', '自动试走');
  $('#playWalk').setAttribute('aria-pressed', 'false');
  $('#playWalk').title = '自动试走';
  icons();
}

function startPlayback() {
  if (!state.route) return;
  if (state.playing) { stopPlayback(); return; }
  const indices=state.route.stops.map((s,i)=>!selectedDayId || s.dayId===selectedDayId ? i : -1).filter(i=>i>=0);
  if(!indices.length) {toast('这一天还没有安排地点');return;}
  state.playing = true;
  $('#playWalk').innerHTML = '<i data-lucide="pause"></i>';
  $('#playWalk').setAttribute('aria-label', '暂停试走');
  $('#playWalk').setAttribute('aria-pressed', 'true');
  $('#playWalk').title = '暂停试走';
  icons();
  if (state.activeStop === indices.at(-1)) setActiveStop(indices[0], { scroll: true });
  playTimer = setInterval(() => {
    if (document.hidden) return;
    if (state.activeStop === indices.at(-1)) { stopPlayback(); return; }
    setActiveStop(state.activeStop + 1, { scroll: true });
  }, 4200);
}

function saveKey(key) {
  state.deepseekKey = key;
  try { key ? sessionStorage.setItem('deepseekKey', key) : sessionStorage.removeItem('deepseekKey'); } catch { /* Continue with in-memory credentials. */ }
  updateConnectionStatus();
  $('#configureGeneration').hidden = !!key || state.serverAI === true;
}

$('#routeForm').addEventListener('submit', generateRoute);
$('#cancelGeneration').addEventListener('click', () => generationController?.abort());
$('#retryGeneration').addEventListener('click', event => generateRoute(event, true));
$('#promptInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) generateRoute(event);
});
document.querySelectorAll('.prompt-chip').forEach(button => {
  button.addEventListener('click', () => {
    const prompt = button.dataset.prompt || '';
    if (!prompt) return;
    if(state.busy || editSession?.draft){toast('请先结束当前规划或编辑。');return;}
    conversationMemory.reset();conversationView.resetMessages();conversationView.clearQuestion();conversationView.render();
    $('#promptInput').value = prompt;
    generateRoute(undefined,false,true);
  });
});
document.querySelectorAll('.view-toggle button').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#resetView').addEventListener('click', () => state.view === '3d' ? scene?.resetCamera() : fitMap());
$('#prevStop').addEventListener('click', () => selectStop(state.activeStop - 1));
$('#nextStop').addEventListener('click', () => selectStop(state.activeStop + 1));
$('#playWalk').addEventListener('click', startPlayback);
$('#scheduleDetails').addEventListener('keydown', event => {
  if (!state.route || event.target.closest('a,input,select,textarea,button:not(.travel-stop-title)')) return;
  if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
  const indices=state.route.stops.map((s,i)=>!selectedDayId || s.dayId===selectedDayId ? i : -1).filter(i=>i>=0);
  if (!indices.length) return;
  event.preventDefault();
  const focusedId = event.target.closest('.travel-stop')?.dataset.stopId;
  const focusedIndex = focusedId ? state.route.stops.findIndex(stop => stop.id === focusedId) : state.activeStop;
  const position=Math.max(0,indices.indexOf(focusedIndex));
  const next=event.key==='Home'?indices[0]:event.key==='End'?indices.at(-1):indices[Math.max(0,Math.min(indices.length-1,position+(event.key==='ArrowRight'?1:-1)))];
  selectStop(next);
  [...$('#scheduleDetails').querySelectorAll('.travel-stop')].find(row => row.dataset.stopId === state.route.stops[next].id)?.focus({preventScroll:true});
});
$('#settingsButton').addEventListener('click', () => workspaceRouter.navigate('settings'));
$('#configureGeneration').addEventListener('click', () => $('#settingsButton').click());
$('#settingsForm').addEventListener('submit', event => event.preventDefault());
$('#closeSettings').addEventListener('click', () => workspaceRouter.navigate('explore'));
$('#saveSettings').addEventListener('click', () => {
  const key = $('#deepseekKey').value.trim();
  if (key.length > 256 || /[\r\n]/.test(key)) { toast('API Key 格式不正确'); return; }
  saveKey(key);
  $('#deepseekKey').type = 'password';
  $('#toggleKey').setAttribute('aria-label', '显示 Key');
  $('#toggleKey').title = '显示 Key';
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

let poiController, poiRequest = 0;
async function loadPois() {
  poiController?.abort();
  const token=++poiRequest, controller=poiController=new AbortController();
  const timer=setTimeout(()=>controller.abort(),35000);
  if (!$('#poiDialog').open) $('#poiDialog').showModal();
  const focusRetry=document.activeElement===$('#retryPoi');
  $('#cancelPoi').hidden=false;$('#retryPoi').hidden=true;
  if(focusRetry)$('#cancelPoi').focus({preventScroll:true});
  $('#poiStatus').textContent = '正在读取地点…';
  $('#poiList').replaceChildren();
  try {
    if (!navigator.onLine) throw Error('当前离线，地点查询需要网络；可继续阅读本机收藏。');
    const currentStop = state.route?.stops?.[state.activeStop];
    const response = await fetch('/api/ctrip/pois', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: currentStop?.name || state.route?.title || '', city: currentStop?.city || state.route?.city || '', intent: { startingPoint: currentStop?.name || '', context: state.route?.context } }), signal: controller.signal });
    const result = await response.json();
    if(token!==poiRequest || !$('#poiDialog').open)return;
    if (!response.ok) throw new Error(result.error || '地点暂不可用');
    $('#poiStatus').textContent = !result.pois.length ? '没有找到地点，可重试或切换当前站点后查询。' : result.source === 'mock' ? '以下是示例地点。' : `找到 ${result.pois.length} 个携程地点。`;
    result.pois.forEach(poi => {
      const item = textElement('div', 'poi-item', '');
      item.append(textElement('strong', '', poi.name), textElement('span', '', poi.type), textElement('p', '', poi.note));
      if (poi.detailUrl) {
        const link = textElement('a', '', '在携程查看地点');
        link.href = poi.detailUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        item.appendChild(link);
      }
      $('#poiList').appendChild(item);
    });
    if (result.source !== 'mock') { $('#poiConnection').textContent = '已接入'; $('#ctripConfigStatus').textContent = '服务端 POI 已连接'; }
  } catch (error) { if(token===poiRequest)$('#poiStatus').textContent = controller.signal.aborted?'地点查询已取消或超时，可重试；当前行程未变。':error.message; }
  finally {clearTimeout(timer);if(token===poiRequest){poiController=null;const focused=document.activeElement===$('#cancelPoi');$('#cancelPoi').hidden=true;$('#retryPoi').hidden=false;if(focused)$('#retryPoi').focus();}}
}
$('#syncButton').addEventListener('click',loadPois);
$('#quickPoi').addEventListener('click',loadPois);
$('#retryPoi').addEventListener('click',loadPois);
$('#cancelPoi').addEventListener('click',()=>poiController?.abort());
$('#poiDialog').addEventListener('close',()=>{poiRequest++;poiController?.abort();poiController=null;});
$('#closePoi').addEventListener('click', () => $('#poiDialog').close());
$('#exportButton').addEventListener('click', () => roadbookView.exportJson());

icons();
initTripContext();
initMap();
updateConnectionStatus();
loadCapabilities();
$('#deepseekKey').value = state.deepseekKey;
workspaceRouter = createWorkspaceRouter({ onChange: ({ view, previous }) => {
  if (previous && previous !== view) stopPlayback();
  scene?.setVisible(view === 'explore' && state.view === '3d');
  if (previous === 'library' && view !== 'library') libraryView.close();
  if (view === 'library') {
    libraryView.open().catch(() => toast('收藏暂时无法打开，请重试。'));
    enableOffline().then(message => { $('#offlineStatus').textContent = message; }).catch(() => { $('#offlineStatus').textContent = '离线入口暂未准备好，可继续使用本机收藏。'; });
  }
  if (previous === 'settings' && view !== 'settings') {
    $('#deepseekKey').type = 'password';
    $('#toggleKey').setAttribute('aria-label', '显示 Key'); $('#toggleKey').title = '显示 Key';
  }
  if (view === 'explore') requestAnimationFrame(() => { if (workspaceRouter?.current() === 'explore') fitMap(); });
} });
initWorkspaceUI(()=>({route:state.route,busy:state.busy,draft:!!editSession?.draft,editing:!!editSession?.busy}), { reveal: target => workspaceRouter.reveal(target) });
if (new URL(location.href).searchParams.get('copy') === 'share') await shareView.incoming();
const initialRequestId = generationRequestId;
try {
  const saved=new URL(location.href).searchParams;
  if(saved.has('library')) {
    const route=await libraryView.route(saved.get('library'),saved.get('version'));
    if (initialRequestId !== generationRequestId || state.route) throw Object.assign(Error('superseded'), { superseded:true });
    renderRoute(route,route.source,{transportReady:true,poiSource:route.poiSource});
    conversationMemory.accept(route,[]);conversationView.render();$('#generateButton span').textContent='发送修改要求';
    $('#generationStatus').textContent='已重开本机完整版本，来源与原计划未核实；可手动编辑，可信多轮需在收藏中联网重核。';
    const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('library'); cleanUrl.searchParams.delete('version');
    history.replaceState(null, '', cleanUrl.href);
  } else {
  const response = await fetch('/api/demo-route');
  if (!response.ok) throw new Error('示例路线加载失败');
  const result = await response.json();
  if (initialRequestId === generationRequestId && !state.route) renderRoute(result.route || result, 'demo');
  }
} catch (error) {
  if (!error.superseded && initialRequestId === generationRequestId && !state.route) {
    $('#generationStatus').textContent = `${error.message}，请刷新或生成一条路线。`;
    $('#generationStatus').classList.add('warning');
  }
}


