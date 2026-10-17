'use strict';

const { randomUUID } = require('node:crypto');
const { unknownOpening } = require('./route-planner');
const TRANSPORT_MODES = ['walking', 'cycling', 'transit', 'driving', 'taxi', 'mixed'];
const COMPANIONS = ['none', 'children', 'seniors', 'wheelchair', 'stroller'];

class TripInputError extends Error {
  constructor(field, message) { super(message); this.field = field; }
}
const invalid = (field, message) => { throw new TripInputError(field, message); };
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

// This boundary only accepts planning conditions. Credentials and unknown keys
// must never be copied from the request into a portable itinerary.
function normalizeTripInput(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('context', '出行条件必须是对象');
  const result = {};
  const present = key => value[key] !== undefined && value[key] !== null && value[key] !== '';
  if (present('startDate')) {
    const date = value.startDate;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2000-01-01' || date > '2099-12-31') {
      invalid('startDate', '出行日期需为 2000–2099 年的有效日期');
    }
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) invalid('startDate', '出行日期不存在');
    result.startDate = date;
  }
  for (const key of ['dailyStartTime', 'dailyEndTime']) {
    if (!present(key)) continue;
    if (typeof value[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value[key])) invalid(key, '每日时间请使用 HH:mm 格式');
    result[key] = value[key];
  }
  if (result.dailyStartTime && result.dailyEndTime && result.dailyEndTime === result.dailyStartTime) {
    invalid('dailyEndTime', '每日开始和结束不可相同；结束早于开始表示次日');
  }
  for (const [key, min, max, integer, label] of [
    ['dayCount', 1, 14, true, '天数'], ['maxWalkKm', 0, 50, false, '每日步行预算（km）']
  ]) {
    if (!present(key)) continue;
    const raw = value[key];
    const number = typeof raw === 'number' || (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw)) ? Number(raw) : NaN;
    if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
      invalid(key, `${label}须为 ${min}–${max} 之间的${integer ? '整数' : '数字'}`);
    }
    result[key] = number;
  }
  if (present('transportMode')) {
    if (!TRANSPORT_MODES.includes(value.transportMode)) invalid('transportMode', '请选择有效的交通偏好');
    result.transportMode = value.transportMode;
  }
  if (present('companions')) {
    if (!Array.isArray(value.companions) || value.companions.some(item => !COMPANIONS.includes(item))) invalid('companions', '同行条件无效');
    const companions = [...new Set(value.companions)];
    if (companions.includes('none') && companions.length > 1) invalid('companions', '无特殊条件不能与其他同行条件同时选择');
    if (companions.length) result.companions = companions;
  }
  return result;
}

function resolveTripContext(input = {}, intent = {}) {
  const explicit = normalizeTripInput(input);
  const context = { startDate: null, dailyStartTime: null, dailyEndTime: null, dayCount: 1, transportMode: 'walking', companions: [], maxWalkKm: null };
  const fieldSources = Object.fromEntries(Object.keys(context).map(key => [key, ['dayCount', 'transportMode'].includes(key) ? 'default' : 'unknown']));
  // Only the currently supported, normalized intent field is inferred here.
  if (typeof intent.maxWalkKm === 'number' && Number.isFinite(intent.maxWalkKm) && intent.maxWalkKm >= 0 && intent.maxWalkKm <= 50) {
    context.maxWalkKm = intent.maxWalkKm;
    fieldSources.maxWalkKm = 'intent';
  }
  for (const [key, value] of Object.entries(explicit)) { context[key] = value; fieldSources[key] = 'user'; }
  return { ...context, fieldSources };
}

function applyTripContext(intent, context) {
  const merged = { ...intent, context, maxWalkKm: context.maxWalkKm };
  if (context.dailyStartTime && context.dailyEndTime) merged.durationMinutes = (minutes(context.dailyEndTime) - minutes(context.dailyStartTime) + 1440) % 1440;
  return merged;
}

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const TOP_FIELDS = ['city', 'title', 'summary', 'duration', 'distance', 'mood'];
const STOP_FIELDS = ['poiId', 'time', 'name', 'type', 'note', 'city', 'address', 'proposalCandidateId', 'coordinateStatus', 'coordinateSource', 'detailUrl', 'image', 'imageSource', 'imageKind', 'imagePageUrl', 'imageAttribution', 'imageTitle', 'imageCapturedAt', 'distanceMeters', 'accent'];

// These structures are produced by the trusted matcher. Still copy only the
// contract's fields so portable itineraries cannot grow request/credential data.
const FACT_FIELDS = ['status', 'text', 'source', 'url', 'retrievedAt', 'providerUpdatedAt', 'verifiedAt'];
const SELECTION_FIELDS = ['status', 'requestedName', 'requestedCity', 'selectedIndex', 'rationale'];
const POI_FIELDS = ['id', 'name', 'city', 'address', 'type', 'source', 'provider', 'retrievedAt', 'providerUpdatedAt', 'detailUrl', 'coordinateSource', 'coordinateSystem'];
function copyProposal(proposal) {
  if (!proposal) return undefined;
  return { ...pick(proposal, ['id', 'source', 'status', 'createdAt', 'city', 'title', 'rationale', 'mood']), stops: (proposal.stops || []).map(slot => ({
    ...pick(slot, ['id', 'name', 'city', 'reason', 'status', 'selectedPoiId', 'selectedCity', 'selectedIndex']),
    attempts: (slot.attempts || []).map(attempt => ({
      ...pick(attempt, ['role', 'name', 'city', 'reason', 'status', 'source', 'provider', 'retrievedAt', 'matchMethod', 'matchReason']),
      candidates: (attempt.candidates || []).map(poi => ({ ...pick(poi, POI_FIELDS), location: { lat: poi.location.lat, lng: poi.location.lng }, openingHours: pick(poi.openingHours || unknownOpening(), FACT_FIELDS) }))
    }))
  })) };
}

