'use strict';

const { randomUUID } = require('node:crypto');
const text = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const cityKey = value => text(value, 80).replace(/市$/, '').toLowerCase();
const nameKey = value => text(value, 120).normalize('NFKC').replace(/[\s·・,，。]/g, '').toLowerCase();
const userTextKey = value => typeof value === 'string' ? value.normalize('NFKC').replace(/[\p{P}\s]/gu, '').toLowerCase() : '';
// Only complete scenic-area designations are interchangeable. Do not shorten
// names such as 西湖游船/西湖公园, or infer aliases from arbitrary substrings.
const scenicNameKey = value => {
  const name = nameKey(value);
  const core = name.replace(/(?:风景名胜区|旅游景区|风景区|景区)$/, '');
  return core.length >= 2 ? core : name;
};
const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
};
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function unknownOpening() {
  return { status: 'unknown', text: null, source: null, url: null, retrievedAt: null, providerUpdatedAt: null, verifiedAt: null };
}

// Deliberately do not accept model coordinates, opening hours, prices or URLs.
function normalizeProposal(raw, defaultCity = '', { maxStops = 8, userPrompt = '' } = {}) {
  const limit = Number.isInteger(maxStops) ? Math.min(14, Math.max(2, maxStops)) : 8;
  if (!raw || !Array.isArray(raw.stops) || raw.stops.length < 2 || raw.stops.length > limit) throw new Error('Invalid route proposal');
  const city = text(raw.city, 80) || text(defaultCity, 80);
  const target = (value, fallbackCity) => {
    if (!value || !text(value.name, 120)) throw new Error('Missing proposed place');
    const addressHint = text(value.addressHint, 200);
    // A model-suggested address is not a user constraint or identity evidence.
    // Derive provenance here; never accept a model's claimed address source.
    const userAddress = userTextKey(addressHint);
    const addressHintSource = userAddress && userTextKey(userPrompt).includes(userAddress) ? 'user' : 'model';
    return { name: text(value.name, 120), city: text(value.city, 80) || fallbackCity, addressHint, addressHintSource, reason: text(value.reason, 400) };
  };
  return {
    id: `proposal-${randomUUID()}`, source: 'deepseek', status: 'proposed', createdAt: new Date().toISOString(),
    city, title: text(raw.title, 120) || '城市探索路线', rationale: text(raw.rationale || raw.summary, 600), mood: text(raw.mood, 80) || '自由探索',
    stops: raw.stops.map(value => ({
      id: `candidate-${randomUUID()}`, ...target(value, city),
      alternatives: (Array.isArray(value.alternatives) ? value.alternatives : []).slice(0, 1).map(alternative => target(alternative, text(value.city, 80) || city))
    }))
  };
}

// This accepts only adapter data, never model text. Generic APIs may supply a
// documented openingHours object; reported means supplied, not date-validated.
function poiFacts(poi, result) {
  const source = result.source === 'ctrip' ? 'ctrip' : 'mock';
  const provider = text(poi.provider || result.provider, 80) || (source === 'mock' ? 'local-demo' : 'ctrip-http');
  const retrievedAt = timestamp(poi.retrievedAt || result.retrievedAt);
  const providerUpdatedAt = timestamp(poi.providerUpdatedAt);
  const opening = poi.openingHours;
  const openingHours = source === 'ctrip' && opening?.status === 'reported' && text(opening.text, 600)
    ? { status: 'reported', text: text(opening.text, 600), source: provider, url: safeUrl(opening.url) || safeUrl(poi.detailUrl), retrievedAt, providerUpdatedAt: timestamp(opening.providerUpdatedAt), verifiedAt: null }
    : unknownOpening();
  const resultPoi = {
    id: text(String(poi.id ?? ''), 120), name: text(poi.name, 120), city: text(poi.city, 80), address: text(poi.address, 200),
    type: text(poi.type, 80) || '地点', location: { lat: poi.location?.lat, lng: poi.location?.lng },
    source, provider, retrievedAt, providerUpdatedAt, detailUrl: safeUrl(poi.detailUrl), openingHours,
    coordinateSource: text(poi.coordinateSource, 80) || provider, coordinateSystem: 'wgs84'
  };
  for (const key of ['image', 'imageSource', 'imageKind', 'imagePageUrl', 'imageAttribution', 'imageTitle']) resultPoi[key] = text(poi[key], 2000);
  return resultPoi;
}

