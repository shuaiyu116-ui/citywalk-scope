'use strict';
const { createItinerary, resolveTripContext } = require('./itinerary');
const { matchPlace } = require('./route-planner');
const { scope } = require('./agent-scope');
class ShareCopyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
async function copySharedRoute(body, { search, signal } = {}) {
  const [{ normalizeDay }, { normalizeVisit }, { reconcile }] = await Promise.all([
    import('../public/day-plan.mjs'), import('../public/schedule.mjs'), import('../public/itinerary-editor.mjs')
  ]);
  let context, days, stops, modes;
  try {
    if (!body || !Array.isArray(body.days) || body.days.length < 1 || body.days.length > 14 || !Array.isArray(body.stops) || body.stops.length < 2 || body.stops.length > 50 || !Array.isArray(body.modes) || body.modes.length !== body.stops.length - 1) throw Error();
    const c = body.context || {};
    context = resolveTripContext({ dayCount: body.days.length, startDate: c.startDate, dailyStartTime: c.dailyStartTime, dailyEndTime: c.dailyEndTime, transportMode: c.transportMode, maxWalkKm: c.maxWalkKm });
    days = body.days.map(d => normalizeDay({ date: d.date, start: d.start, end: d.end, restMinutes: d.restMinutes }, {}));
    const dated = days.filter(d => d.date); if (dated.some((d, i) => i && d.date <= dated[i - 1].date)) throw Error();
    const text = (v, max, required) => { if (typeof v !== 'string' || v.length > max || (required && !v.trim()) || /[<>\r\n]/.test(v)) throw Error(); return v.trim(); };
    stops = body.stops.map(s => {
      if (!Number.isInteger(s.dayIndex) || s.dayIndex < 0 || s.dayIndex >= days.length) throw Error();
      return { name: text(s.name, 120, true), city: text(s.city, 80, true), addressHint: text(s.addressHint || '', 200), dayIndex: s.dayIndex,
        visit: normalizeVisit({ stayMinutes: s.stayMinutes, restMinutes: s.restMinutes }), locked: s.locked === true };
    });
    if (stops.some((s, i) => i && s.dayIndex < stops[i - 1].dayIndex)) throw Error();
    modes = body.modes.map(mode => resolveTripContext({ transportMode: mode }).transportMode);
  } catch { throw new ShareCopyError('分享中的日期、地点或出行条件无效，请修改原行程后重新分享。'); }
  const run = { signal, usage: { networkCalls: 0 }, limits: { networkCalls: 50 }, check() { if (signal?.aborted) throw new ShareCopyError('复制已取消或超时，请重试。', 408); } };
  return scope.run(run, async () => {
    run.check();
    const matches = new Array(stops.length), cache = new Map(); let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, stops.length) }, async () => {
      while (next < stops.length) {
        run.check(); const i = next++, target = stops[i], key = JSON.stringify([target.name, target.city, target.addressHint]);
        if (!cache.has(key)) cache.set(key, (async () => {
          const result = await search({ query: target.name, city: target.city, matchTarget: target });
          if (result.source !== 'ctrip') throw new ShareCopyError('未配置真实地点服务，暂不能复制；只读分享仍可查看或下载。', 503);
          const match = matchPlace(target, result);
          if (!match.selected) throw new ShareCopyError(`第 ${i + 1} 站无法唯一核对（${match.status}），请在原行程核对名称、城市和地址后重新分享。`, 422);
          return match.selected;
        })());
        matches[i] = await cache.get(key); run.check();
      }
    }));
    const route = createItinerary({ city: [...new Set(matches.map(p => p.city))].join(' · '), title: '分享路线的新副本',
      summary: '由分享地点顺序复制；地点已重新匹配，日期与停留为沿用的用户计划，出发前仍需核对。', mood: '我的行程', duration: '待排程', distance: '待计算',
      stops: matches.map(p => ({ ...p, poiId: p.id, time: '待排程', note: '复制时重新查询的地点；开放及交通仍需核对。', coordinateStatus: '携程 POI 坐标', accent: '#7387a6' }))
    }, context, { source: 'shared-copy', poiSource: 'ctrip' });
    route.revision.reason = 'shared-copy';
    route.days = route.days.map((d, i) => ({ ...d, ...days[i] }));
    route.stops.forEach((s, i) => { s.dayId = route.days[stops[i].dayIndex].id; s.visit = stops[i].visit; s.locked = stops[i].locked; });
    route.legs.forEach((l, i) => { l.dayId = route.stops[i + 1].dayId; l.fromDayId = route.stops[i].dayId; l.preferredMode = modes[i]; });
    for (const day of route.days) { day.stopIds = route.stops.filter(s => s.dayId === day.id).map(s => s.id); day.legIds = route.legs.filter(l => l.dayId === day.id).map(l => l.id); }
    reconcile(route, structuredClone(route));
    route.planning.notices = ['分享副本：新身份；地点已重新查询，交通待重算。未复制原作者的同行、住宿、预订、已游览、自填营业规则及自由文字。'];
    run.check(); return route;
  });
}
module.exports = { copySharedRoute, ShareCopyError };
