import { amapLink } from './navigation.mjs';
export const modeLabels = { walking: '步行', cycling: '骑行', driving: '自驾', taxi: '打车', transit: '公共交通', mixed: '混合出行' };
export const modeColors = { walking: '#df6c50', cycling: '#23855b', driving: '#4d69ba', taxi: '#9b6b17', transit: '#8656ad' };
export const statusLabels = { unknown: '待计算', loading: '计算中', routed: '道路结果', estimated: '粗估', unavailable: '不可用', scheduled: '用户填写的预订时间（未核实）' };
export function transportRequest(route) {
  return {
    stops: route.stops.map(s => ({ id: s.id, city: s.city || route.city, location: s.location })),
    legs: (route.legs || []).filter(l => !l.booking && !route.stops.find(s=>s.id===l.toStopId)?.progress?.completed).map(l => ({ id: l.id, dayId: l.dayId, fromStopId: l.fromStopId, toStopId: l.toStopId, preferredMode: l.preferredMode })),
    context: { maxWalkKm: route.context?.maxWalkKm ?? null }
  };
}
export const transportFingerprint = route => JSON.stringify([transportRequest(route), route.legs.filter(l => l.booking).map(l => [l.id,l.booking])]);
export function mergeTransport(route, result, fingerprint) {
  if (transportFingerprint(route) !== fingerprint || !Array.isArray(result.legs)) return false;
  const frozen=l=>route.stops.find(s=>s.id===l.toStopId)?.progress?.completed;
  const queried = route.legs.filter(l => !l.booking && !frozen(l));
  if (result.legs.length !== queried.length && result.legs.length !== route.legs.length) return false;
  const updates = new Map(result.legs.map(l => [l.id, l]));
  if (updates.size !== result.legs.length || queried.some(l => {
    const next = updates.get(l.id);
    return !next || ['dayId', 'fromStopId', 'toStopId', 'preferredMode'].some(k => next[k] !== l[k]);
  })) return false;
  route.legs = route.legs.map(l => l.booking || frozen(l) ? l : ({ ...l, ...updates.get(l.id) }));
  delete route.walkingPath;
  const states = route.legs.map(l => l.status);
  route.planning.transportStatus = states.every(s => s === 'routed') ? 'routed' : states.some(s => !['routed', 'estimated'].includes(s)) ? 'incomplete' : 'estimated';
  for (const day of route.days) day.transport = summarizeLegs(route.legs.filter(l => day.legIds.includes(l.id)));
  const total = summarizeLegs(route.legs);
  route.distance = total.unknownCount === total.legCount ? '交通距离未知' : `${total.unknownCount ? '已知部分 ' : total.estimatedCount ? '约 ' : ''}${(total.distanceMeters / 1000).toFixed(2)} km`;
  return true;
}
export function summarizeLegs(legs) {
  const usable = legs.filter(l => ['routed', 'estimated'].includes(l.status) && Number.isFinite(l.durationMinutes) && Number.isFinite(l.distanceMeters));
  const booked = legs.filter(l => l.booking && l.status === 'scheduled');
  return { durationMinutes: [...usable,...booked].reduce((n, l) => n + l.durationMinutes, 0), distanceMeters: usable.reduce((n, l) => n + l.distanceMeters, 0), walkingMeters: usable.filter(l => l.mode === 'walking').reduce((n, l) => n + l.distanceMeters, 0), unknownCount: legs.length - usable.length, bookedCount: booked.length, estimatedCount: usable.filter(l => l.status === 'estimated').length, legCount: legs.length };
}
// Both renderers consume exactly these WGS84 [lat,lng] segments. An unknown leg
// has only a dashed illustrative connector; it never acquires a road geometry.
export function transportSegments(route) {
  const stops = new Map((route?.stops || []).map(s => [s.id, s]));
  return (route?.legs || []).map(leg => {
    const coordinates = leg.geometry?.coordinates || [stops.get(leg.fromStopId), stops.get(leg.toStopId)].filter(Boolean).map(s => [s.location.lat, s.location.lng]);
    return { ...leg, coordinates, color: modeColors[leg.mode] || '#81878b', illustrative: leg.status !== 'routed' };
  }).filter(s => s.coordinates.length >= 2);
}
const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
export function renderTransport(route, { busy = false, retry, selectStop, dayId } = {}) {
  const panel = document.getElementById('transportDetails');
  panel.replaceChildren(el('summary', '分段交通与每日耗时'));
  const refresh = el('button', busy ? '正在计算交通…' : '重新获取交通');
  refresh.type = 'button'; refresh.disabled = busy; refresh.addEventListener('click', retry);
  panel.append(refresh, el('p', '实线为对应方式的道路结果，虚线仅示意。耗时不含游玩、候车、停车和实时拥堵；可达性未实地核验。'));
  for (const day of route.days || []) {
    if (dayId && day.id !== dayId) continue;
    const legs = route.legs.filter(l => day.legIds.includes(l.id));
    const total = summarizeLegs(legs);
    panel.append(el('h4', `第 ${day.index} 天${day.date ? ` · ${day.date}` : ''}`));
    panel.append(el('p', !legs.length ? '尚无交通路段，待安排' : `${total.unknownCount ? '已知部分 ' : ''}${total.durationMinutes} 分钟交通 · ${(total.distanceMeters / 1000).toFixed(2)} km · 其中步行 ${(total.walkingMeters / 1000).toFixed(2)} km${total.estimatedCount ? ` · 含 ${total.estimatedCount} 段粗估` : ''}${total.unknownCount ? ` · ${total.unknownCount} 段未知，非完整总耗时` : ''}`));
    for (const leg of legs) {
      const from = route.stops.find(s => s.id === leg.fromStopId), to = route.stops.find(s => s.id === leg.toStopId);
      const row = el('div', ''); row.className = 'transport-leg';
      const jump = el('button', `${from?.name || '起点'} → ${to?.name || '终点'}`);
      jump.type = 'button'; jump.addEventListener('click', () => selectStop?.(route.stops.indexOf(to)));
      row.append(jump, el('p', `${leg.kind === 'interday' ? '跨日衔接 · ' : ''}${leg.mode ? modeLabels[leg.mode] : '方式待确认'} · ${statusLabels[leg.status] || '未知'} · 偏好：${modeLabels[leg.preferredMode]}${Number.isFinite(leg.durationMinutes) ? ` · ${leg.durationMinutes} 分钟 / ${Number.isFinite(leg.distanceMeters) ? (leg.distanceMeters / 1000).toFixed(2)+' km' : '距离未知'}` : ' · 耗时未知'}`));
      if(from && to) {const a=el('a','在高德规划此段');a.href=amapLink(to,from,leg.mode || leg.preferredMode);a.target='_blank';a.rel='noopener noreferrer';row.append(a,el('small',' 高德会重新规划，请核对方式与入口；混合未定时默认步行，打车按驾车规划，不下单。'));}
      if (leg.booking) row.append(el('p', `${leg.booking.label || '未填车次/航班'} · ${leg.booking.departure.replace('T',' ')} → ${leg.booking.arrival.replace('T',' ')}（北京时间）；出发前/到达后接驳缓冲 ${leg.booking.beforeMinutes ?? '未知'} / ${leg.booking.afterMinutes ?? '未知'} 分钟`));
      if (leg.selectionReason) row.append(el('p', leg.selectionReason));
      if (leg.warning) row.append(el('p', leg.warning));
      if (leg.estimate) row.append(el('p', `估算依据：直线 ${leg.estimate.straightLineMeters} m × ${leg.estimate.detourFactor}，速度 ${leg.estimate.speedKmh} km/h；地图虚线不表示实际道路。`));
      row.append(el('small', `来源：${leg.source || '暂无'}；道路获取：${({ success: '成功', failed: '失败', unsupported: '暂不支持' })[leg.routingStatus] || '未获取'}；获取时刻：${leg.retrievedAt || '无'}${leg.attemptedAt ? `；尝试时刻：${leg.attemptedAt}` : ''}`));
      panel.append(row);
    }
  }
}
