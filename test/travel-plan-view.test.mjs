import test from 'node:test';
import assert from 'node:assert/strict';
import { travelStopPlan, travelSourceUrl, travelPhotoUrl } from '../public/schedule-view.mjs';

test('roadbook omits unavailable facts while preserving stop order and planned stay', () => {
  const route = {city:'杭州',evidence:[]};
  const stop = {id:'a',name:'西湖',note:'沿湖慢慢走',openingHours:{status:'unknown',text:'未知'},schedule:{arrival:null,stayMinutes:50}};
  const before = structuredClone(stop), plan = travelStopPlan(route, stop, 2);
  assert.equal(plan.time,'第 3 站'); assert.equal(plan.stay,50); assert.equal(plan.opening,'');
  assert.equal(plan.description,'沿湖慢慢走'); assert.match(new URL(plan.searchUrl).searchParams.get('wd'),/杭州 西湖 官方 营业时间 预约/);
  assert.deepEqual(stop,before);
});

test('web opening records retain provenance and Shanghai lookup date', () => {
  const stop = {id:'a',name:'博物馆',source:'ctrip',openingHours:{status:'reported',text:'旧开放说明',source:'ctrip'},guide:{openingText:'Tu-Su 09:00-17:00',source:'OpenStreetMap 社区资料',url:'https://www.openstreetmap.org/way/123',retrievedAt:'2026-10-16T18:00:00Z'},schedule:{visitStart:{time:'09:30',dayOffset:0},visitEnd:{time:'10:30',dayOffset:0},stayMinutes:60}};
  const plan = travelStopPlan({city:'上海'},stop,0);
  assert.equal(plan.opening,'Tu-Su 09:00-17:00'); assert.equal(plan.openingSource,'OpenStreetMap 社区资料');
  assert.match(plan.openingDate,/2026.*10.*17/); assert.equal(plan.openingUrl,'https://www.openstreetmap.org/way/123');
  assert.equal(plan.time,'09:30–10:30'); assert.equal(plan.source,'携程地点');
});

test('completed stops retain saved plan time and user hours remain attributed', () => {
  const stop = {name:'园林',id:'a',visit:{openingRules:{periods:[{start:'08:00',end:'16:00'}]}},progress:{completed:true,schedule:{arrival:{time:'10:00',dayOffset:0},stayMinutes:40}},schedule:{arrival:{time:'15:00',dayOffset:0},stayMinutes:15}};
  const plan = travelStopPlan({city:'苏州'},stop,0);
  assert.equal(plan.time,'10:00'); assert.equal(plan.stay,40); assert.equal(plan.opening,'08:00–16:00'); assert.equal(plan.openingSource,'用户提供');
});

test('source links reject active or credential URLs and Baidu photos use same origin proxy', () => {
  assert.equal(travelSourceUrl('javascript:alert(1)'),null); assert.equal(travelSourceUrl('https://name:secret@example.com/'),null);
  assert.equal(travelPhotoUrl('data:image/svg+xml,evil'),null); assert.equal(travelPhotoUrl('/assets/walk.jpg'),'/assets/walk.jpg');
  assert.match(travelPhotoUrl('https://img1.baidu.com/it/u=12'),/^\/api\/location-photo\/image\?url=/);
});
