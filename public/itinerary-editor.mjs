import { normalizeVisit, applySchedule } from './schedule.mjs';
import { modeLabels, transportRequest, transportFingerprint, mergeTransport } from './transport.mjs';
import { normalizeDay, normalizeBooking, nextDayDate } from './day-plan.mjs';
import { normalizeProgress, protectHistory, assertProgress, insertRemaining } from './journey.mjs';

const copy = value => structuredClone(value);
const uid = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const key = s => `${s.city}|${s.poiId || s.id}`;
const blankLeg = (from, to, mode) => ({ id: uid('leg'), dayId: to.dayId, fromStopId: from.id, toStopId: to.id, preferredMode: mode, mode: null, status: 'unknown', geometry: null, distanceMeters: null, durationMinutes: null, source: null, retrievedAt: null, evidenceIds: [] });

// Rebuild references, not unchanged entities. Mixed mode depends on the day's
// cumulative walking budget, so a changed mixed day invalidates all its roads.
export function reconcile(route, before) {
  const legs = [];
  route.stops = route.days.flatMap(d => route.stops.filter(s => s.dayId === d.id));
  let previous = null;
  for (const day of route.days) {
    const stops = route.stops.filter(s => s.dayId === day.id);
    const oldDay = before.days.find(d => d.id === day.id);
    const changed = JSON.stringify(stops.map(s => s.id)) !== JSON.stringify(oldDay?.stopIds);
    const mixed = [...route.legs, ...before.legs].some(l => l.dayId === day.id && l.preferredMode === 'mixed');
    for (let i = 0; i < stops.length; i++) {
      const from = i ? stops[i - 1] : previous, to = stops[i];
      if (!from) continue;
      const old = route.legs.find(l => l.dayId === day.id && l.fromStopId === from.id && l.toStopId === to.id);
      const leg = old && (to.progress?.completed || old.booking || !(changed && mixed)) ? old : blankLeg(from, to, old?.preferredMode || route.context.transportMode);
      leg.fromDayId = from.dayId;
      leg.kind = from.dayId !== to.dayId ? 'interday' : 'local';
      legs.push(leg);
    }
    if (stops.length) previous = stops.at(-1);
    day.stopIds = stops.map(s => s.id);
    day.legIds = legs.filter(l => l.dayId === day.id).map(l => l.id);
    day.status = stops.length ? 'draft' : 'unplanned';
  }
  route.legs = legs;
  route.context.dayCount = route.days.length;
  route.context.startDate = route.days[0].date;
  if (route.days.length !== before.days.length) route.context.fieldSources.dayCount = 'user';
  if (route.context.startDate !== before.context.startDate) route.context.fieldSources.startDate = route.context.startDate ? 'user' : 'unknown';
  route.planning.dayAssignmentStatus = route.days.some(d => !d.stopIds.length) ? 'partial' : 'draft';
  const ids = new Set(route.stops.map(s => s.id));
  route.evidence = route.evidence.filter(e => ids.has(e.subjectId));
  delete route.walkingPath;
  applySchedule(route);
  return route;
}

