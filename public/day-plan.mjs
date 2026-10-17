import { validDate, clockMinutes, addDate } from './schedule.mjs';

export function normalizeDay(input, day) {
  const date = input.date || null;
  if (date && (!validDate(date) || date < '2000-01-01' || date > '2099-12-31')) throw new Error('每日日期需为2000–2099年的有效日期');
  const start = input.start || null, end = input.end || null;
  if ((start && clockMinutes(start) == null) || (end && clockMinutes(end) == null) || (start && start === end)) throw new Error('每日起止时间无效；结束较早表示次日');
  const restMinutes = Number(input.restMinutes || 0);
  if (!Number.isInteger(restMinutes) || restMinutes < 0 || restMinutes > 720) throw new Error('每日出发前休息需为0–720分钟');
  return { ...day, date, requestedWindow: { start, end }, restMinutes, lodging: { status: input.lodging ? 'user-reported' : 'unknown', text: String(input.lodging || '').slice(0, 300), source: 'user' } };
}

export function normalizeBooking(input) {
  if (!input) return null;
  const result = { source: 'user', verifiedAt: null };
  for (const key of ['departure', 'arrival']) {
    const value = input[key];
    if (typeof value !== 'string' || value.length !== 16 || value[10] !== 'T' || !validDate(value.slice(0, 10)) || clockMinutes(value.slice(11)) == null) throw new Error('请填写完整的交通出发/到达日期与时间（北京时间）');
    result[key] = value;
  }
  const duration = (Date.parse(result.arrival + ':00Z') - Date.parse(result.departure + ':00Z')) / 60000;
  if (duration <= 0 || duration > 14 * 1440) throw new Error('交通到达必须晚于出发，且不超过14天');
  for (const key of ['beforeMinutes', 'afterMinutes']) {
    const n = input[key] === '' || input[key] == null ? null : Number(input[key]);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 1440)) throw new Error('接驳/候车缓冲需为0–1440分钟；未知请留空');
    result[key] = n;
  }
  result.label = String(input.label || '').slice(0, 120);
  result.durationMinutes = duration;
  return result;
}

export function daySubset(route, dayId) {
  if (!dayId) return route;
  const day = route.days.find(d => d.id === dayId);
  return { ...route, days: day ? [day] : [], stops: route.stops.filter(s => s.dayId === dayId), legs: route.legs.filter(l => l.dayId === dayId && route.stops.find(s => s.id === l.fromStopId)?.dayId === dayId) };
}
export const nextDayDate = days => addDate(days.at(-1)?.date, 1);
