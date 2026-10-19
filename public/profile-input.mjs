import { profileText } from './profile-schema.mjs';

const modes = { walking: '步行', cycling: '骑行', transit: '公共交通', driving: '自驾', taxi: '打车', mixed: '混合出行' };
const companions = { none: '无特殊条件', children: '带儿童', seniors: '有老人', wheelchair: '轮椅通行', stroller: '带婴儿车' };
const list = value => Array.isArray(value) ? value : [];
const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '';
const minutes = value => Number.isInteger(value) && value >= 0 && value <= 720 ? value : null;
const named = value => profileText(value, 100);
const companionValues = value => [...new Set(list(value).filter(item => Object.hasOwn(companions, item)))].sort();

// Called with the submitted request, never the generated route or assistant
// response. Completed older user turns already contributed to the profile;
// replaying them could resurrect facts the user manually removed. Only this
// prompt and its active clarification's original request are new evidence.
export function planningProfileInput(input = {}) {
  const secret = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const text = (value, max) => profileText(secret && typeof value === 'string' ? value.replaceAll(secret, '[已隐藏密钥]') : value, max);
  const prompt = text(input.prompt, 1000);
  const messages = [];
  const pending = text(input.conversation?.pending?.request, 600);
  if (pending && pending !== prompt) messages.push({ role: 'user', content: pending });

  // These fields come only from the explicit form. Do not fall back to
  // currentRoute.context, conversation.summary, inferred intent or defaults.
  const raw = input.context && typeof input.context === 'object' && !Array.isArray(input.context) ? input.context : {};
  const context = {};
  if (typeof raw.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)) context.startDate = raw.startDate;
  for (const field of ['dailyStartTime', 'dailyEndTime']) if (time(raw[field])) context[field] = time(raw[field]);
  for (const [field, min, max, integer] of [['dayCount', 1, 14, true], ['maxWalkKm', 0, 50, false]]) {
    const value = raw[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))) context[field] = value;
  }
  if (Object.hasOwn(modes, raw.transportMode)) context.transportMode = raw.transportMode;
  const party = companionValues(raw.companions);
  if (party.length && !(party.includes('none') && party.length > 1)) context.companions = party;
  return { kind: input.conversation?.mode === 'edit' ? 'edit' : 'planning', prompt, messages: messages.slice(-10), context };
}

// Only invoke for an explicit editor commit / hotel selection. Comparisons use
// requested fields, not solved schedule/transport, photos or model notes. Every
// change is evidence about this trip, never an inferred long-term preference.
export function manualProfileInput(before, after) {
  if (!before || !after || (before.id && after.id && before.id !== after.id)) return null;
  if (after.revision?.reason && after.revision.reason !== 'user-edit') return null;
  const changes = [];
  const add = text => { if (changes.length < 40) changes.push(profileText(text, 500)); };
  const oldContext = before.context || {}, nextContext = after.context || {};
  if (oldContext.transportMode !== nextContext.transportMode && Object.hasOwn(modes, nextContext.transportMode)) add(`本次交通方式改为${modes[nextContext.transportMode]}`);
  const walk = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 50 ? value : null;
  if (walk(oldContext.maxWalkKm) !== walk(nextContext.maxWalkKm)) add(walk(nextContext.maxWalkKm) == null ? '本次取消明确的每日步行上限' : `本次每日步行上限改为${walk(nextContext.maxWalkKm)}公里`);
  const oldParty = companionValues(oldContext.companions), newParty = companionValues(nextContext.companions);
  if (JSON.stringify(oldParty) !== JSON.stringify(newParty)) add(`本次同行条件改为${newParty.length ? newParty.map(item => companions[item]).join('、') : '未指定'}`);

  const oldDays = new Map(list(before.days).map(day => [day.id, day]));
  for (const [index, day] of list(after.days).entries()) {
    // New days start with only the trip's default window. A different requested
    // window, explicit rest or lodging can only come from the manual draft.
    const prior = oldDays.get(day.id) || { requestedWindow: { start: nextContext.dailyStartTime, end: nextContext.dailyEndTime } };
    const label = `本次第 ${index + 1} 天`;
    if (time(prior.requestedWindow?.start) !== time(day.requestedWindow?.start) || time(prior.requestedWindow?.end) !== time(day.requestedWindow?.end)) {
      add(`${label}游玩时段改为${time(day.requestedWindow?.start) || '未指定'}–${time(day.requestedWindow?.end) || '未指定'}`);
    }
    if ((minutes(prior.restMinutes) || 0) !== (minutes(day.restMinutes) || 0)) add(`${label}出发前休息改为${minutes(day.restMinutes) || 0}分钟`);
    const previousLodging = profileText(prior.lodging?.text, 300), lodging = profileText(day.lodging?.text, 300);
    if (previousLodging !== lodging && day.lodging?.source === 'user') add(lodging ? `${label}住宿备注改为：${lodging}` : `${label}清除了住宿备注`);
  }

  const oldStops = new Map(list(before.stops).map(stop => [stop.id, stop]));
  for (const stop of list(after.stops)) {
    // Added / repeated manual stops have an empty visit object initially. A
    // requested stay/rest set in the same draft is explicit evidence; the
    // presence, type or description of the place itself is never recorded.
    const prior = oldStops.get(stop.id) || { visit: {} }, label = named(stop.name);
    if (!label) continue;
    for (const [field, title] of [['stayMinutes', '停留'], ['restMinutes', '休息']]) {
      const previous = minutes(prior.visit?.[field]), next = minutes(stop.visit?.[field]);
      if (previous !== next) add(next == null ? `本次在${label}取消明确的${title}时长` : `本次在${label}${title}时长改为${next}分钟`);
    }
  }

  const endpointKey = leg => `${leg.dayId}|${leg.fromStopId}|${leg.toStopId}`;
  const oldLegs = list(before.legs), stopNames = new Map(list(after.stops).map(stop => [stop.id, named(stop.name)]));
  for (const leg of list(after.legs)) {
    // Mode editing recreates a leg ID. Match its same directed endpoints, but
    // ignore new roads created by moving/adding places or recomputing routing.
    const matches = oldLegs.filter(prior => endpointKey(prior) === endpointKey(leg));
    if (matches.length !== 1 || matches[0].preferredMode === leg.preferredMode || !Object.hasOwn(modes, leg.preferredMode)) continue;
    const from = stopNames.get(leg.fromStopId), to = stopNames.get(leg.toStopId);
    if (from && to) add(`本次从${from}到${to}的交通方式改为${modes[leg.preferredMode]}`);
  }

  if (before.hotels?.selectedId !== after.hotels?.selectedId) {
    const selected = list(after.hotels?.candidates).find(hotel => hotel.id === after.hotels?.selectedId);
    if (selected && named(selected.name)) add(`本次主动选择住宿：${[named(selected.city), named(selected.name)].filter(Boolean).join('·')}（未表示已预订）`);
    else if (before.hotels?.selectedId && !after.hotels?.selectedId) add('本次取消已选住宿（未表示取消预订）');
  }
  return changes.length ? { kind: 'manual', prompt: '用户在行程编辑中明确修改以下内容', changes, context: {} } : null;
}