// Initial upgrade of a legacy generated route, not an editor or import validator.
// Allocate identity once; later editors must retain these IDs across revisions.
function createItinerary(route, context = resolveTripContext(), { source = 'demo', poiSource = 'mock' } = {}) {
  const id = `trip-${randomUUID()}`;
  const now = new Date().toISOString();
  const days = Array.from({ length: context.dayCount }, (_, index) => ({
    id: `day-${randomUUID()}`, index: index + 1,
    date: context.startDate ? new Date(Date.parse(`${context.startDate}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10) : null,
    requestedWindow: { start: context.dailyStartTime, end: context.dailyEndTime },
    status: index === 0 ? 'draft' : 'unplanned', stopIds: [], legIds: []
  }));
  const evidence = [];
  const stops = route.stops.map((stop, index) => {
    const stopId = `stop-${randomUUID()}`;
    const locationEvidenceId = `evidence-${randomUUID()}`;
    const openingEvidenceId = `evidence-${randomUUID()}`;
    const real = ['deepseek', 'shared-copy'].includes(source) && stop.source === 'ctrip';
    const openingHours = real ? pick(stop.openingHours || unknownOpening(), FACT_FIELDS) : unknownOpening();
    evidence.push(
      { id: locationEvidenceId, subjectId: stopId, field: 'location', status: real ? 'matched' : 'demo', source: real ? stop.provider || 'ctrip' : 'local-demo', url: stop.detailUrl || null, retrievedAt: real ? stop.retrievedAt || null : null, providerUpdatedAt: real ? stop.providerUpdatedAt || null : null, verifiedAt: null },
      { id: openingEvidenceId, subjectId: stopId, field: 'openingHours', ...openingHours }
    );
    return {
      ...pick(stop, STOP_FIELDS), id: stopId, dayId: days[Math.min(days.length - 1, Math.floor(index * Math.min(days.length, route.stops.length) / route.stops.length))].id,
      location: { lat: stop.location.lat, lng: stop.location.lng },
      openingHours,
      ...(stop.selection ? { selection: pick(stop.selection, SELECTION_FIELDS) } : {}),
      schedule: { status: 'unknown', arrival: null, departure: null, stayMinutes: null },
      evidenceIds: [locationEvidenceId, openingEvidenceId]
    };
  });
  const legs = stops.slice(1).map((stop, index) => ({
    id: `leg-${randomUUID()}`, dayId: stop.dayId, fromDayId: stops[index].dayId, kind: stop.dayId === stops[index].dayId ? 'local' : 'interday', fromStopId: stops[index].id, toStopId: stop.id,
    preferredMode: context.transportMode, mode: null, status: 'unknown',
    geometry: null, distanceMeters: null, durationMinutes: null, source: null, retrievedAt: null, evidenceIds: []
  }));
  for (const day of days) {
    day.stopIds = stops.filter(s => s.dayId === day.id).map(s => s.id);
    day.legIds = legs.filter(l => l.dayId === day.id).map(l => l.id);
    day.status = day.stopIds.length ? 'draft' : 'unplanned';
  }
  return {
    ...pick(route, TOP_FIELDS), schemaVersion: 1, id,
    revision: { number: 1, parentRevision: null, createdAt: now, updatedAt: now, reason: 'generated' },
    source, poiSource: ['deepseek', 'shared-copy'].includes(source) ? poiSource : 'mock',
    context, days, stops, legs, evidence,
    ...(route.proposal ? { proposal: copyProposal(route.proposal) } : {}),
    planning: { status: 'draft', scheduleStatus: 'unknown', transportStatus: 'unknown', dayAssignmentStatus: days.some(d => !d.stopIds.length) ? 'partial' : 'draft', notices: [
      '出行条件已记录；网页时间轴随交通更新核查开放规则、结束时间和步行预算，未知事实仍需确认。',
      ...(route.proposal?.status === 'partial' ? ['部分提议地点未匹配，当前路线不包含所有提案站点。'] : []),
      ...(context.dayCount > 1 ? [`地点按原顺序初步均分到 ${context.dayCount} 天，可在编辑中移日；不是已验证的多日方案。`] : []),
      '交通按路段单独计算；道路耗时不含游玩、候车、停车与实时拥堵，未知段不计作零耗时。',
      ...(!['deepseek', 'shared-copy'].includes(source) ? ['当前为城市示例，未按这些条件重新规划。'] : [])
    ] }
  };
}

module.exports = { TripInputError, normalizeTripInput, resolveTripContext, applyTripContext, createItinerary };
