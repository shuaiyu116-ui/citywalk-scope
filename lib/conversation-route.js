'use strict';
// Process-local signing key: provenance is not an account or a navigation guarantee.
const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
const { resolveTripContext } = require('./itinerary');
const secret = randomBytes(32);
const fields = ['poiId','name','city','address','type','note','time','accent','location','openingHours','guide','coordinateStatus','coordinateSource','detailUrl','image','imageSource','imageKind','imagePageUrl','imageAttribution','proposalCandidateId'];
const pick = (v, keys) => Object.fromEntries(keys.filter(k => v[k] !== undefined).map(k => [k, structuredClone(v[k])]));
const sign = data => { const payload = Buffer.from(JSON.stringify({ expires: Date.now() + 12*3600000, ...data })).toString('base64url'); return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url'); };
function verify(token, maxLength=30000) {
  if (typeof token !== 'string' || token.length > maxLength) throw Error('地点依据已失效，请重新检索地点或新建行程；当前路线仍可手动编辑。');
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature || '', 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw Error('地点依据已失效，请重新检索地点或新建行程；当前路线仍可手动编辑。');
  const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (value.expires < Date.now()) throw Error('地点依据已过期，请重新检索地点或新建行程。');
  return value;
}
function sealRoute(route) {
  route.planProof=sign({meta:pick(route,['title','summary','mood','duration','distance','source','proposal','hotels'])});
  for (const stop of route.stops) stop.placeProof = sign({ facts: { ...pick(stop, fields), city: stop.city || route.city }, evidence: route.evidence.filter(e => e.subjectId === stop.id).map(e => pick(e,['field','status','text','source','url','retrievedAt','providerUpdatedAt','verifiedAt'])) });
  return route;
}
function sealPoi(poi) {
  poi.placeProof = sign({ facts: { ...pick(poi, fields), poiId: poi.id }, evidence: [
    { field:'location',status:poi.source === 'ctrip' ? 'matched':'demo',source:poi.provider || 'local-demo',url:poi.detailUrl || null,retrievedAt:poi.retrievedAt || null,verifiedAt:null },
    { field:'openingHours',...poi.openingHours }
  ] });
  return poi;
}
const id = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,90}$/.test(value)) throw Error('行程身份无效'); return value; };
const unique = values => { if (new Set(values).size !== values.length) throw Error('行程身份重复'); };
async function validateCurrent(input) {
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.stops) || input.stops.length < 2 || input.stops.length > 50 || !Array.isArray(input.days) || !input.days.length || input.days.length > 14 || !Array.isArray(input.legs) || input.legs.length !== input.stops.length-1) throw Error('当前行程结构无效，请使用已生成的行程');
  const [{ normalizeDay, normalizeBooking }, { normalizeVisit }, { reconcile }] = await Promise.all([import('../public/day-plan.mjs'),import('../public/schedule.mjs'),import('../public/itinerary-editor.mjs')]);
  const meta=verify(input.planProof,300000).meta;
  // Hotel provider facts come only from the sealed result. The user may choose
  // a returned candidate, but cannot supply a hotel, quote or booking as fact.
  if (meta?.hotels && input.hotels?.selectedId != null) {
    if (!meta.hotels.candidates?.some(hotel => hotel.id === input.hotels.selectedId)) throw Error('酒店选择已失效，请从本次携程候选中重新选择');
    meta.hotels.selectedId = input.hotels.selectedId;
  }
  const {normalizeProgress,assertProgress}=await import('../public/journey.mjs');
  if(!meta || typeof meta.source!=='string')throw Error('行程依据无效');
  const context = resolveTripContext(input.context);
  const days = input.days.map((d,i) => normalizeDay({ date:d.date,start:d.requestedWindow?.start,end:d.requestedWindow?.end,restMinutes:d.restMinutes,lodging:d.lodging?.text }, {id:id(d.id),index:i+1,stopIds:[],legIds:[]}));
  unique(days.map(d=>d.id));
  const dated=days.filter(d=>d.date);if(dated.some((d,i)=>i && d.date<=dated[i-1].date))throw Error('日期顺序无效');
  const evidence=[];
  const stops=input.stops.map(s=>{
    const proof=verify(s.placeProof), stopId=id(s.id);
    if (!days.some(d=>d.id===s.dayId)) throw Error('地点所属日期无效');
    // Client locations, provider statements, URLs and schedule results are discarded.
    const evidenceIds=proof.evidence.map((e,i)=>{const eid=id(s.evidenceIds?.[i]);evidence.push({...e,id:eid,subjectId:stopId});return eid;});
    return {...proof.facts,id:stopId,dayId:s.dayId,visit:normalizeVisit(s.visit || {}),locked:s.locked===true,evidenceIds,placeProof:s.placeProof,...(s.progress?.completed?{progress:normalizeProgress(s.progress)}:{})};
  });
  unique(stops.map(s=>s.id));unique(evidence.map(e=>e.id));
  assertProgress({stops});
  const ordered=days.flatMap(d=>stops.filter(s=>s.dayId===d.id));
  if(ordered.some((s,i)=>s.id!==stops[i].id))throw Error('地点必须按天排列');
  const legs=input.legs.map((l,i)=>{
    if(l.fromStopId!==stops[i].id || l.toStopId!==stops[i+1].id || l.dayId!==stops[i+1].dayId)throw Error('路段连接无效');
    const mode=resolveTripContext({transportMode:l.preferredMode}).transportMode;
    const booking=normalizeBooking(l.booking);
    return {id:id(l.id),fromStopId:stops[i].id,toStopId:stops[i+1].id,dayId:stops[i+1].dayId,fromDayId:stops[i].dayId,kind:stops[i].dayId===stops[i+1].dayId?'local':'interday',preferredMode:mode,booking,status:booking?'scheduled':'unknown',mode:booking?'transit':null,source:booking?'user':null,durationMinutes:booking?.durationMinutes ?? null,distanceMeters:null,geometry:null,retrievedAt:null,evidenceIds:[]};
  });unique(legs.map(l=>l.id));
  if(!Number.isSafeInteger(input.revision?.number) || input.revision.number<1)throw Error('修订号无效');
  const real=evidence.filter(e=>e.field==='location').filter(e=>e.status==='matched').length;
  const route={...meta,schemaVersion:1,id:id(input.id),planProof:input.planProof,city:[...new Set(stops.map(s=>s.city))].join(' · '),poiSource:real===stops.length?'ctrip':real?'mixed':'mock',context,days,stops,legs,evidence,planning:{notices:[]},revision:{number:input.revision.number}};
  for(const d of days){d.stopIds=stops.filter(s=>s.dayId===d.id).map(s=>s.id);d.legIds=legs.filter(l=>l.dayId===d.id).map(l=>l.id);}
  return reconcile(route,structuredClone(route));
}
module.exports={sealRoute,sealPoi,validateCurrent};
