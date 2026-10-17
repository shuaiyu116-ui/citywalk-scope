// Public file format, deliberately separate from signed /api/agent-route input.
// An explicit tree allowlist prevents future private state leaking into exports.
const str = 'string', num = 'number', bool = 'boolean';
const stamp = { date: str, time: str, dayOffset: num };
const suggestion = { type: str, message: str, stopId: str, minutes: num };
const check = { code: str, status: str, message: str, stopId: str, legId: str, suggestions: [suggestion] };
const schedule = {
  status: str, arrival: stamp, visitStart: stamp, visitEnd: stamp, departure: stamp,
  start: stamp, end: stamp, deadline: stamp, stayMinutes: num, restMinutes: num,
  waitMinutes: num, elapsedMinutes: num, transportMinutes: num, knownWaitMinutes: num,
  walkingMeters: num, remainingMinutes: num, playBudgetMinutes: num,
  timingBasis: str, staySource: str, openingSource: str, checks: [check]
};
const fact = { status: str, text: str, source: str, url: 'url', retrievedAt: str, providerUpdatedAt: str, verifiedAt: str };
const rules = { periods: [{ start: str, end: str }], closedWeekdays: [num], closedDates: [str], validFrom: str, validTo: str, note: str, recordedAt: str, source: str };
const hotel = { id: str, name: str, city: str, address: str, location: { lat: num, lng: num }, image: 'url', detailUrl: 'url',
  source: str, provider: str, retrievedAt: str, rating: num, stars: num, area: str, description: str,
  taxIncluded: bool, coordinateSystem: str, priceLabel: str, price: { amount: num, currency: str, unit: str, description: str } };