export function editRoute(base, action) {
  const route = copy(base);
  const stop = route.stops.find(s => s.id === action.stopId);
  if (action.type === 'hotel') {
    const hotel = route.hotels?.candidates?.find(candidate => candidate.id === action.hotelId);
    if (!hotel) throw new Error('该酒店已不在本次携程候选中，请重新选择');
    route.hotels.selectedId = hotel.id;
    return route;
  }
  if(action.type==='add-nearby') {
    const added=editRoute(base,{...action,type:'add'});
    const newStop=added.stops.find(s=>!base.stops.some(p=>p.id===s.id));
    // Use the original bookings when choosing insertion boundaries.
    added.legs=copy(base.legs);insertRemaining(added,newStop.id);
    reconcile(added,base);protectHistory(base,added);
    if(base.legs.some(l=>l.booking && !added.legs.some(n=>n.id===l.id))) throw Error('加入地点会改变预订交通，请先在编辑器处理预订');
    return added;
  }
  if (!['add', 'mode', 'day', 'add-day', 'remove-day', 'booking', 'endpoint'].includes(action.type) && !stop) throw new Error('地点已改变，请重新打开编辑');
  if (['remove', 'replace'].includes(action.type) && stop.locked) throw new Error('请先解锁必去点，再删除或替换');
  if(action.type === 'visited') {
    const count=route.stops.filter(s=>s.progress?.completed).length;
    if(stop.progress?.completed) {
      if(route.stops[count-1]?.id!==stop.id) throw Error('请先撤销最后一个已游览地点的标记');
      delete stop.progress;
    } else {
      if(route.stops[count]?.id!==stop.id) throw Error('请按顺序标记下一站已游览；跳过的地点可先从剩余行程删除');
      stop.progress=normalizeProgress({completed:true,schedule:stop.schedule});
    }
    assertProgress(route);return reconcile(route,base);
  } else if (action.type === 'add-day') {
    if (route.days.length >= 14) throw new Error('最多14天');
    route.days.push({ id: uid('day'), index: route.days.length + 1, date: nextDayDate(route.days), requestedWindow: {start:route.context.dailyStartTime,end:route.context.dailyEndTime}, stopIds:[],legIds:[] });
  } else if (action.type === 'remove-day') {
    const day = route.days.find(d => d.id === action.dayId);
    if (!day || route.days.length <= 1 || route.stops.some(s => s.dayId === day.id)) throw new Error('只能删除空白天，且至少保留一天');
    route.days = route.days.filter(d => d !== day); route.days.forEach((d,i) => d.index = i+1);
  } else if (action.type === 'day') {
    const index = route.days.findIndex(d => d.id === action.dayId);
    if (index < 0) throw new Error('日期已改变');
    route.days[index] = normalizeDay(action, route.days[index]);
    const dated = route.days.filter(d => d.date);
    if (dated.some((d,i) => i && d.date <= dated[i-1].date)) throw new Error('各天日期必须按先后递增');
    const dayStops = route.stops.filter(s => s.dayId === action.dayId);
    if (action.startStopId && action.endStopId && action.startStopId === action.endStopId && dayStops.length > 1) throw new Error('多个地点时起点和终点不能相同；需要返程可另加真实终点');
    for (const [key,first] of [['startStopId',true],['endStopId',false]]) if (action[key]) {
      const selected = dayStops.find(s => s.id === action[key]);
      if (!selected) throw new Error('起终点必须是当天地点');
      route.stops = route.stops.filter(s => s !== selected);
      if(first) route.stops.unshift(selected); else route.stops.push(selected);
    }
  } else if (action.type === 'assign-day') {
    if (!route.days.some(d => d.id === action.dayId)) throw new Error('目标天不存在');
    stop.dayId = action.dayId;
    route.stops = route.stops.filter(s => s !== stop); route.stops.push(stop);
  } else if (action.type === 'repeat-stop') {
    if (route.stops.length >= 50 || !route.days.some(d=>d.id===action.dayId)) throw new Error('最多50个地点，目标日必须存在');
    const repeated = {...copy(stop),id:uid('stop'),dayId:action.dayId,visit:{},locked:false,evidenceIds:[],schedule:{status:'unknown'}};
    delete repeated.progress;
    for(const item of route.evidence.filter(e=>e.subjectId===stop.id)) {
      const fact={...copy(item),id:uid('evidence'),subjectId:repeated.id};route.evidence.push(fact);repeated.evidenceIds.push(fact.id);
    }
    route.stops.push(repeated);
  } else if (action.type === 'endpoint') {
    const day = route.days.find(d => d.id === action.dayId);
    const selected = route.stops.find(s => s.id === action.stopId && s.dayId === day?.id);
    if (!selected || !['start','end'].includes(action.position)) throw new Error('请选择当天已有地点作为起终点');
    route.stops = route.stops.filter(s => s !== selected);
    if (action.position === 'start') route.stops.unshift(selected); else route.stops.push(selected);
  } else if (action.type === 'booking') {
    const leg = route.legs.find(l => l.id === action.legId);
    if (!leg) throw new Error('路段已改变');
    const booking = normalizeBooking(action.booking);
    const replacement = { ...blankLeg(route.stops.find(s => s.id === leg.fromStopId),route.stops.find(s => s.id === leg.toStopId),leg.preferredMode), id:leg.id, booking };
    if (booking) Object.assign(replacement, {status:'scheduled',mode:'transit',durationMinutes:booking.durationMinutes,source:'user',warning:'用户填写的预订时间，未查询或核实；接驳与候车缓冲另计'});
    route.legs = route.legs.map(l => l === leg ? replacement : l);
  } else if (action.type === 'visit') stop.visit = normalizeVisit(action.visit);
  else if (action.type === 'lock') stop.locked = !stop.locked;
  else if (action.type === 'remove') {
    if (route.stops.length <= 2) throw new Error('路线至少保留两个地点');
    route.stops = route.stops.filter(s => s !== stop);
  } else if (action.type === 'move') {
    const i = route.stops.indexOf(stop), j = i + action.offset;
    if (![-1, 1].includes(action.offset) || !route.stops[j] || route.stops[j].dayId !== stop.dayId) throw new Error('只能在当天上下移动');
    [route.stops[i], route.stops[j]] = [route.stops[j], stop];
  } else if (action.type === 'mode') {
    const leg = route.legs.find(l => l.id === action.legId);
    if (!leg || !modeLabels[action.mode]) throw new Error('路段或方式无效');
    const affected = route.legs.some(l => l.dayId === leg.dayId && l.preferredMode === 'mixed') || action.mode === 'mixed';
    route.legs = route.legs.map(l => l === leg || (affected && l.dayId === leg.dayId)
      ? blankLeg(route.stops.find(s => s.id === l.fromStopId), route.stops.find(s => s.id === l.toStopId), l === leg ? action.mode : l.preferredMode) : l);
  } else if (['add', 'replace'].includes(action.type)) {
    const poi = action.poi;
    if (!poi?.id || !poi.name || !poi.city || !['ctrip', 'mock'].includes(poi.source) || !Number.isFinite(poi.location?.lat) || !Number.isFinite(poi.location?.lng) || Math.abs(poi.location.lat) > 90 || Math.abs(poi.location.lng) > 180 || (!poi.location.lat && !poi.location.lng)) throw new Error('请选择检索返回的有效地点');
    if (route.stops.some(s => key(s) === `${poi.city}|${poi.id}` || ((s.city || route.city).replace(/市$/, '') === poi.city.replace(/市$/, '') && s.name === poi.name && s.location.lat === poi.location.lat && s.location.lng === poi.location.lng))) throw new Error('该地点已在路线中');
    if (action.type === 'add' && route.stops.length >= 50) throw new Error('最多安排 50 个地点');
    const id = uid('stop'), dayId = stop?.dayId || action.dayId || route.days[0].id;
    if (!route.days.some(d => d.id === dayId)) throw new Error('目标天不存在');
    const fields = ['name','city','address','type','detailUrl','coordinateSource','image','imageSource','imageKind','imagePageUrl','imageAttribution','imageTitle','openingHours','location','placeProof'];
    const added = { ...Object.fromEntries(fields.filter(k => poi[k] !== undefined).map(k => [k, copy(poi[k])])), id, poiId: poi.id, dayId, visit: {}, locked: false, time: '待排程', note: '用户从地点查询结果中选择；开放信息仍需核对。', accent: stop?.accent || '#7387a6', coordinateStatus: poi.source === 'ctrip' ? '携程 POI 坐标' : '本地演示 POI 坐标', evidenceIds: [] };
    if (stop?.proposalCandidateId) added.proposalCandidateId = stop.proposalCandidateId;
    for (const field of ['location', 'openingHours']) {
      const e = { id: uid('evidence'), subjectId: id, field, ...(field === 'location' ? {status: poi.source === 'ctrip' ? 'matched' : 'demo', source: poi.provider, url: poi.detailUrl, retrievedAt: poi.retrievedAt, providerUpdatedAt: poi.providerUpdatedAt, verifiedAt: null} : poi.openingHours) };
      route.evidence.push(e); added.evidenceIds.push(e.id);
    }
    if (stop) route.stops.splice(route.stops.indexOf(stop), 1, added); else route.stops.push(added);
    route.poiSource = route.evidence.filter(e => e.field === 'location' && route.stops.some(s => s.id === e.subjectId)).every(e => e.status === 'matched') ? 'ctrip' : 'mixed';
  } else throw new Error('不支持的编辑');
  reconcile(route, base);
  protectHistory(base,route);
  return route;
}

