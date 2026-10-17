import { formatStamp } from './schedule.mjs';
import { amapLink } from './navigation.mjs';

const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const text = value => typeof value === 'string' ? value.trim() : '';
export function travelSourceUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function travelPhotoUrl(value) {
  if (typeof value !== 'string') return null;
  if (/^\/assets\/[a-z\d/_.%-]+$/i.test(value)) return value;
  const href = travelSourceUrl(value); if (!href) return null;
  const url = new URL(href);
  return /^(?:img\d+|t\d+)\.baidu\.com$/i.test(url.hostname) ? `/api/location-photo/image?${new URLSearchParams({ url: href })}` : href;
}
export function travelStopPlan(route, stop, index) {
  const schedule = stop.progress?.completed ? stop.progress.schedule || stop.schedule || {} : stop.schedule || {};
  const location = route.evidence?.find(item => item.subjectId === stop.id && item.field === 'location');
  const fact = stop.openingHours?.status === 'reported' ? stop.openingHours : route.evidence?.find(item => item.subjectId === stop.id && item.field === 'openingHours' && item.status === 'reported');
  const rules = stop.visit?.openingRules;
  const guide = stop.guide || {};
  const start = schedule.visitStart || schedule.arrival, end = schedule.visitEnd;
  const stay = schedule.stayMinutes ?? stop.visit?.stayMinutes ?? 30;
  const time = start?.time ? `${formatStamp(start)}${end?.time ? `–${formatStamp(end)}` : ''}` : `第 ${index + 1} 站`;
  const opening = text(guide.openingText) || text(fact?.text) || (rules?.periods?.length ? rules.periods.map(period => `${period.start}–${period.end}`).join('、') : '');
  const search = new URL('https://www.baidu.com/s'); search.searchParams.set('wd', `${stop.city || route.city || ''} ${stop.name} 官方 营业时间 预约`);
  const openingSource = text(guide.openingText) ? text(guide.source) || '网络资料' : rules?.periods?.length && !fact?.text ? '用户提供' : text(fact?.source) || '地点资料';
  const retrievedAt = text(guide.openingText) ? guide.retrievedAt : fact?.retrievedAt || rules?.recordedAt;
  const openingDate = retrievedAt && Number.isFinite(Date.parse(retrievedAt)) ? new Date(retrievedAt).toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai'}) : '';
  return {
    time, stay, opening, openingSource, openingDate, description: text(stop.note) || text(guide.description) || text(stop.description),
    openingUrl: text(guide.openingText) ? travelSourceUrl(guide.url) : travelSourceUrl(fact?.url),
    source: location?.status === 'demo' || stop.source === 'mock' ? '示例地点' : stop.provider === 'ctrip-mcp' || stop.source === 'ctrip' || location?.status === 'matched' ? '携程地点' : '地点资料',
    sourceUrl: travelSourceUrl(location?.url || stop.detailUrl), searchUrl: search.href, imageUrl: travelPhotoUrl(stop.image)
  };
}
function link(label, href) {
  const node = el('a', label); node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
}
export function refreshStopTimes(route, root = document) {
  const stops = new Map(route.stops.map(stop => [stop.id, stop]));
  for (const card of root.querySelectorAll('#storyboard .story-card[data-stop-id], #stopList > li[data-stop-id]')) {
    const stop = stops.get(card.dataset.stopId), time = card.querySelector('time');
    if (stop && time) time.textContent = stop.schedule?.arrival ? formatStamp(stop.schedule.arrival) : '自由安排';
  }
}
function photo(stop, plan) {
  const figure = el('figure', '', 'travel-stop-photo');
  if (!plan.imageUrl) { figure.append(el('div', stop.type || '下一站', 'travel-photo-placeholder')); return figure; }
  const image = el('img'); image.src = plan.imageUrl; image.alt = `${stop.name} · 地点参考照片`; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => { figure.replaceChildren(el('div', stop.type || '下一站', 'travel-photo-placeholder')); }, { once: true });
  figure.append(image);
  const credit = [stop.imageSource, stop.imageAttribution].filter(Boolean).join(' · ') || '地点参考照片';
  const url = travelSourceUrl(stop.imagePageUrl);
  figure.append(url ? link(credit, url) : el('figcaption', credit)); return figure;
}
export function refreshStopPhoto(stop, root = document) {
  const row = [...root.querySelectorAll('#scheduleDetails .travel-stop[data-stop-id]')].find(item => item.dataset.stopId === stop.id);
  row?.querySelector('.travel-stop-photo')?.replaceWith(photo(stop, { imageUrl: travelPhotoUrl(stop.image) }));
}
function renderHotels(route, panel, { selectHotel, hotelBusy } = {}) {
  const hotels = route.hotels;
  if (!hotels || hotels.status === 'not-requested') return;
  const section = el('section', '', 'travel-hotels'); section.append(el('h3', '住在哪里'));
  const candidates = Array.isArray(hotels.candidates) ? hotels.candidates : [];
  const selected = candidates.find(item => item.id === hotels.selectedId);
  const request = hotels.request || {};
  const dates = [request.checkIn || request.checkInDate, request.checkOut || request.checkOutDate].filter(Boolean).join(' → ');
  if (dates) section.append(el('p', dates, 'travel-plan-note'));
  if (selected) section.append(el('p', `已选住宿：${selected.name}。可更换候选；选择仅保存到出游计划，不代表已预订。`, 'travel-hotel-selected'));
  else if (candidates.length) section.append(el('p', '从携程返回的酒店中选择住宿，选择后会保存到当前行程。', 'travel-plan-note'));
  if (candidates.length && hotels.message) section.append(el('p', hotels.message, 'travel-plan-note'));
  if (!candidates.length) { section.append(el('p', hotels.message || '本次没有返回酒店候选，可回到“探索城市”告诉 DS 入住日期、预算或区域后重新选择。')); panel.append(section); return; }
  const grid = el('div', '', 'travel-hotel-grid');
  for (const hotel of candidates) {
    const card = el('article', '', `travel-hotel${hotel.id === hotels.selectedId ? ' is-selected' : ''}`);
    card.dataset.hotelId = hotel.id;
    const imageUrl = travelPhotoUrl(hotel.image); if (imageUrl) {
      const image = el('img'); image.src = imageUrl; image.alt = hotel.name; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.addEventListener('error', () => image.remove(), {once:true}); card.append(image);
    }
    card.append(el('h4', hotel.name));
    const address = [hotel.city, hotel.address].filter(Boolean).join(' · '); if (address) card.append(el('p', address));
    if (typeof hotel.rating === 'number' || typeof hotel.rating === 'string') card.append(el('p', `携程评分 ${hotel.rating}`));
    const price = typeof hotel.price === 'number' ? `¥${hotel.price}` : text(hotel.price) || (Number.isFinite(hotel.price?.amount) ? `${hotel.price.currency || '¥'}${hotel.price.amount}` : '');
    if (price) card.append(el('p', `${price} 起 · 具体房型、日期和费用以携程为准`, 'travel-hotel-price'));
    if (text(hotel.price?.description)) card.append(el('small', hotel.price.description));
    const actions = el('div', '', 'travel-stop-actions');
    if (hotel.detailUrl && travelSourceUrl(hotel.detailUrl)) actions.append(link('携程查看房型', travelSourceUrl(hotel.detailUrl)));
    if (hotel.location) { try { actions.append(link('高德前往酒店', amapLink(hotel, null, 'driving'))); } catch { /* Hotels without valid coordinates still remain selectable. */ } }
    const choose = el('button', hotel.id === hotels.selectedId ? '已选这家酒店' : '选择这家酒店'); choose.type = 'button'; choose.disabled = hotelBusy || hotel.id === hotels.selectedId;
    choose.addEventListener('click', () => selectHotel?.(hotel.id)); actions.append(choose); card.append(actions); grid.append(card);
  }
  section.append(grid, el('small', '酒店资料来自本次携程查询；未返回报价时不展示价格，选择酒店不会下单。')); panel.append(section);
}

