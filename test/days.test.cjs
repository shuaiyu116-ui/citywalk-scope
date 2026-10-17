const test=require('node:test');
const assert=require('node:assert/strict');
const {createItinerary,resolveTripContext}=require('../lib/itinerary');
const make=()=>createItinerary({city:'上海',stops:[0,1,2,3].map(i=>({poiId:'p'+i,name:'站'+i,city:i<2?'上海':'南京',location:{lat:i<2?31:32,lng:i<2?121:118}}))},resolveTripContext({dayCount:2,startDate:'2026-12-31',dailyStartTime:'09:00',dailyEndTime:'18:00',maxWalkKm:5}));
const roads=async body=>({legs:body.legs.map(l=>({...l,status:'routed',mode:'walking',durationMinutes:10,distanceMeters:500}))});
const booking={departure:'2026-12-31T23:00',arrival:'2027-01-01T10:00',beforeMinutes:30,afterMinutes:60,label:'用户车次'};

test('initial days, cross-day links, moves, endpoints, empty days and undo keep stable identities',async()=>{
 const {editRoute,EditSession}=await import('../public/itinerary-editor.mjs');const r=make();
 assert.deepEqual(r.days.map(d=>d.stopIds.length),[2,2]);assert.equal(r.legs.length,3);assert.equal(r.legs[1].kind,'interday');assert.equal(r.legs[1].dayId,r.days[1].id);
 let moved=editRoute(r,{type:'assign-day',stopId:r.stops[1].id,dayId:r.days[1].id});
 assert.deepEqual(moved.days.map(d=>d.stopIds.length),[1,3]);assert.equal(new Set(moved.stops.map(s=>s.id)).size,4);assert.equal(moved.legs.length,3);
 moved=editRoute(moved,{type:'endpoint',stopId:r.stops[1].id,dayId:r.days[1].id,position:'start'});assert.equal(moved.days[1].stopIds[0],r.stops[1].id);
 assert.throws(()=>editRoute(moved,{type:'remove-day',dayId:r.days[0].id}),/空白/);
 const s=new EditSession(r);s.stage({type:'add-day'});const added=await s.commit(roads);assert.equal(added.days[2].date,'2027-01-02');
 s.stage({type:'remove-day',dayId:added.days[2].id});await s.commit(roads);assert.equal(s.undo().days.length,3);assert.equal(s.current.revision.number,4);
 assert.deepEqual(s.current.stops.map(s=>s.id),r.stops.map(s=>s.id));
 const repeated=editRoute(r,{type:'repeat-stop',stopId:r.stops[0].id,dayId:r.days[1].id});
 assert.equal(repeated.stops.at(-1).poiId,r.stops[0].poiId);assert.notEqual(repeated.stops.at(-1).id,r.stops[0].id);
 assert.deepEqual(repeated.stops.at(-1).visit,{});assert.ok(repeated.stops.at(-1).evidenceIds.every(id=>repeated.evidence.some(e=>e.id===id && e.subjectId===repeated.stops.at(-1).id)));
});
test('overnight booking anchors next day, includes buffers/rest, budgets and missed connections',async()=>{
 const {editRoute}=await import('../public/itinerary-editor.mjs');const {applySchedule}=await import('../public/schedule.mjs');
 let r=make();r.legs.forEach(l=>Object.assign(l,{status:'routed',mode:'walking',durationMinutes:10,distanceMeters:500}));
 r=editRoute(r,{type:'booking',legId:r.legs[1].id,booking});r.days[1].restMinutes=20;applySchedule(r);
 assert.equal(r.stops[2].schedule.arrival.time,'11:20');assert.equal(r.stops[2].schedule.arrival.date,'2027-01-01');
 assert.equal(r.days[1].schedule.end.time,'12:30');assert.equal(r.days[1].schedule.remainingMinutes,330);assert.equal(r.days[1].schedule.playBudgetMinutes,390);
 assert.equal(r.legs[1].durationMinutes,660);assert.equal(r.legs[1].geometry,null);assert.equal(r.days[1].schedule.status,'unknown');
 let missed=editRoute(r,{type:'booking',legId:r.legs[1].id,booking:{...booking,departure:'2026-12-31T09:00'}});
 assert.ok(missed.days[1].schedule.checks.some(c=>c.code==='connection' && c.status==='conflict'));
 let unknown=editRoute(r,{type:'booking',legId:r.legs[1].id,booking:{...booking,afterMinutes:''}});
 assert.equal(unknown.stops[2].schedule.arrival,null);assert.equal(unknown.days[1].schedule.remainingMinutes,null);
 r=editRoute(r,{type:'booking',legId:r.legs[1].id,booking:null});assert.equal(r.stops[2].schedule.arrival,null);
});
test('bookings survive road refresh and edits, invalid dates reject atomically, local bookings count waiting',async()=>{
 const {editRoute,EditSession}=await import('../public/itinerary-editor.mjs');const {transportRequest,transportFingerprint,mergeTransport}=await import('../public/transport.mjs');
 let r=make();Object.assign(r.legs[1],{routingStatus:'success',routingSource:'valhalla',estimate:{speedKmh:25},attemptedAt:'old-query'});
 r=editRoute(r,{type:'booking',legId:r.legs[1].id,booking});
 assert.equal(r.legs[1].routingStatus,undefined);assert.equal(r.legs[1].estimate,undefined);assert.equal(r.legs[1].attemptedAt,undefined);
 const request=transportRequest(r);assert.equal(request.legs.length,2);assert.equal(JSON.stringify(request).includes('用户车次'),false);
 assert.ok(mergeTransport(r,await roads(request),transportFingerprint(r)));assert.equal(r.legs[1].status,'scheduled');
 const s=new EditSession(r);s.stage({type:'visit',stopId:r.stops[2].id,visit:{stayMinutes:45}});await s.commit(()=>assert.fail('unchanged roads'));assert.equal(s.current.legs[1].booking.departure,booking.departure);
 const saved=s.current;assert.throws(()=>s.stage({type:'day',dayId:r.days[1].id,date:'2026-02-30',start:'09:00',end:'18:00'}),/日期/);assert.equal(s.current,saved);
 assert.throws(()=>editRoute(r,{type:'booking',legId:r.legs[1].id,booking:{...booking,arrival:'2026-01-01T10:00'}}),/晚于/);
 assert.throws(()=>editRoute(r,{type:'day',dayId:r.days[1].id,date:'2026-12-30',start:'09:00',end:'18:00'}),/递增/);
 r=editRoute(r,{type:'booking',legId:r.legs[0].id,booking:{departure:'2026-12-31T10:00',arrival:'2026-12-31T10:30',beforeMinutes:10,afterMinutes:15}});
 assert.equal(r.stops[1].schedule.arrival.time,'10:45');assert.equal(r.days[0].schedule.knownWaitMinutes,20);
 const fp=transportFingerprint(r);r.legs[0].booking.afterMinutes=20;assert.equal(mergeTransport(r,await roads(transportRequest(r)),fp),false);
});
test('actual local HTTP retains cross-city unknowns and round-trips split-day generation and booked schedules',async t=>{
 const {spawn}=require('node:child_process');const child=spawn(process.execPath,['--require','./test/fixtures/w05-offline.cjs','server.js'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup')),10000);child.once('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://localhost:'+m[1]);}});});
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 const generated=await post('/api/generate-route',{prompt:'上海两日游',context:{dayCount:2}});assert.deepEqual(generated.route.days.map(d=>d.stopIds.length),[2,2]);
 const {EditSession}=await import('../public/itinerary-editor.mjs');const {transportRequest,mergeTransport,transportFingerprint}=await import('../public/transport.mjs');const r=make();
 const result=await post('/api/transport-route',transportRequest(r));assert.equal(result.legs[1].status,'unavailable');mergeTransport(r,result,transportFingerprint(r));
 const s=new EditSession(r);s.stage({type:'booking',legId:r.legs[1].id,booking});const final=await s.commit(body=>post('/api/transport-route',body));
 assert.equal(final.stops[2].schedule.arrival.time,'11:00');assert.equal(final.revision.number,2);assert.equal(final.days[1].schedule.status,'unknown');
});