function validPoi(poi) {
  const { lat, lng } = poi.location || {};
  return poi.id && poi.name && typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);
}

const hasUserAddress = target => target.addressHintSource !== 'model' && nameKey(target.addressHint).length >= 4;
const addressMatches = (target, poi) => !hasUserAddress(target) || nameKey(poi.address).includes(nameKey(target.addressHint));

function matchPlace(target, result) {
  if (!cityKey(target.city)) return { status: 'missing_city', candidates: [], selected: null };
  const all = (Array.isArray(result.pois) ? result.pois : []).slice(0, 60).map(poi => poiFacts(poi, result)).filter(validPoi);
  const exact = all.filter(poi => nameKey(poi.name) === nameKey(target.name));
  // An exact same-city identity takes precedence, including address conflicts.
  // Otherwise allow only this small, explicit suffix equivalence and retain
  // every identity so multiple same-city matches still require disambiguation.
  const named = exact.some(poi => cityKey(poi.city) === cityKey(target.city))
    ? exact
    : all.filter(poi => scenicNameKey(poi.name) === scenicNameKey(target.name));
  const inCity = named.filter(poi => cityKey(poi.city) === cityKey(target.city));
  let matches = [...new Map(inCity.map(poi => [`${poi.provider}:${poi.id}`, poi])).values()];
  // Direct user searches retain the strict address constraint. A generated
  // hint must neither reject a unique name nor choose between duplicate names.
  if (matches.length && hasUserAddress(target)) {
    const addressed = matches.filter(poi => addressMatches(target, poi));
    if (!addressed.length) return { status: 'address_mismatch', candidates: matches.slice(0, 5), selected: null };
    matches = addressed;
  }
  const status = matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : named.some(poi => poi.city) ? 'wrong_city' : named.length ? 'missing_city' : 'not_found';
  return { status, candidates: matches.slice(0, 5), selected: matches.length === 1 ? matches[0] : null };
}

