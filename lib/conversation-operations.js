'use strict';

// The model chooses the operation. The executor owns IDs, references and facts.
async function redistribute(base, dayCount) {
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 14) throw Error('天数需为1–14天');
  if (base.stops.some(stop => stop.progress?.completed)) throw Error('已有已游览记录，请在编辑器中调整剩余日期');
  if (base.legs.some(leg => leg.booking)) throw Error('已有预订交通，请先在编辑器中确认对应日期再重新分天');
  const removed = base.days.slice(dayCount);
  if (removed.some(day => day.lodging?.text || day.restMinutes || day.requestedWindow?.start !== base.context.dailyStartTime || day.requestedWindow?.end !== base.context.dailyEndTime))
    throw Error('减少的日期有单独住宿或时段安排，请先在编辑器确认后再合并');
  const [{ editRoute, reconcile }] = await Promise.all([import('../public/itinerary-editor.mjs')]);
  let route = structuredClone(base);
  while (route.days.length < dayCount) route = editRoute(route, { type:'add-day' });
  route.days = route.days.slice(0, dayCount);
  route.stops.forEach((stop, index) => { stop.dayId = route.days[Math.min(dayCount - 1, Math.floor(index * dayCount / route.stops.length))].id; });
  reconcile(route, base);
  route.context.fieldSources.dayCount = 'user';
  return route;
}

module.exports = { redistribute };
