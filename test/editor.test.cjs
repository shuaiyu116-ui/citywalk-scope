const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createItinerary, resolveTripContext } = require('../lib/itinerary');
const make = () => {
  const r = createItinerary({ city:'上海', stops:[0,1,2,3].map(i => ({poiId:`p${i}`,name:`地点${i}`,city:'上海',location:{lat:31+i*.01,lng:121}})) }, resolveTripContext({dailyStartTime:'09:00', dailyEndTime:'17:00'}));
  r.legs.forEach(l => Object.assign(l,{status:'routed',mode:'walking',durationMinutes:10,distanceMeters:600,geometry:{coordinates:[[31,121],[31.01,121]]}})); return r;
};
const road = async body => ({legs:body.legs.map(l => ({...l,status:'routed',mode:l.preferredMode,durationMinutes:15,distanceMeters:900}))});
test('draft edits preserve identities, reject locked/duplicate/invalid changes and replace facts', async () => {
  const {editRoute} = await import('../public/itinerary-editor.mjs'); const base=make(), original=structuredClone(base);
  const stay=editRoute(base,{type:'visit',stopId:base.stops[1].id,visit:{stayMinutes:50,restMinutes:5}});
  assert.deepEqual(base,original); assert.deepEqual(stay.legs,base.legs);
  const lock=editRoute(stay,{type:'lock',stopId:stay.stops[1].id});
  assert.throws(() => editRoute(lock,{type:'remove',stopId:lock.stops[1].id}),/解锁/);
  assert.throws(() => editRoute(stay,{type:'visit',stopId:stay.stops[0].id,visit:{stayMinutes:-1}}));
  const moved=editRoute(base,{type:'move',stopId:base.stops[0].id,offset:1});
  assert.equal(moved.legs[2].id,base.legs[2].id); assert.equal(moved.legs[0].status,'unknown'); assert.equal(moved.legs[0].geometry,null);
  const poi={id:'new',name:'新地点',city:'上海',source:'ctrip',provider:'fixture',location:{lat:31.4,lng:121},openingHours:{status:'unknown'},apiKey:'not-portable'};
  const replaced=editRoute(stay,{type:'replace',stopId:stay.stops[1].id,poi});
  assert.notEqual(replaced.stops[1].id,stay.stops[1].id); assert.deepEqual(replaced.stops[1].visit,{});
  assert.equal(replaced.legs[2].id,base.legs[2].id); assert.equal(replaced.evidence.some(e => e.subjectId === stay.stops[1].id),false);
  assert.equal(JSON.stringify(replaced).includes('not-portable'),false);
  assert.throws(() => editRoute(replaced,{type:'add',poi}),/已在/);
  const removed=editRoute(replaced,{type:'remove',stopId:replaced.stops[1].id}); assert.equal(removed.stops.length,3); assert.equal(removed.days[0].legIds.length,2);
});
test('atomic commit, partial road recompute, undo, failure recovery and late-response rejection', async () => {
  const {EditSession} = await import('../public/itinerary-editor.mjs'); const base=make(), session=new EditSession(base); let calls=0;
  session.stage({type:'visit',stopId:base.stops[0].id,visit:{stayMinutes:60}});
  const saved=await session.commit(async b => { calls++;return road(b);}); assert.equal(calls,0); assert.equal(saved.revision.number,2); assert.equal(saved.stops[0].schedule.stayMinutes,60);
  session.stage({type:'mode',legId:saved.legs[0].id,mode:'taxi'});
  const changed=await session.commit(async b => {assert.equal(b.legs.length,1);return road(b);}); assert.equal(changed.legs[1].id,base.legs[1].id);
  const undo=session.undo(); assert.equal(undo.legs[0].preferredMode,'walking'); assert.equal(undo.revision.number,4); assert.equal(undo.stops[0].visit.stayMinutes,60);
  session.stage({type:'mode',legId:undo.legs[0].id,mode:'cycling'});
  await assert.rejects(session.commit(async () => {throw new Error('offline');}),/offline/); assert.equal(session.current,undo); assert.ok(session.draft);
  await assert.rejects(session.commit(async b => ({legs:b.legs.map(l => ({...l,status:'unavailable',durationMinutes:null,distanceMeters:null}))})),/当前版本未改变/);
  assert.equal(session.current,undo);
  const accepted=await session.commit(road,{allowIncomplete:true}); assert.equal(accepted.legs[0].durationMinutes,null); assert.equal(accepted.stops[1].schedule.arrival,null);
  session.stage({type:'mode',legId:accepted.legs[0].id,mode:'taxi'});
  let release; const work=session.commit(body => new Promise(resolve => {release=() => resolve(road(body));}));
  session.stage({type:'lock',stopId:accepted.stops[0].id}); release(); assert.equal(await work,null); assert.equal(session.current,accepted); assert.equal(session.draft.stops[0].locked,true);
  session.discard(); assert.equal(session.draft,null);
  session.stage({type:'mode',legId:accepted.legs[0].id,mode:'transit'});
  const unknown=await session.commit(road,{allowIncomplete:true}); assert.equal(unknown.planning.transportStatus,'incomplete'); assert.equal(unknown.stops[1].schedule.arrival,null);
});
test('mixed routing dependency invalidates a changed day but timing edits reuse estimates', async () => {
  const {EditSession,editRoute}=await import('../public/itinerary-editor.mjs'); const r=make(); r.context.transportMode='mixed';r.legs.forEach(l => l.preferredMode='mixed');
  const moved=editRoute(r,{type:'move',stopId:r.stops[0].id,offset:1}); assert.ok(moved.legs.every(l => l.status==='unknown'));
  const mode=editRoute(r,{type:'mode',legId:r.legs[0].id,mode:'driving'}); assert.ok(mode.legs.every(l => l.status==='unknown'));
  r.legs[0].status='estimated'; const s=new EditSession(r);s.stage({type:'visit',stopId:r.stops[0].id,visit:{stayMinutes:15}});
  await s.commit(() => assert.fail('unchanged estimate must not refetch')); assert.equal(s.current.legs[0].status,'estimated');
});
test('HTTP identity search handles ambiguity, wrong city, address, unavailable and real local editing pipeline', async t => {
  const child=spawn(process.execPath,['--require','./test/fixtures/w05-offline.cjs','server.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});t.after(() => child.kill());
  const base=await new Promise((resolve,reject) => {const timer=setTimeout(() => reject(Error('startup timeout')),10000);child.once('error',reject);child.stdout.on('data',b => {const m=b.toString().match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(`http://localhost:${m[1]}`);}});});
  const post=async(path,body) => {const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  assert.equal((await post('/api/places/search',{name:'同名园'})).status,400);
  const ambiguous=await post('/api/places/search',{name:'同名园',city:'上海'});assert.equal(ambiguous.body.status,'ambiguous');assert.equal(ambiguous.body.candidates.length,2);
  const wrongCity=(await post('/api/places/search',{name:'同名园',city:'南京'})).body; assert.equal(wrongCity.status,'not_found'); assert.equal(wrongCity.candidates.length,0); // MCP adapter already removes other cities.
  const selected=await post('/api/places/search',{name:'同名园',city:'上海',addressHint:'西路100号'});assert.equal(selected.body.candidates.length,1);
  assert.equal((await post('/api/places/search',{name:'失败地点',city:'上海'})).status,502);
  const r=(await (await fetch(base+'/api/demo-route?city=上海')).json()).route;
  const {EditSession}=await import('../public/itinerary-editor.mjs'); const s=new EditSession(r);s.stage({type:'replace',stopId:r.stops[1].id,poi:selected.body.candidates[0]});
  const saved=await s.commit(async request => (await post('/api/transport-route',request)).body);
  assert.equal(saved.stops[1].name,'同名园'); assert.ok(saved.legs.every(l => l.status==='routed')); assert.equal(saved.revision.number,2);
});