async function matchProposal(proposal, search, { resolveIdentities } = {}) {
  const cache = new Map();
  const lookup = target => {
    const key = JSON.stringify([cityKey(target.city), nameKey(target.name)]);
    if (!cache.has(key)) cache.set(key, cityKey(target.city)
      ? Promise.resolve().then(() => search({ query: target.name, city: target.city, matchTarget: target })).catch(() => ({ source: 'unavailable', error: true, pois: [] }))
      : Promise.resolve({ source: 'unavailable', pois: [] }));
    return cache.get(key);
  };
  // At most 14 main + 14 backup queries, with three requests in flight.
  const tasks = proposal.stops.flatMap(slot => [slot, ...slot.alternatives]);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, async () => {
    while (next < tasks.length) await lookup(tasks[next++]);
  }));
  const prepared = new Map();
  const identityRequests = [];
  for (const [slotIndex, slot] of proposal.stops.entries()) {
    for (const [index, target] of [slot, ...slot.alternatives].entries()) {
      const result = await lookup(target);
      const match = result.error ? { status: 'service_error', candidates: [], selected: null } : matchPlace(target, result);
      const record = { result, match };
      prepared.set(target, record);
      if (typeof resolveIdentities !== 'function' || !['not_found', 'ambiguous'].includes(match.status)) continue;
      // The resolver compares names only against actual, usable same-city
      // provider facts. Explicit user addresses remain a hard boundary.
      const pool = match.status === 'ambiguous' ? match.candidates : (result.pois || []).slice(0, 60).map(poi => poiFacts(poi, result));
      const candidates = [...new Map(pool.filter(poi => validPoi(poi) && poi.source === 'ctrip' && cityKey(poi.city) === cityKey(target.city) && addressMatches(target, poi))
        .map(poi => [`${poi.provider}:${poi.id}`, poi])).values()];
      if (!candidates.length) continue;
      const request = { targetId: `${slot.id || `candidate-${slotIndex + 1}`}:${index}`, target: { name: target.name, city: target.city, addressHint: target.addressHint, addressHintSource: target.addressHintSource }, candidates };
      identityRequests.push(request);
      record.identity = request;
    }
  }
  let identityUnavailable = false;
  if (identityRequests.length) {
    try {
      // Never let a resolver alter the candidates used to validate its answer.
      const answers = await resolveIdentities(structuredClone(identityRequests));
      if (!Array.isArray(answers)) throw new Error('Invalid identity decisions');
      for (const record of prepared.values()) {
        if (!record.identity) continue;
        const replies = answers.filter(answer => answer?.targetId === record.identity.targetId);
        if (replies.length !== 1) continue;
        const answer = replies[0];
        if (!['same', 'uncertain', 'different'].includes(answer.decision)) continue;
        record.match.matchMethod = 'semantic';
        record.match.matchReason = text(answer.reason, 300) || 'AI 对照已返回的地点名称、城市与地址进行判断。';
        if (answer.decision !== 'same') continue;
        const selected = record.identity.candidates.filter(poi => typeof answer.candidateId === 'string' && poi.id === answer.candidateId && addressMatches(record.identity.target, poi));
        if (selected.length !== 1) { record.match.matchReason = 'AI 的判断未对应到唯一真实候选，未采用。'; continue; }
        record.match = { ...record.match, status: 'matched', candidates: selected, selected: selected[0] };
      }
    } catch { identityUnavailable = true; }
  }
  const used = new Set();
  const stops = [];
  const decisions = [];
  let realQueries = false;
  for (const slot of proposal.stops) {
    const attempts = [];
    let chosen = null;
    let selectedIndex = null;
    for (const [index, target] of [slot, ...slot.alternatives].entries()) {
      const { result, match: preparedMatch } = prepared.get(target);
      if (result.source === 'ctrip') realQueries = true;
      const match = { ...preparedMatch };
      const key = match.selected && `${match.selected.provider}:${match.selected.id}`;
      if (key && used.has(key)) { match.status = 'duplicate'; match.selected = null; }
      attempts.push({ role: index === 0 ? 'primary' : 'alternative', name: target.name, city: target.city, reason: target.reason, status: match.status, source: result.source, provider: text(result.provider, 80) || null, retrievedAt: timestamp(result.retrievedAt), candidates: match.candidates,
        ...(match.matchMethod ? { matchMethod: match.matchMethod, matchReason: match.matchReason } : {}) });
      if (!chosen && match.selected) { chosen = match.selected; selectedIndex = index; }
    }
    const status = chosen ? selectedIndex === 0 ? 'matched' : 'substituted' : 'unresolved';
    decisions.push({ id: slot.id, name: slot.name, city: slot.city, reason: slot.reason, status, selectedPoiId: chosen?.id || null, selectedCity: chosen?.city || null, selectedIndex, attempts });
    if (!chosen) continue;
    used.add(`${chosen.provider}:${chosen.id}`);
    stops.push({
      ...chosen, poiId: chosen.id, proposalCandidateId: slot.id, time: '待排程',
      note: selectedIndex === 0 ? slot.reason : slot.alternatives[selectedIndex - 1].reason || '主选未能唯一匹配，采用已匹配备选。',
      selection: { status, requestedName: slot.name, requestedCity: slot.city, selectedIndex, rationale: slot.reason },
      coordinateStatus: chosen.source === 'ctrip' ? '携程 POI 坐标' : '本地演示 POI 坐标',
      accent: ['#e26d4d', '#86a87b', '#d7a85d', '#7387a6'][stops.length % 4]
    });
  }
  const unresolved = decisions.filter(item => item.status === 'unresolved').length;
  const substituted = decisions.filter(item => item.status === 'substituted').length;
  const matchedProposal = { ...proposal, status: unresolved ? 'partial' : 'matched', stops: decisions };
  const cities = [...new Set(stops.map(stop => stop.city))];
  const poiSource = stops.length ? stops.every(stop => stop.source === 'ctrip') ? 'ctrip' : 'mock' : realQueries ? 'ctrip' : 'unavailable';
  return {
    proposal: matchedProposal, poiSource,
    warning: [unresolved ? `${unresolved} 个提议地点尚未唯一匹配，未加入地图。请在描述中补充具体名称、城市或分店地址后重新生成。` : '', identityUnavailable ? '部分地点的名称核对暂未完成，已保留能够确认的地点。' : '', substituted ? `${substituted} 站采用已匹配的备选地点。` : '', poiSource === 'mock' ? '未配置真实地点服务，当前匹配使用本地演示数据。' : ''].filter(Boolean).join(' '),
    route: { city: cities.join(' · ') || proposal.city, title: proposal.title, summary: proposal.rationale, mood: proposal.mood, duration: '待排程', distance: '待计算', stops, proposal: matchedProposal }
  };
}

module.exports = { normalizeProposal, matchPlace, matchProposal, unknownOpening, poiFacts };
