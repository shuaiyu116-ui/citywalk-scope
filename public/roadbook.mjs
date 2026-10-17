import { createPortable, publicText, safePublicUrl } from './portable-route.mjs';
import { amapLink } from './navigation.mjs';

const modes = { walking: '步行', cycling: '骑行', driving: '自驾', taxi: '打车', transit: '公共交通', mixed: '混合出行' };
const companions = { none: '无特殊条件', children: '儿童', seniors: '老人', wheelchair: '轮椅使用者', stroller: '婴儿车' };
const statuses = { unknown: '未知', loading: '计算尚未完成', routed: '道路模型结果', estimated: '粗估', unavailable: '不可用', scheduled: '用户填写的预订，未核实', conflict: '存在冲突', provisional: '所填条件下暂未发现冲突', unplanned: '未安排' };
export const escapeHtml = value => publicText(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const e = escapeHtml;
const text = value => value == null || value === '' ? '未知' : String(value);
const n = (value, suffix = '分钟') => Number.isFinite(value) ? `${Math.round(value * 100) / 100} ${suffix}` : '未知';
const stamp = value => value ? `${value.date || (value.dayOffset ? `相对第${value.dayOffset + 1}日` : '日期未定')} ${value.time || '时刻未知'}` : '时间未知';
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）' : '未知';
const p = value => `<p>${e(value)}</p>`;
const link = (url, label) => safePublicUrl(url) ? `<a href="${e(safePublicUrl(url))}" target="_blank" rel="noopener noreferrer">${e(label)}</a>` : '';
const list = values => `<ul>${values.map(v => `<li>${e(v)}</li>`).join('')}</ul>`;
function embeddedPhotos(photos) {
  const result = Object.create(null); let bytes = 0;
  for (const [id, value] of Object.entries(photos || {})) {
    if (typeof value !== 'string' || value.length > 1.5 * 1024 * 1024 || !/^data:image\/(?:jpeg|png|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(value)) continue;
    if (bytes + value.length > 12 * 1024 * 1024) continue;
    result[id] = value; bytes += value.length;
  }
  return result;
}
function photoFigure(photo, name, credit, sourceUrl) {
  return photo ? `<figure><img src="${photo}" alt="${e(name)}参考照片"><figcaption>${e(credit)}${sourceUrl ? ` ${link(sourceUrl, '照片来源')}` : ''}</figcaption></figure>` : '';
}

export function preparation(route) {
  const context = route.context || {}, people = new Set(context.companions || []);
  const used = new Set([context.transportMode, ...route.legs.map(l => l.mode || l.preferredMode)]);
  const items = [
    '随身带饮水、充电设备和适合步行的鞋；把此路书保存在手机，导航与来源链接需要网络。',
    '出发前向各场所确认预约、证件、当天开放与最后入场时间；本路书不提供实时余票或入场保证。'
  ];
  if (people.has('children')) items.push('带儿童：准备饮水、加餐和替换衣物，途中预留厕所与休息；场所年龄限制、儿童票和安全座椅需另行确认。');
  if (people.has('seniors')) items.push('有老人同行：按个人体力缩短连续步行、增加坐下休息，随身带个人常用物品；有不适时及时停止行程。');
  if (people.has('wheelchair') || people.has('stroller')) items.push('轮椅/婴儿车：提前致电确认无台阶入口、电梯、卫生间与车辆装载空间；道路路线不保证全程无障碍，准备可替换地点。');
  if (used.has('walking')) items.push('步行：注意路口、台阶与景区内部路程；已算路段不包含景区内游玩距离。');
  if (context.maxWalkKm != null) items.push(`本次每日路段步行预算为 ${context.maxWalkKm} km；景区内部、停车后与未知路段的步行未必计入，请留余量。`);
  if (used.has('cycling')) items.push('骑行/租车：提前确认当地投放范围、可骑道路、还车区、头盔、适用年龄与押金；共享单车余量、营业点和价格未查询。雨天或无法借还时改用其他交通。');
  if (used.has('driving')) items.push('自驾/租车：备好有效驾照及租赁要求的证件，核对取还车时间、异地还车、保险免赔、押金、限行和停车；租车门店、库存、报价均未查询，须向平台或门店确认。');
  if (used.has('taxi')) items.push('打车：另留等车与上下客步行时间，提前找合法上车点；未查询实时车费和供给，高德链接只是规划，不会下单。');
  if (used.has('transit') || route.legs.some(l => l.booking)) items.push('公共交通/跨城：核对运行日期、首末班、站点入口及换乘，车次/航班记录来自用户，未核实；接驳、安检和候车需另留缓冲，空白缓冲不等于零。');
  if (used.has('mixed')) items.push('混合出行：逐段确认最终方式；尚未确定方式的导航链接默认步行，出发前在高德重新选择。');
  if (route.days.length > 1) items.push('多日：确认每晚住宿及行李存放；住宿文字不是已核实位置，跨日道路默认从前一日最后一站出发，实际住宿不同需重排。');
  const dates = route.days.map(d => d.date).filter(Boolean);
  items.push(dates.length ? `出行日期已填：${dates.join('、')}。建议出发前48小时及当天再查当地预报、预警和临时闭馆；当前未查询天气，不能据季节推断晴雨。` : '日期尚未填写：请先确定日期，再核对天气、闭馆日、预约和车次；当前未查询天气。');
  return items;
}

function legHtml(l, route) {
  const from = route.stops.find(s => s.id === l.fromStopId), to = route.stops.find(s => s.id === l.toStopId);
  const booking = l.booking;
  return `<div class="leg">${p(`${l.kind === 'interday' ? '跨日衔接 · ' : ''}${from?.name} → ${to?.name}${modes[l.mode || l.preferredMode] ? ` · ${modes[l.mode || l.preferredMode]}` : ''}${Number.isFinite(l.durationMinutes) ? ` · ${l.status === 'estimated' ? '粗估' : '约'} ${Math.ceil(l.durationMinutes)} 分钟` : ''}`)}` +
    (booking ? p(`用户预订记录（未核实，北京时间）：${booking.label || '未填班次'}；${booking.departure} → ${booking.arrival}；出发前 / 到达后缓冲 ${n(booking.beforeMinutes)} / ${n(booking.afterMinutes)}`) : '') +
    link(amapLink(to, from, l.mode || l.preferredMode), '高德导航') + '</div>';
}
function stopHtml(stop, route, photos) {
  const s = stop.progress?.completed ? stop.progress.schedule || {} : stop.schedule || {};
  const location = route.evidence?.find(v => v.subjectId === stop.id && v.field === 'location');
  const opening = stop.openingHours?.status === 'reported' ? stop.openingHours : route.evidence?.find(v => v.subjectId === stop.id && v.field === 'openingHours' && v.status === 'reported');
  const rules = stop.visit?.openingRules;
  const photo = photos[stop.id];
  return `<article class="stop"><h3>${e(route.stops.indexOf(stop) + 1)}. ${e(stop.name)}${stop.locked ? ' · 必去' : ''}</h3>` +
    `<div class="stop-layout${photo ? '' : ' no-photo'}">` +
    photoFigure(photo, stop.name, [stop.imageSource, stop.imageAttribution, '地点参考照片'].filter(Boolean).join(' · '), stop.imagePageUrl) + '<div class="stop-copy">' +
    (stop.progress?.completed ? '<p class="notice"><strong>用户标记已游览 / 原计划</strong>：以下是标记时的计划快照，不是实际到离时间或实走轨迹。</p>' : '') +
    p([stop.city || route.city, stop.address].filter(Boolean).join(' · ')) +
    (stop.note || stop.guide?.description ? p(stop.note || stop.guide?.description) : '') +
    (s.visitStart && s.visitEnd ? p(`计划游玩 ${stamp(s.visitStart)} → ${stamp(s.visitEnd)}`) : p('按本日路线顺序游览')) +
    p([Number.isFinite(s.stayMinutes) ? `建议停留 ${n(s.stayMinutes)}` : '', s.restMinutes > 0 ? `休息 ${n(s.restMinutes)}` : ''].filter(Boolean).join(' · ')) +
    link(location?.url || stop.detailUrl, location?.status === 'demo' ? '示例地点资料' : '地点资料') +
    (stop.guide?.openingText || opening?.text ? p(`开放安排：${stop.guide?.openingText || opening.text}`) : '') +
    link(stop.guide?.url || opening?.url, stop.guide?.source || '开放与介绍来源') +
    (rules ? p(`用户填写开放规则：${(rules.periods || []).map(v => `${v.start}–${v.end}`).join('、')}${rules.note ? ` · ${rules.note}` : ''}`) : '') +
    link(`https://www.baidu.com/s?wd=${encodeURIComponent(`${stop.city || route.city} ${stop.name} 官网 开放时间 预约`)}`, '查看营业与预约安排') + ' · ' +
    link(amapLink(stop, null, route.context?.transportMode), '高德导航') + '</div></div></article>';
}

function hotelsHtml(hotels, photos) {
  if (!hotels || hotels.status === 'not-requested') return '';
  const candidates = hotels.candidates || [];
  return `<section><h2>酒店选择</h2>${p('以下是携程查询候选，选择酒店用于本次出游计划；预订与付款在携程完成。')}` +
    (candidates.length ? candidates.map(hotel => {
      const photo = photos[`hotel:${hotel.id}`];
      return `<article class="stop"><h3>${hotel.id === hotels.selectedId ? '已选 · ' : ''}${e(hotel.name)}</h3><div class="stop-layout${photo ? '' : ' no-photo'}">${photoFigure(photo, hotel.name, '携程酒店参考照片')}<div class="stop-copy">${p([hotel.city, hotel.address].filter(Boolean).join(' · '))}${hotel.description ? p(hotel.description) : ''}${hotel.priceLabel ? p(hotel.priceLabel) : hotel.price?.amount != null ? p(`${hotel.price.amount} ${hotel.price.currency || '元'}${hotel.price.unit || ''}${hotel.price.description ? ` · ${hotel.price.description}` : ''}`) : ''}${Number.isFinite(hotel.rating) ? p(`携程评分 ${hotel.rating}`) : ''}${link(hotel.detailUrl, '在携程查看房型与实时价格')}</div></div></article>`;
    }).join('') : p(hotels.message || '暂未取得酒店候选，可继续告诉 AI 住宿偏好。')) + '</section>';
}

const style = `:root{color-scheme:light;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#263934;background:#f5f7f6}*{box-sizing:border-box}body{margin:0;line-height:1.7;overflow-wrap:anywhere}main{max-width:900px;margin:auto;padding:28px;background:white}h1{font-size:28px;line-height:1.35}h2{margin-top:32px;border-bottom:2px solid #4b7165;padding-bottom:8px}h3{font-size:20px}h4{margin:8px 0}p{margin:8px 0}a{color:#246953}button{font:inherit;padding:9px 14px;background:#246953;color:white;border:0;border-radius:6px;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #bd6b28;outline-offset:3px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.notice{background:#eef3ef;padding:14px}.stop{border-top:1px solid #c8d6ce;padding:12px 0}.leg{padding:10px 14px;background:#f3f5f4;margin:12px 0}.muted,figcaption{color:#53665e;font-size:14px}.checks{padding-left:22px}li{margin:7px 0}figure{margin:12px 0}img{max-width:100%;width:420px;max-height:260px;object-fit:cover}nav ul{padding-left:22px}@media(max-width:600px){main{padding:16px}h1{font-size:24px}}@page{size:A4;margin:16mm}@media print{body,main{background:white;color:black}main{max-width:none;padding:0}.actions{display:none}h2,h3,h4{break-after:avoid}img{max-height:150px}figure,.leg{break-inside:avoid}a{color:black;text-decoration:underline}p,li{orphans:3;widows:3}}`;
const imageStyle = `.stop-layout{display:grid;grid-template-columns:minmax(0,280px) minmax(0,1fr);gap:22px;align-items:start}.stop-layout.no-photo{display:block}.stop-copy{min-width:0}.stop-layout figure{margin:8px 0}.stop-layout img{display:block;width:100%;max-height:260px;border-radius:8px}.stop-layout figcaption{margin-top:6px;font-size:12px;line-height:1.5}@media(max-width:600px){.stop-layout{grid-template-columns:1fr;gap:8px}.stop-layout img{max-height:340px}}@media print{.stop-layout{grid-template-columns:60mm minmax(0,1fr);gap:6mm}.stop-layout img{max-height:46mm}.stop-layout figure{break-inside:avoid}}`;
const actionsScript = `document.getElementById('print').addEventListener('click',()=>window.print());document.getElementById('json').addEventListener('click',()=>{const b=new Blob([document.getElementById('route-data').textContent],{type:'application/json'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='citywalk-route.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});`;

export function renderRoadbook(input, { photos = {}, interactive = true } = {}) {
  // Re-project even envelopes created elsewhere; importing never authorizes facts.
  const packet = createPortable(input.route || input, { exportedAt: input.exportedAt || new Date().toISOString(), imported: !!input.imported });
  const r = packet.route, context = r.context || {};
  photos = embeddedPhotos(photos);
  const serialized = JSON.stringify(packet, null, 2).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const body = `<header><p>先行 · Citywalk Scope</p><h1>${e(r.title || '我的行程路书')}</h1>` +
    p(`版本 ${r.revision.number} · ${r.days.length} 天 / ${r.stops.length} 次到访 · 导出 ${time(packet.exportedAt)}`) +
    p(`路线来源：${r.source === 'local-rechecked' ? '本机行程重新查询地点；个人条件为用户记录，未独立核实' : r.source === 'shared-copy' ? '分享的新副本，地点在复制时重新查询，未调用 AI 重新规划' : r.source === 'deepseek' ? 'AI规划，地点依据逐站列出' : ['demo', 'demo-fallback'].includes(r.source) ? '城市示例 / 示例回退，并非定制结果' : '未知 / 文件声明，未重新核实'}；地点数据 ${text(r.poiSource)}`) +
    (packet.imported ? '<p class="notice">导入文件 · 只读预览。所有事实、来源、时间和已游览标记均来自文件，未重新核实；不替换网页当前行程，也不能直接继续可信多轮规划。</p>' : '<p class="notice">当前已提交行程快照：不含编辑草稿或未采用候选。传给他人前请检查本次同行条件、住宿备注和预订记录。</p>') +
    (r.restoration ? p('本机恢复 · 未核实：以下坐标、来源及原计划来自本机快照，不代表当前事实。可信多轮需联网重核。') : '') +
    p(`交通偏好 ${modes[context.transportMode] || '未填写'}；本次同行条件 ${(context.companions || []).map(v => companions[v] || '未识别').join('、') || '未填写'}；每日路段步行预算 ${n(context.maxWalkKm, 'km')}`) +
    `<section><h2>旅行概览</h2>${r.summary ? p(r.summary) : ''}</section></header>` +
    (interactive ? '<div class="actions"><button id="print">打印 / 保存为 PDF</button><button id="json">下载行程 JSON</button></div>' : '') +
    `<nav aria-label="每日目录"><h2>当前行程目录</h2><ul>${r.days.map(d => `<li><a href="#day-${d.index}">第 ${d.index} 天 · ${e(d.date || '日期未定')}</a>：${e(d.stopIds.map(id => r.stops.find(s => s.id === id)?.name).join(' → ') || '空日，尚未安排')}</li>`).join('')}</ul></nav>` +
    hotelsHtml(r.hotels, photos) +
    `<section><h2>准备清单与配套建议</h2>${p('以下为基于本次行程条件的通用建议，不读取页面保存的私密偏好，也不是实时查询或预订结果。')}${list(preparation(r))}${p('天气、租赁库存/价格均未查询（来源与获取时间：无）；没有把导出时间当作事实核实时间。')}${link('https://www.weather.com.cn/', '中国天气网：联网自行查询预报与预警（未查询）')}</section>` +
    r.days.map(d => `<section id="day-${d.index}"><h2>第 ${d.index} 天 · ${e(d.date || '日期未定')}</h2>` +
      (d.requestedWindow?.start && d.requestedWindow?.end ? p(`本日出游时段 ${d.requestedWindow.start}–${d.requestedWindow.end}`) : '') +
      (d.lodging?.text ? p(`住宿备注：${d.lodging.text}`) : '') +
      (!d.stopIds.length ? p('本日为空日，尚未安排地点，不复制其他日期的路线。') : d.stopIds.map(id => {
        const leg = r.legs.find(l => l.toStopId === id);
        return (leg ? legHtml(leg, r) : '') + stopHtml(r.stops.find(s => s.id === id), r, photos);
      }).join('')) + '</section>').join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${e(r.title || '行程路书')}</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23246953'/%3E%3Cpath d='M8 9h16M8 16h12M8 23h16' stroke='white' stroke-width='3'/%3E%3C/svg%3E"><style>${style}${imageStyle}</style></head><body><main>${body}</main><script id="route-data" type="application/json">${serialized}</script>${interactive ? `<script>${actionsScript}</script>` : ''}</body></html>`;
}
