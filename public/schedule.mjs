// Pure scheduling tool shared by the Web and future server tools (dynamic import).
// All clock arithmetic is calendar arithmetic in Asia/Shanghai, never host time.
export const clockMinutes = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const addDate = (date, offset) => validDate(date) ? new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10) : null;
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function stamp(date, minutes) {
  if (!finite(minutes)) return null;
  const rounded = Math.ceil(minutes), dayOffset = Math.floor(rounded / 1440), m = rounded % 1440;
  return { date: addDate(date, dayOffset), time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, dayOffset };
}
export const formatStamp = value => value ? `${value.dayOffset ? `第${value.dayOffset + 1}日 ` : ''}${value.time}` : '时间未知';

export function normalizeVisit(input = {}) {
  const result = {};
  for (const [key, max] of [['stayMinutes', 720], ['restMinutes', 240]]) {
    if (input[key] == null || input[key] === '') continue;
    if (!Number.isInteger(input[key]) || input[key] < 0 || input[key] > max) throw new Error(`${key === 'stayMinutes' ? '停留' : '休息'}需为 0–${max} 分钟的整数`);
    result[key] = input[key];
  }
  if (input.openingRules != null) {
    const rules = input.openingRules;
    if (!Array.isArray(rules.periods) || rules.periods.length < 1 || rules.periods.length > 8) throw new Error('请填写 1–8 个营业时段');
    const periods = rules.periods.map(p => {
      if (clockMinutes(p.start) == null || clockMinutes(p.end) == null || p.start === p.end) throw new Error('营业时段需为 HH:mm-HH:mm，起止不可相同');
      return { start: p.start, end: p.end };
    });
    const closedWeekdays = [...new Set(rules.closedWeekdays || [])];
    const closedDates = [...new Set(rules.closedDates || [])];
    if (closedWeekdays.some(n => !Number.isInteger(n) || n < 0 || n > 6)) throw new Error('闭馆星期无效');
    if (closedDates.length > 100 || closedDates.some(d => !validDate(d))) throw new Error('特殊闭馆日期需为有效 YYYY-MM-DD');
    for (const key of ['validFrom', 'validTo']) if (rules[key] && !validDate(rules[key])) throw new Error('规则有效日期无效');
    if (rules.validFrom && rules.validTo && rules.validTo < rules.validFrom) throw new Error('规则结束日期不可早于开始日期');
    result.openingRules = { periods, closedWeekdays, closedDates, validFrom: rules.validFrom || null, validTo: rules.validTo || null,
      source: 'user', note: String(rules.note || '').slice(0, 300), recordedAt: typeof rules.recordedAt === 'string' ? rules.recordedAt : null };
  }
  return result;
}

const check = (code, status, message, suggestions = []) => ({ code, status, message, suggestions });
const severity = checks => checks.some(c => c.status === 'conflict') ? 'conflict' : checks.some(c => c.status === 'unknown') ? 'unknown' : 'provisional';
function openingWindow(rules, date, arrival, stay) {
  // A date-wide closure also cuts off an overnight opening from the previous day.
  const closed = d => rules.closedDates.includes(d) || rules.closedWeekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay());
  const covered = d => (!rules.validFrom || d >= rules.validFrom) && (!rules.validTo || d <= rules.validTo);
  const arrivalOffset = Math.floor(arrival / 1440), arrivalDate = addDate(date, arrivalOffset);
  if (!covered(arrivalDate)) return { status: 'unknown', reason: '到访日期不在所填开放规则有效期内' };
  const windows = [];
  // Only wait within the arrival calendar day. Do not silently move a visit to tomorrow.
  for (const offset of [arrivalOffset - 1, arrivalOffset]) {
    const d = addDate(date, offset);
    if (!covered(d) || closed(d)) continue;
    for (const period of rules.periods) {
      const start = clockMinutes(period.start), end = clockMinutes(period.end);
      let finish = offset * 1440 + end + (end < start ? 1440 : 0);
      if (end < start && (closed(addDate(d, 1)) || !covered(addDate(d, 1)))) finish = (offset + 1) * 1440;
      windows.push([offset * 1440 + start, finish]);
    }
  }
  windows.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const w of windows) {
    if (merged.length && w[0] <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], w[1]);
    else merged.push([...w]);
  }
  const fit = merged.find(([a, b]) => Math.max(a, arrival) + stay <= b && Math.max(a, arrival) < b);
  if (fit) return { status: 'pass', visitStart: Math.max(arrival, fit[0]), reason: '按所填开放规则可容纳本次停留（未独立核实）' };
  const available = Math.max(0, ...merged.map(([a, b]) => b - Math.max(a, arrival)));
  return { status: 'conflict', available: Math.floor(available), reason: closed(arrivalDate) ? `${arrivalDate} 为所填闭馆日` : '到达后没有足够的连续开放时间' };
}