const schema = {
  schemaVersion: num, id: str, city: str, title: str, summary: str, mood: str, source: str, poiSource: str,
  restoration: { status: str, restoredAt: str },
  hotels: { status: str, request: { cityName: str, landmarkName: str, hotelName: str, checkInDate: str, checkOutDate: str, maxPrice: num, tags: str, stars: str, sortType: str,
    requested: bool, checkIn: str, checkOut: str, budgetMax: num, area: str, roomCount: num, adultCount: num, childCount: num, requirements: str },
    candidates: [hotel], selectedId: str, message: str, queriedAt: str },
  revision: { number: num, parentRevision: num, createdAt: str, updatedAt: str, reason: str },
  context: { startDate: str, dailyStartTime: str, dailyEndTime: str, dayCount: num, transportMode: str, companions: [str], maxWalkKm: num },
  days: [{ id: str, index: num, date: str, status: str, stopIds: [str], legIds: [str], requestedWindow: { start: str, end: str }, restMinutes: num, lodging: { text: str, source: str, status: str }, schedule }],
  stops: [{ id: str, poiId: str, dayId: str, name: str, city: str, address: str, type: str, note: str,
    location: { lat: num, lng: num }, coordinateSource: str, coordinateStatus: str, detailUrl: 'url',
    image: 'url', imageSource: str, imageKind: str, imagePageUrl: 'url', imageAttribution: str, imageTitle: str, imageCapturedAt: str,
    openingHours: fact, guide: { description: str, openingText: str, url: 'url', source: str, retrievedAt: str }, evidenceIds: [str], locked: bool, visit: { stayMinutes: num, restMinutes: num, openingRules: rules },
    schedule, progress: { completed: bool, source: str, schedule }
  }],
  legs: [{ id: str, dayId: str, fromDayId: str, kind: str, fromStopId: str, toStopId: str,
    preferredMode: str, mode: str, status: str, routingStatus: str, source: str, retrievedAt: str, attemptedAt: str,
    durationMinutes: num, distanceMeters: num, warning: str, selectionReason: str, evidenceIds: [str],
    geometry: { type: str, kind: str, coordinateSystem: str, coordinateOrder: str, coordinates: [[num]] },
    estimate: { straightLineMeters: num, detourFactor: num, speedKmh: num },
    booking: { departure: str, arrival: str, label: str, beforeMinutes: num, afterMinutes: num, durationMinutes: num, source: str, verifiedAt: str }
  }],
  evidence: [{ id: str, subjectId: str, field: str, ...fact }],
  planning: { status: str, scheduleStatus: str, transportStatus: str, dayAssignmentStatus: str, notices: [str] }
};
export const MAX_PORTABLE_BYTES = 8 * 1024 * 1024;
export function publicText(value) {
  return String(value ?? '').replace(/\bsk-[a-z0-9_-]{8,}/gi, '[已移除密钥]').replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/gi, '[已移除凭据]');
}
export function safePublicUrl(value) {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return '';
    // Do not copy signed/token-bearing upstream URLs to portable documents.
    if ([...u.searchParams.keys()].some(k => /token|key|auth|secret|signature|credential|proof/i.test(k)) || /\bsk-[a-z0-9_-]{8,}/i.test(u.href)) return '';
    return u.href;
  } catch { return ''; }
}
function project(value, rule) {
  if (value == null) return null;
  if (rule === str) {
    if (typeof value !== 'string' || value.length > 12000) throw new Error('文件包含过长或无效的文字字段。');
    return publicText(value);
  }
  if (rule === num) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('文件包含无效数值。');
    return value;
  }
  if (rule === bool) { if (typeof value !== 'boolean') throw new Error('文件包含无效状态。'); return value; }
  if (rule === 'url') return safePublicUrl(value);
  if (Array.isArray(rule)) {
    if (!Array.isArray(value) || value.length > 20000) throw new Error('文件列表格式或长度无效。');
    return value.map(v => project(v, rule[0]));
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('行程字段格式无效。');
  return Object.fromEntries(Object.entries(rule).filter(([key]) => Object.hasOwn(value, key)).map(([key, r]) => [key, project(value[key], r)]));
}
function validate(route) {
  const fail = () => { throw new Error('不是完整的 v1 行程：需要有效版本、1–14天、2–50站及连续路段。旧版文件请先在原页面重新导出。'); };
  if (!route || route.schemaVersion !== 1 || !route.id || !Number.isInteger(route.revision?.number) || route.revision.number < 1 ||
    !Array.isArray(route.days) || route.days.length < 1 || route.days.length > 14 ||
    !Array.isArray(route.stops) || route.stops.length < 2 || route.stops.length > 50 ||
    !Array.isArray(route.legs) || route.legs.length !== route.stops.length - 1) fail();
  if ([...route.days, ...route.stops, ...route.legs].some(v => !v || typeof v !== 'object')) fail();
  const ids = [...route.days, ...route.stops, ...route.legs].map(v => v.id);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) fail();
  if (JSON.stringify(route.days.flatMap(d => d.stopIds || [])) !== JSON.stringify(route.stops.map(s => s.id))) fail();
  for (const [i, d] of route.days.entries()) {
    if (d.index !== i + 1 || !Array.isArray(d.stopIds) || !Array.isArray(d.legIds) ||
      d.stopIds.some(id => route.stops.find(s => s.id === id)?.dayId !== d.id) ||
      JSON.stringify(d.legIds) !== JSON.stringify(route.legs.filter(l => l.dayId === d.id).map(l => l.id))) fail();
  }
  for (const [i, s] of route.stops.entries()) {
    if (!s.name || !route.days.some(d => d.id === s.dayId) || !Number.isFinite(s.location?.lat) || Math.abs(s.location.lat) > 90 || !Number.isFinite(s.location?.lng) || Math.abs(s.location.lng) > 180) fail();
    if (s.progress?.completed && i && !route.stops[i - 1].progress?.completed) fail();
  }
  route.legs.forEach((l, i) => { if (l.fromStopId !== route.stops[i].id || l.toStopId !== route.stops[i+1].id || l.dayId !== route.stops[i+1].dayId) fail(); });
  return route;
}
export function portableRoute(route) { return validate(project(route, schema)); }
export function createPortable(route, { exportedAt = new Date().toISOString(), imported = false } = {}) {
  const packet = { format: 'citywalk-route', formatVersion: 1, exportedAt, trust: 'unsigned-readonly', imported,
    boundary: '公开行程快照，不含内部签名。文件内容未重新核实，不可直接作为可信多轮输入。', route: portableRoute(route) };
  if (new TextEncoder().encode(JSON.stringify(packet, null, 2)).length > MAX_PORTABLE_BYTES) throw new Error('此行程 JSON 超过 8 MB，无法导出为可互通文件。');
  return packet;
}
export function parsePortable(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_PORTABLE_BYTES) throw new Error('JSON 文件不能超过 8 MB。');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('JSON 已损坏或格式不正确，请选择行程 JSON 文件。'); }
  if (!value || typeof value !== 'object' || (value.format && (value.format !== 'citywalk-route' || value.formatVersion !== 1))) throw new Error('不支持此文件格式版本。');
  return createPortable(value.route || value, { imported: true });
}
