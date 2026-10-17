const test=require('node:test'),assert=require('node:assert/strict');
const {createItinerary,resolveTripContext}=require('../lib/itinerary');
const {sealRoute,sealPoi,validateCurrent}=require('../lib/conversation-route');
const make=()=>sealRoute(createItinerary({city:'上海',stops:[0,1,2,3].map(i=>({name:'地点'+i,city:'上海',location:{lat:31.2+i*.01,lng:121.4},visit:{stayMinutes:30}}))},resolveTripContext({dayCount:1,startDate:'2026-10-17',dailyStartTime:'09:00',dailyEndTime:'18:00',transportMode:'walking'})));
const poi=()=>sealPoi({id:'nearby-new',name:'附近真实测试点',city:'上海',source:'ctrip',provider:'fixture',location:{lat:31.211,lng:121.4},openingHours:{status:'unknown'}});
async function setup(){const edit=await import('../public/itinerary-editor.mjs'),schedule=await import('../public/schedule.mjs');const r=make();for(const leg of r.legs)Object.assign(leg,{status:'routed',mode:'walking',durationMinutes:10,distanceMeters:600});schedule.applySchedule(r);return {...edit,...schedule,route:r};}
test('navigation projects WGS84 exactly once, reverses explicit GCJ02 and escapes link labels',async()=>{
  const {amapLink,positionWgs84}=await import('../public/navigation.mjs');const {wgs84ToGcj02}=require('../lib/ctrip-mcp');
  const p={lat:31.23,lng:121.47},q=wgs84ToGcj02(p),name='a,<script>&to=0,0';
  const u=new URL(amapLink({name,location:p},{name:'出发',location:p},'taxi'));
  assert.equal(u.hostname,'uri.amap.com');assert.equal(u.searchParams.get('coordinate'),'gaode');assert.equal(u.searchParams.get('mode'),'car');
  const to=u.searchParams.get('to').split(',');assert.ok(Math.abs(Number(to[0])-q.lng)<.000001);assert.ok(Math.abs(Number(to[1])-q.lat)<.000001);assert.equal(u.searchParams.getAll('to').length,1);
  const back=positionWgs84(q,'gcj02');assert.ok(Math.abs(back.lat-p.lat)<1e-7);assert.ok(Math.abs(back.lng-p.lng)<1e-7);
  assert.deepEqual(positionWgs84(p),p);assert.throws(()=>positionWgs84({lat:NaN,lng:2}));assert.throws(()=>positionWgs84(p,'guess'));
});
test('visited prefix freezes past schedules and legs, nearby insertion preserves bookings and uses editor undo',async()=>{
  const {route,editRoute,EditSession,applySchedule}=await setup();
  assert.throws(()=>editRoute(route,{type:'visited',stopId:route.stops[1].id}),/顺序/);
  let r=editRoute(route,{type:'visited',stopId:route.stops[0].id});r=editRoute(r,{type:'visited',stopId:r.stops[1].id});
  const frozen=structuredClone(r.stops.slice(0,2)),pastLeg=structuredClone(r.legs[0]);
  for(const action of [{type:'remove',stopId:r.stops[0].id},{type:'visit',stopId:r.stops[0].id,visit:{stayMinutes:1}},{type:'move',stopId:r.stops[2].id,offset:-1},{type:'mode',legId:r.legs[0].id,mode:'cycling'},{type:'day',dayId:r.days[0].id,date:'2026-10-18',start:'09:00',end:'18:00'}])assert.throws(()=>editRoute(r,action),/已|保护/);
  r=editRoute(r,{type:'booking',legId:r.legs[2].id,booking:{departure:'2026-10-17T13:00',arrival:'2026-10-17T14:00',beforeMinutes:0,afterMinutes:0}});
  const booking=r.legs[2];const session=new EditSession(r);session.stage({type:'add-nearby',dayId:r.days[0].id,poi:poi()});
  assert.deepEqual(session.draft.stops.slice(0,2).map(s=>s.id),frozen.map(s=>s.id));assert.ok(session.draft.legs.some(l=>l.id===booking.id));
  let requested;await session.commit(async request=>{requested=request;return {legs:request.legs.map(l=>({...l,status:'routed',mode:'walking',durationMinutes:5,distanceMeters:300}))};});
  assert.ok(!requested.legs.some(l=>l.id===pastLeg.id));assert.deepEqual(session.current.legs[0],pastLeg);
  for(let i=0;i<2;i++)assert.deepEqual(session.current.stops[i].schedule,frozen[i].schedule);
  assert.equal(session.current.stops.length,5);assert.equal(session.current.stops[2].name,poi().name);assert.equal(session.current.stops[2].schedule.arrival.time,'10:15');
  const beforeUndo=session.current.revision.number;const undone=session.undo();assert.equal(undone.stops.length,4);assert.equal(undone.revision.number,beforeUndo+1);assert.ok(undone.stops[1].progress.completed);
  assert.throws(()=>editRoute(undone,{type:'visited',stopId:undone.stops[0].id}),/最后/);
  const unmarked=editRoute(undone,{type:'visited',stopId:undone.stops[1].id});assert.ok(!unmarked.stops[1].progress);applySchedule(unmarked);
  const repeated=editRoute(undone,{type:'repeat-stop',stopId:undone.stops[0].id,dayId:undone.days[0].id});assert.ok(!repeated.stops.at(-1).progress);
});
test('conversation preserves only normalized user history, rejects holes, and cannot rewrite completed visits',async()=>{
  const {route,editRoute}=await setup();let r=editRoute(route,{type:'visited',stopId:route.stops[0].id});
  r=editRoute(r,{type:'add-nearby',dayId:r.days[0].id,poi:poi()});r.stops[0].progress.secret='secret-key';r.stops[0].progress.schedule.checks=[{status:'pass',message:'malicious'}];
  const clean=await validateCurrent(r);assert.equal(clean.stops[0].progress.completed,true);assert.deepEqual(clean.stops[0].schedule.arrival,r.stops[0].schedule.arrival);assert.ok(!JSON.stringify(clean).includes('secret-key'));assert.ok(!JSON.stringify(clean).includes('malicious'));assert.equal(clean.stops[0].schedule.status,'unknown');
  const {applyConversationActions}=require('../lib/conversation');const run={check(){},call:async(_t,_l,fn)=>fn()};
  await assert.rejects(applyConversationActions(clean,[{type:'remove',stopId:clean.stops[0].id}],{run}),e=>e.code==='CLARIFY');
  const next=await applyConversationActions(clean,[{type:'visit',stopId:clean.stops.at(-1).id,stayMinutes:20}],{run});assert.deepEqual(next.route.stops[0].progress,clean.stops[0].progress);
  const invalid=structuredClone(clean);invalid.stops[1].progress=invalid.stops[0].progress;delete invalid.stops[0].progress;await assert.rejects(validateCurrent(invalid),/顺序/);
  const badTime=structuredClone(clean);badTime.stops[0].progress.schedule.departure.time='<script>';await assert.rejects(validateCurrent(badTime),/时间/);
});