export class EditSession {
  constructor(route) { this.current = route; this.draft = null; this.history = []; this.token = 0; this.busy = false; }
  restoreSnapshot(route) {
    if (this.draft || this.busy) throw Error('请先提交或放弃当前草稿');
    this.cancel();
    this.history.push(copy(this.current)); if (this.history.length > 20) this.history.shift();
    this.current = copy(route); // Preserve stored plans exactly; no implicit re-solving.
    return this.current;
  }
  stage(action) {
    this.cancel();
    this.draft = editRoute(this.draft || this.current, action);
    return this.draft;
  }
  cancel() { this.token++; this.controller?.abort(); this.busy = false; }
  discard() { this.cancel(); this.draft = null; this.reviewRequired = false; }
  async commit(solve, { allowIncomplete = false } = {}) {
    if (!this.draft) return this.current;
    this.cancel(); const token = this.token, candidate = copy(this.draft), previous = this.current;
    const controller = this.controller = new AbortController(); this.busy = true;
    const timer = setTimeout(() => controller.abort(), 210000);
    try {
      const pending = candidate.legs.filter(l => !candidate.stops.find(s=>s.id===l.toStopId)?.progress?.completed && !l.booking && (l.status === 'unknown' || (this.reviewRequired && l.status !== 'routed')));
      if (pending.length && !allowIncomplete) {
        // Include earlier legs when mixed selection needs the cumulative budget.
        const mixedDays = new Set(pending.filter(l => l.preferredMode === 'mixed').map(l => l.dayId));
        const queryRoute = { ...candidate, legs: candidate.legs.filter(l => !l.booking && (pending.includes(l) || mixedDays.has(l.dayId))) };
        const result = await solve(transportRequest(queryRoute), controller.signal);
        if (token !== this.token) return null;
        if (controller.signal.aborted) throw new Error('交通计算已取消或超时');
        if (!mergeTransport(queryRoute, result, transportFingerprint(queryRoute))) throw new Error('交通结果与草稿不一致');
        const updates = new Map(queryRoute.legs.map(l => [l.id, l]));
        candidate.legs = candidate.legs.map(l => updates.get(l.id) || l);
        this.draft = copy(candidate);
        this.reviewRequired = queryRoute.legs.some(l => l.status !== 'routed');
        if (this.reviewRequired) throw new Error('部分路段仅有粗估或不可用；当前版本未改变。可重试、保留未知提交或放弃草稿。');
      }
      if (token !== this.token) return null;
      // Refresh all derived totals without touching entity IDs.
      mergeTransport(candidate, { legs: candidate.legs }, transportFingerprint(candidate));
      applySchedule(candidate);
      candidate.revision = { ...previous.revision, number: previous.revision.number + 1, parentRevision: previous.revision.number, updatedAt: new Date().toISOString(), reason: 'user-edit' };
      this.history.push(copy(previous)); if (this.history.length > 20) this.history.shift();
      this.current = candidate; this.draft = null; this.reviewRequired = false; return candidate;
    } catch (error) { if (token !== this.token) return null; throw error; }
    finally { clearTimeout(timer); if (token === this.token) this.busy = false; }
  }
  retry() {
    if (!this.draft) return;
    this.draft.legs = this.draft.legs.map(l => l.status === 'routed' || l.booking ? l : { ...l, status: 'unknown' });
  }
  undo() {
    this.discard(); const prior = this.history.pop(); if (!prior) return this.current;
    const parentRevision = prior.id === this.current.id ? this.current.revision.number : prior.revision.number;
    prior.revision = { ...prior.revision, number: parentRevision + 1, parentRevision, updatedAt: new Date().toISOString(), reason: 'undo' };
    this.current = prior; applySchedule(prior); return prior;
  }
}
