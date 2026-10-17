import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EditSession } from '../public/itinerary-editor.mjs';
import { createPortable, parsePortable } from '../public/portable-route.mjs';
import { renderRoadbook } from '../public/roadbook.mjs';
const require=createRequire(import.meta.url), fixture=require('./fixtures/w10-route.cjs');
const {sealRoute,validateCurrent}=require('../lib/conversation-route');
const {matchGuide,enrichPlaceGuides}=require('../lib/place-guide');
function hotelsRoute(){
  const route=fixture();
  route.hotels={status:'ready',queriedAt:'2026-10-17T02:00:00Z',request:{city:'上海'},candidates:[
    {id:'hotel-a',name:'携程返回的酒店甲',city:'上海',address:'测试地址甲',location:{lat:31.2,lng:121.4},source:'ctrip-mcp',detailUrl:'https://hotels.ctrip.com/hotels/1.html',price:{amount:580,currency:'CNY',unit:'/晚'},private:'SECRET'},
    {id:'hotel-b',name:'携程返回的酒店乙',city:'上海',address:'测试地址乙',source:'ctrip-mcp',detailUrl:'https://hotels.ctrip.com/hotels/2.html'}],selectedId:'hotel-a'};
  return sealRoute(route);
}
test('hotel choice commits and undoes without changing stops, protects signed facts across dialogue',async()=>{
  const session=new EditSession(hotelsRoute()), original=structuredClone(session.current);
  session.stage({type:'hotel',hotelId:'hotel-b'});
  const selected=await session.commit(async()=>assert.fail('hotel selection must not need fresh roads'),{allowIncomplete:true});
  assert.equal(selected.hotels.selectedId,'hotel-b');assert.deepEqual(selected.stops.map(s=>s.id),original.stops.map(s=>s.id));
  selected.hotels.candidates[0].name='伪造名称';selected.hotels.candidates[0].price.amount=1;
  const trusted=await validateCurrent(selected);
  assert.equal(trusted.hotels.selectedId,'hotel-b');assert.equal(trusted.hotels.candidates[0].name,original.hotels.candidates[0].name);assert.equal(trusted.hotels.candidates[0].price.amount,580);
  const invalid=structuredClone(selected);invalid.hotels.selectedId='forged-hotel';await assert.rejects(validateCurrent(invalid),/酒店/);
  assert.equal(session.undo().hotels.selectedId,'hotel-a');
});
test('hotel and web source info survive public JSON and illustrated HTML while private fields and checks stay out',()=>{
  const route=hotelsRoute();route.stops[0].guide={openingText:'周二-周日 09:00-17:00',source:'OpenStreetMap 社区资料',url:'https://www.openstreetmap.org/node/123',retrievedAt:'2026-10-17T02:00:00Z',secret:'SECRET'};
  const packet=createPortable(route), json=JSON.stringify(packet);
  assert.doesNotMatch(json,/SECRET|planProof|placeProof/);assert.deepEqual(parsePortable(json).route.hotels,packet.route.hotels);
  const html=renderRoadbook(packet), visible=html.replace(/<script[\s\S]*?<\/script>/g,'');
  for(const text of ['酒店选择','已选 · 携程返回的酒店甲','580 CNY/晚','周二-周日 09:00-17:00'])assert.ok(visible.includes(text),text);
  assert.doesNotMatch(visible,/本日约束检查|存在冲突|供应商更新/);
});
test('web opening reference needs the same name and nearby position, refuses conflicting hours',()=>{
  const stop={name:'上海博物馆',location:{lat:31.23,lng:121.47}}, retrievedAt='2026-10-17T02:00:00Z';
  const element={type:'node',id:123,lat:31.23,lon:121.47,tags:{name:'上海博物馆',opening_hours:'Tu-Su 09:00-17:00'}};
  const guide=matchGuide(stop,[element],retrievedAt);
  assert.equal(guide.openingText,'周二-周日 09:00-17:00');assert.equal(guide.retrievedAt,retrievedAt);assert.match(guide.url,/node\/123$/);
  assert.equal(matchGuide(stop,[{...element,tags:{...element.tags,name:'上海图书馆'}}],retrievedAt),null);
  assert.equal(matchGuide(stop,[{...element,lat:32}],retrievedAt),null);
  assert.equal(matchGuide(stop,[element,{...element,id:124,tags:{...element.tags,opening_hours:'24/7'}}],retrievedAt),null);
});
test('web source failure leaves the plan intact without synthetic hours',async()=>{
  const saved=globalThis.fetch;globalThis.fetch=async()=>{throw Error('upstream-secret');};
  try{const route=fixture(), before=structuredClone(route);await enrichPlaceGuides(route);assert.deepEqual(route,before);}finally{globalThis.fetch=saved;}
});