export function solveSchedule(route) {
  const stops = new Map((route.stops || []).map(s => [s.id, s]));
  const output = { stops: [], days: [], scheduleStatus: 'unknown', timezone: 'Asia/Shanghai' };
  let previousDay = null, previousEnd = null, previousStopId = null;
  for (const day of route.days || []) {
    const checks = [], rows = [], ids = day.stopIds || [];
    if (!ids.length) { output.days.push({ id: day.id, schedule: { status: 'unplanned', start: null, end: null, elapsedMinutes: null, checks: [check('unplanned', 'unknown', '本日尚未安排地点')] } }); continue; }
    const date = validDate(day.date) ? day.date : null;
    const start = clockMinutes(day.requestedWindow?.start);
    let deadline = clockMinutes(day.requestedWindow?.end);
    if (start != null && deadline != null && deadline < start) deadline += 1440;
    let cursor = start, uncertain = false, transportMinutes = 0, walkingMeters = 0, unknownLegCount = 0, estimatedLegCount = 0;
    if (!date) checks.push(check('date', 'unknown', '日期未指定，无法核查星期、特殊闭馆日和规则有效期'));
    if (start == null) checks.push(check('start', 'unknown', '未指定每天开始时间，无法确定到离时刻'));
    let stayTotal = 0, restTotal = day.restMinutes || 0, waitTotal = 0;
    ids.forEach((id, index) => {
      const stop = stops.get(id), local = [];
      if (!stop) { cursor = null; checks.push(check('missing-stop', 'unknown', '行程引用的地点不存在')); return; }
      if (index || previousStopId) {
        const interday = !index;
        const fromId = index ? ids[index - 1] : previousStopId;
        const candidates = (route.legs || []).filter(l => l.dayId === day.id && (day.legIds || []).includes(l.id) && l.fromStopId === fromId && l.toStopId === id);
        const leg = candidates.length === 1 ? candidates[0] : null;
        let available = cursor;
        if (interday) {
          const offset = previousDay.date && date ? (Date.parse(previousDay.date+'T00:00:00Z') - Date.parse(date+'T00:00:00Z')) / 60000 : !previousDay.date && !date ? (previousDay.index-day.index)*1440 : null;
          available = previousEnd == null || offset == null ? null : previousEnd + offset;
          if (available != null && cursor != null) cursor = Math.max(cursor, available);
          else cursor = null;
        }
        if (leg?.booking) {
          const b = leg.booking;
          const relative = value => date ? (Date.parse(value+':00Z')-Date.parse(date+'T00:00:00Z'))/60000 : null;
          const depart = relative(b.departure), arrive = relative(b.arrival);
          transportMinutes += b.durationMinutes;
          local.push(check('booking-source','unknown','交通日期和时间由用户填写，车次/航班及接驳未独立核实'));
          if (depart == null || b.beforeMinutes == null || b.afterMinutes == null) {
            cursor = null; unknownLegCount++;
            local.push(check('transport','unknown','需填写本日日期及出发前/到达后接驳缓冲，才能确定后续时刻'));
          } else {
            const ready = interday ? available : cursor;
            if (ready == null) local.push(check('connection','unknown','前序行程结束未知，尚不能判断是否赶得上预订交通'));
            else if (ready + b.beforeMinutes > depart) local.push(check('connection','conflict',`前序游玩与接驳缓冲使出发晚 ${Math.ceil(ready+b.beforeMinutes-depart)} 分钟；请提前结束、改日或修改交通`));
            if (interday && previousDay.date && b.departure.slice(0,10) < previousDay.date) local.push(check('connection-date','conflict','交通出发日期早于前一天行程'));
            if (arrive < 0 || (deadline != null && arrive > deadline)) local.push(check('connection-date','conflict','交通到达不在本日安排范围，请调整地点所属日或交通日期'));
            if (!interday && cursor != null) waitTotal += Math.max(0, depart-b.beforeMinutes-cursor);
            cursor = Math.max(start ?? 0, arrive+b.afterMinutes);
          }
        } else {
        const usable = leg && ['routed', 'estimated'].includes(leg.status) && finite(leg.durationMinutes) && finite(leg.distanceMeters) && ['walking', 'cycling', 'driving', 'taxi', 'transit'].includes(leg.mode);
        if (!usable) { cursor = null; unknownLegCount++; local.push(check('transport', 'unknown', '上一段交通耗时/距离未知，后续时刻不能确定', [{ type: 'retry-transport', message: '重新获取交通，或在交通面板核对方式' }])); }
        else {
          transportMinutes += leg.durationMinutes;
          if (leg.mode === 'walking') walkingMeters += leg.distanceMeters;
          if (cursor != null) cursor += leg.durationMinutes;
          if (leg.status === 'estimated') { estimatedLegCount++; uncertain = true; local.push(check('transport-estimate', 'unknown', '上一段为交通粗估，时间与步行预算判断仅供参考')); }
        }
        if (interday) local.push(check('interday','unknown','跨日道路默认在本日开始时从前一日终点出发；住宿/夜间位置未核实，可填写预订交通或添加真实起终点'));
        }
      }
      if (!index && cursor != null) cursor += day.restMinutes || 0;
      if(stop.progress?.completed) {
        const history=structuredClone(stop.progress.schedule);
        const t=history.departure;
        cursor=t ? t.dayOffset*1440+clockMinutes(t.time) : null;
        stayTotal+=history.stayMinutes || 0;restTotal+=history.restMinutes || 0;waitTotal+=history.waitMinutes || 0;
        rows.push({id,schedule:history});return;
      }
      let visit;
      try { visit = normalizeVisit(stop.visit); }
      catch (error) { local.push(check('invalid-visit', 'unknown', error.message)); visit = {}; }
      const stay = visit.stayMinutes ?? 30, rest = visit.restMinutes ?? 0;
      if (visit.stayMinutes == null) local.push(check('stay-assumption', 'unknown', '停留暂按 30 分钟，可按需要调整'));
      if (rest === 0) local.push(check('rest-assumption', 'pass', '暂不另加休息，可按需要增加（不含在游玩停留内）'));
      const arrival = cursor;
      let wait = null, visitStart = cursor;
      if (!visit.openingRules) local.push(check('opening', 'unknown', stop.openingHours?.status === 'reported' ? '供应商仅提供开放文字，尚未转成可核查的当天规则' : '开放信息未知；时间轴仅为假设安排，不代表能入场'));
      else if (!date || cursor == null) local.push(check('opening', 'unknown', '缺少日期或到达时间，不能核查开放规则'));
      else {
        const opening = openingWindow(visit.openingRules, date, cursor, stay);
        const suggestions = opening.status === 'conflict' ? [
          ...(opening.available > 0 && opening.available < stay ? [{ type: 'shorten-stay', stopId: id, minutes: opening.available, message: `停留缩短至 ${opening.available} 分钟后重新检查` }] : []),
          { type: 'replace-stop', stopId: id, message: '换成当天可用的地点，或另选日期' }, { type: 'remove-stop', stopId: id, message: '删除此站后重新计算' }
        ] : [];
        local.push(check('opening', opening.status, opening.reason, suggestions));
        if (opening.status === 'pass') { visitStart = opening.visitStart; wait = visitStart - cursor; }
      }
      // Unknown opening keeps the clock as a hypothetical no-wait plan, never a pass.
      const visitEnd = visitStart == null ? null : visitStart + stay;
      cursor = visitEnd == null ? null : visitEnd + rest;
      stayTotal += stay; restTotal += rest; waitTotal += wait || 0;
      if (arrival == null) local.push(check('arrival', 'unknown', '前序时间尚未确定'));
      const schedule = { status: severity(local), arrival: stamp(date, arrival), visitStart: stamp(date, visitStart), visitEnd: stamp(date, visitEnd), departure: stamp(date, cursor),
        stayMinutes: stay, staySource: visit.stayMinutes == null ? 'default-assumption' : 'user', restMinutes: rest, waitMinutes: wait,
        timingBasis: uncertain ? 'estimated' : 'model', openingSource: visit.openingRules ? 'user' : stop.openingHours?.source || null, checks: local };
      rows.push({ id, schedule });
    });
    checks.push(...rows.flatMap(row => row.schedule.checks.filter(c => c.status !== 'pass').map(c => ({ ...c, stopId: row.id }))));
    if (deadline == null) checks.push(check('end-window', 'unknown', '未指定每日结束时间，无法判断是否超时'));
    else if (cursor == null) checks.push(check('end-window', 'unknown', '存在未知时间，无法判断每日结束时间'));
    else if (cursor > deadline) checks.push(check('end-window', 'conflict', `预计超过每日结束时间 ${Math.ceil(cursor - deadline)} 分钟${estimatedLegCount ? '（含交通粗估）' : ''}`, [
      { type: 'shorten-stay', message: `合计减少至少 ${Math.ceil(cursor - deadline)} 分钟停留/休息并重新检查` }, { type: 'remove-stop', message: '减少地点或改到其他日期，保留必去点' }
    ]));
    else checks.push(check('end-window', unknownLegCount || rows.some(r => r.schedule.status !== 'provisional') ? 'unknown' : 'pass', '假设时间轴未超过结束时间；仍需结合开放与交通证据'));
    const budget = route.context?.maxWalkKm;
    if (!finite(budget)) checks.push(check('walking-budget', 'unknown', '未指定每日步行上限'));
    else if (walkingMeters > budget * 1000) checks.push(check('walking-budget', 'conflict', `已知步行 ${(walkingMeters / 1000).toFixed(2)} km，超出每日 ${budget} km 上限${estimatedLegCount ? '（含粗估）' : ''}`, [{ type: 'change-mode', message: '将较长步行段改为可用的其他方式，或删减远点后重算' }]));
    else checks.push(check('walking-budget', unknownLegCount || estimatedLegCount ? 'unknown' : 'pass', `已知步行 ${(walkingMeters / 1000).toFixed(2)} km${unknownLegCount ? '，仍有未知段' : estimatedLegCount ? '，含交通粗估' : '，路段模型值未超过上限'}；不含景区内、停车后等额外步行`));
    const schedule = { status: severity(checks), start: stamp(date, start), end: stamp(date, cursor), deadline: stamp(date, deadline), elapsedMinutes: start != null && cursor != null ? Math.ceil(cursor - start) : null,
      stayMinutes: stayTotal, restMinutes: restTotal, knownWaitMinutes: waitTotal, transportMinutes, walkingMeters, unknownLegCount, estimatedLegCount,
      remainingMinutes: cursor != null && deadline != null ? Math.max(0, Math.floor(deadline-cursor)) : null,
      playBudgetMinutes: cursor != null && deadline != null ? Math.max(0, Math.floor(deadline-cursor+stayTotal)) : null, checks };
    output.stops.push(...rows); output.days.push({ id: day.id, schedule });
    previousDay = day; previousEnd = cursor; previousStopId = ids.at(-1);
  }
  output.scheduleStatus = severity(output.days.flatMap(d => d.schedule.checks));
  return output;
}

export function applySchedule(route) {
  const result = solveSchedule(route);
  const stops = new Map(result.stops.map(s => [s.id, s.schedule]));
  for (const stop of route.stops) stop.schedule = stops.get(stop.id) || { status: 'unknown', arrival: null, departure: null };
  const days = new Map(result.days.map(d => [d.id, d.schedule]));
  for (const day of route.days) day.schedule = days.get(day.id);
  route.planning.scheduleStatus = result.scheduleStatus;
  return result;
}
