'use strict';
const { copySharedRoute, ShareCopyError } = require('./share-copy');
const { sealRoute, validateCurrent } = require('./conversation-route');
// Accept only compact user constraints. No unsigned provider facts are ever sealed.
async function recheckLocal(body, options) {
  const { resolveTripContext } = require('./itinerary');
  const [{ normalizeVisit }, { normalizeBooking, normalizeDay }, { normalizeProgress, assertProgress }] = await Promise.all([import('../public/schedule.mjs'), import('../public/day-plan.mjs'), import('../public/journey.mjs')]);
  let context, visits, bookings, days, progress;
  try {
    context = resolveTripContext(body.context);
    visits = body.stops.map(s => normalizeVisit(s.visit || {}));
    progress = body.stops.map(s => s.progress?.completed ? normalizeProgress(s.progress) : null);
    assertProgress({ stops: progress.map(p => ({ progress:p })) });
    if (!Array.isArray(body.bookings) || body.bookings.length !== body.stops.length-1) throw Error();
    bookings = body.bookings.map(normalizeBooking);
    days = body.days.map(d => normalizeDay({date:d.date,start:d.start,end:d.end,restMinutes:d.restMinutes,lodging:d.lodging},{}));
  } catch { throw new ShareCopyError('本地记录的条件、预订或已游览记录无效；原收藏未改变。'); }
  const fresh = await copySharedRoute(body, options);
  fresh.title = '本机行程重新核对'; fresh.summary = '全部地点已重新查询；同行、住宿、开放规则、预订及已游览均为用户记录，未独立核实。';
  fresh.source = 'local-rechecked'; fresh.context = context;
  fresh.days.forEach((d,i) => { Object.assign(d, days[i]); });
  fresh.stops.forEach((s,i) => { s.visit=visits[i]; if(progress[i])s.progress=progress[i]; });
  fresh.legs.forEach((l,i) => { l.booking=bookings[i]; });
  // Sign only fresh query facts and fixed metadata; validate normalizes all user fields
  // and clears roads before issuing a candidate. Local identity remains in the archive.
  const route = await validateCurrent(sealRoute(fresh));
  route.revision.reason='local-rechecked';
  return route;
}
module.exports = { recheckLocal };