export function renderSchedule(route, { selectStop, dayId, selectHotel, hotelBusy } = {}) {
  const panel = document.getElementById('scheduleDetails'); if (!panel) return;
  panel.replaceChildren();
  panel.append(el('p', '把每天的地点、照片、游玩安排放在一起。时间为计划参考；点开高德即可导航，营业与预约信息可查看来源或官网。', 'travel-plan-note'));
  const omitted = route.proposal?.stops?.filter(slot => !['matched', 'substituted'].includes(slot.status)).map(slot => slot.name).filter(Boolean) || [];
  if (omitted.length) panel.append(el('p', `本次路线未包含：${omitted.join('、')}。可回到“探索城市”向 DS 补充具体名称或地址。`, 'travel-plan-note'));
  for (const day of route.days || []) {
    if (dayId && day.id !== dayId) continue;
    const section = el('section', '', 'travel-day'); section.dataset.dayId = day.id;
    const heading = el('div', '', 'travel-day-heading'); heading.append(el('h4', `第 ${day.index} 天${day.date ? ` · ${day.date}` : ''}`));
    const stops = day.stopIds.map(id => route.stops.find(stop => stop.id === id)).filter(Boolean);
    if (stops.length) heading.append(el('span', stops.map(stop => stop.name).join(' → ')));
    section.append(heading);
    if (!stops.length) section.append(el('p', '留一段自由探索时间，也可以回到“探索城市”告诉 DS 想增加的地点。'));
    const list = el('ol', '', 'travel-stops');
    stops.forEach((stop, index) => {
      const plan = travelStopPlan(route, stop, index), row = el('li', '', 'travel-stop'); row.dataset.stopId = stop.id; row.tabIndex = -1;
      row.append(photo(stop, plan));
      const content = el('div', '', 'travel-stop-content');
      content.append(el('p', `${plan.time} · 停留 ${plan.stay} 分钟${stop.progress?.completed ? ' · 已游览' : ''}`, 'travel-stop-time'));
      const jump = el('button', `${index + 1}. ${stop.name}`, 'travel-stop-title'); jump.type = 'button'; jump.addEventListener('click', () => selectStop?.(route.stops.indexOf(stop))); content.append(jump);
      if (stop.address) content.append(el('p', stop.address, 'travel-stop-address'));
      if (plan.description) content.append(el('p', plan.description, 'travel-stop-description'));
      if (plan.opening) content.append(el('p', `营业安排：${plan.opening}`, 'travel-stop-opening'));
      const actions = el('div', '', 'travel-stop-actions');
      try { actions.append(link('高德导航', amapLink(stop, null, route.context?.transportMode))); } catch { /* No navigation URL for invalid coordinates. */ }
      actions.append(link('查看营业与预约', plan.openingUrl || plan.searchUrl));
      if (plan.sourceUrl) actions.append(link('地点详情', plan.sourceUrl));
      content.append(actions, el('small', `${plan.source}${plan.opening ? ` · 营业资料：${plan.openingSource}${plan.openingDate ? ` · 查阅 ${plan.openingDate}` : ''}（以场所当日安排为准）` : ''}`, 'travel-stop-source'));
      row.append(content); list.append(row);
    });
    section.append(list); if (day.lodging?.text) section.append(el('p', `住宿备注：${day.lodging.text}`, 'travel-plan-note')); panel.append(section);
  }
  renderHotels(route, panel, { selectHotel, hotelBusy });
}
