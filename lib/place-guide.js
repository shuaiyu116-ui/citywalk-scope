'use strict';
const { scopedFetch } = require('./agent-scope');
// Opening information is descriptive reference material, never a scheduling
// rule or an assertion that a venue will admit the traveller on their date.
const cache = new Map();
const clean = (value, length = 600) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, length) : '';
const nameKey = value => clean(value, 160).normalize('NFKC').replace(/[\s\p{P}]/gu, '').toLowerCase();
function distance(a, b) {
  const r = Math.PI / 180, lat = (a.lat + b.lat) / 2 * r;
  return Math.hypot((a.lat - b.lat) * r, (a.lng - b.lng) * r * Math.cos(lat)) * 6371000;
}
function openingLabel(value) {
  if (value === '24/7') return '全天开放（社区记录）';
  const days = { Mo:'周一', Tu:'周二', We:'周三', Th:'周四', Fr:'周五', Sa:'周六', Su:'周日', PH:'法定节假日', off:'关闭', open:'开放' };
  return value.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|off|open)\b/g, token => days[token]);
}
function matchGuide(stop, elements, retrievedAt) {
  const candidates = elements.flatMap(element => {
    const tags = element.tags || {}, names = [tags.name, tags['name:zh'], tags.official_name, ...String(tags.alt_name || '').split(';')];
    const location = { lat:element.lat ?? element.center?.lat, lng:element.lon ?? element.center?.lon };
    if (!names.some(name => nameKey(name) === nameKey(stop.name)) || !clean(tags.opening_hours) ||
      !['node','way','relation'].includes(element.type) || !Number.isSafeInteger(element.id) ||
      !Number.isFinite(location.lat) || !Number.isFinite(location.lng) || distance(stop.location, location) > 750) return [];
    return [{ element, hours:clean(tags.opening_hours), distance:distance(stop.location, location) }];
  }).sort((a,b) => a.distance-b.distance);
  if (!candidates.length || new Set(candidates.map(candidate => candidate.hours)).size !== 1) return null;
  const { element, hours } = candidates[0];
  return { openingText:openingLabel(hours), url:`https://www.openstreetmap.org/${element.type}/${element.id}`, source:'OpenStreetMap 社区资料', retrievedAt };
}
async function enrichPlaceGuides(route) {
  const stops = route.stops.slice(0, 14).filter(stop => !stop.guide?.openingText && Number.isFinite(stop.location?.lat) && Math.abs(stop.location.lat) <= 90 && Number.isFinite(stop.location.lng) && Math.abs(stop.location.lng) <= 180);
  const pending = [], now = Date.now();
  for (const stop of stops) {
    const key = JSON.stringify([stop.name,stop.location]);
    const hit = cache.get(key);
    if (hit && now < hit.until) { if (hit.guide) stop.guide = structuredClone(hit.guide); }
    else pending.push({stop,key});
  }
  if (!pending.length) return route;
  try {
    const query = `[out:json][timeout:5];(${pending.map(({stop}) => `nwr(around:750,${stop.location.lat},${stop.location.lng})["opening_hours"];`).join('')});out center tags 160;`;
    const response = await scopedFetch('https://overpass-api.de/api/interpreter', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({data:query}).toString(), signal:AbortSignal.timeout(6500) });
    if (!response.ok) throw Error('guide service unavailable');
    const text = await response.text();
    if (text.length > 300000) throw Error('guide response too large');
    const data = JSON.parse(text);
    if (!Array.isArray(data.elements) || data.elements.length > 500) throw Error('guide response invalid');
    const retrievedAt = new Date().toISOString();
    for (const {stop,key} of pending) {
      const guide = matchGuide(stop,data.elements,retrievedAt);
      if (guide) stop.guide = guide;
      cache.set(key,{guide,until:now+(guide ? 6*3600000 : 5*60000)});
    }
    while (cache.size > 100) cache.delete(cache.keys().next().value);
  } catch (error) {
    if (error.code === 'AGENT_LIMIT') throw error;
    // No synthetic hours and no failure paragraph per venue. The roadbook has
    // an ordinary source-search link when community records are absent.
  }
  return route;
}
module.exports = { enrichPlaceGuides, matchGuide, openingLabel };
