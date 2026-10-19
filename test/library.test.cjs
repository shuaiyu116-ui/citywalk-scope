const test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('./fixtures/w10-route.cjs');
const {recheckLocal}=require('../lib/library-restore');
const {validateCurrent}=require('../lib/conversation-route');
async function prepared(){const route=fixture();const {applySchedule}=await import('../public/schedule.mjs');const {normalizeProgress}=await import('../public/journey.mjs');applySchedule(route);route.stops[0].progress=normalizeProgress({completed:true,schedule:route.stops[0].schedule});return route;}
async function intent(route){const {copyIntent}=await import('../public/share.mjs');const b=copyIntent(route);b.context=route.context;b.days.forEach((d,i)=>d.lodging=route.days[i].lodging?.text);b.stops.forEach((s,i)=>{s.visit=route.stops[i].visit;s.progress=route.stops[i].progress;s.addressHint='';});b.bookings=route.legs.map(l=>l.booking||null);return b;}
test('library preserves complete personal snapshots/history and sanitizes backups without importing proof or replacing identities',async()=>{
 const {appendVersion,localRoute,backupText,parseBackup}=await import('../public/library.mjs');const {createPortable}=await import('../public/portable-route.mjs');const {EditSession}=await import('../public/itinerary-editor.mjs');
 const r=await prepared();r.planProof='PRIVATE-PROOF';r.apiKey='PRIVATE-KEY';r.profile={items:[{value:'PRIVATE-DEVICE-PROFILE'}]};r.stops[0].placeProof='PRIVATE-PROOF';
 let saved=appendVersion(null,'我的旅行',r);const first=saved.versions[0], original=createPortable(r).route;
 r.title='changed';saved=appendVersion(saved,saved.name,r);assert.equal(first.packet.route.title,original.title);
 const recovered=localRoute(first.packet);delete recovered.restoration;assert.deepEqual(recovered,original);
 const text=backupText([saved]);assert.ok(!text.includes('PRIVATE'));const imported=parseBackup(text);assert.notEqual(imported[0].id,saved.id);assert.deepEqual(imported[0].versions.map(v=>v.packet.route),saved.versions.map(v=>v.packet.route));
 for(let i=0;i<22;i++)saved=appendVersion(saved,saved.name,r);assert.equal(saved.versions.length,20);
 assert.throws(()=>parseBackup('{"format":"citywalk-library","version":2,"records":[]}'));
 assert.throws(()=>parseBackup('{broken'));assert.throws(()=>parseBackup(JSON.stringify({format:'citywalk-library',version:1,records:[{schemaVersion:2}]})));
 const restored=localRoute(first.packet);assert.equal(restored.restoration.status,'unverified-local');await assert.rejects(validateCurrent(restored));
 const session=new EditSession(r);session.restoreSnapshot(restored);assert.deepEqual(session.current.stops,restored.stops);assert.deepEqual(session.current.legs,restored.legs);assert.equal(session.undo().title,'changed');
 session.stage({type:'lock',stopId:r.stops[1].id});assert.throws(()=>session.restoreSnapshot(restored),/草稿/);
});
test('local recheck keeps personal constraints/history but signs only newly queried facts; atomic failure/cancel',async()=>{
 const r=await prepared(),b=await intent(r);b.stops[0].location={lat:0,lng:0};b.stops[0].detailUrl='https://forged.test';b.stops[0].placeProof='forged';
 const search=async t=>({source:'ctrip',pois:[{id:'fresh-'+t.query,name:t.query,city:t.city,location:{lat:32,lng:120},detailUrl:'https://fresh.test',openingHours:{status:'unknown',source:'fixture'}}]});
 const out=await recheckLocal(b,{search});const normalized=await validateCurrent(out);
 assert.equal(out.source,'local-rechecked');assert.notEqual(out.id,r.id);assert.deepEqual(out.context.companions,r.context.companions);assert.equal(out.days[2].lodging.text,r.days[2].lodging.text);
 assert.deepEqual(out.stops[0].progress,r.stops[0].progress);assert.equal(out.stops[0].visit.openingRules.note,r.stops[0].visit.openingRules.note);assert.equal(out.legs[1].booking.label,r.legs[1].booking.label);
 assert.deepEqual(normalized.stops[0].location,{lat:32,lng:120});assert.equal(normalized.stops[0].detailUrl,'https://fresh.test/');assert.ok(!JSON.stringify(out).includes('forged.test'));assert.equal(out.legs[0].geometry,null);
 await assert.rejects(recheckLocal(b,{search:async()=>({source:'ctrip',pois:[]})}),e=>e.status===422);
 await assert.rejects(recheckLocal(b,{search:async()=>({source:'mock',pois:[]})}),e=>e.status===503);
 const c=new AbortController();c.abort();await assert.rejects(recheckLocal(b,{search,signal:c.signal}),e=>e.status===408);
});
test('HTTP local recheck passes fresh signatures to multi-turn and rejects unavailable services',async t=>{
 const {spawn}=require('node:child_process');const child=spawn(process.execPath,['--require','./test/fixtures/w11-offline.cjs','server.js'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup')),10000);child.once('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://localhost:'+m[1]);}});});
 const original=(await(await fetch(base+'/api/demo-route')).json()).route,b=await intent(original);
 const response=await fetch(base+'/api/library/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});assert.equal(response.status,200);const {route}=await response.json();assert.ok(route.planProof);
 const res=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'第一站停留20分钟',conversation:{mode:'edit'},currentRoute:route})});assert.equal(res.status,200);const events=(await res.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'result');assert.equal(events.at(-1).result.route.stops[0].visit.stayMinutes,20);
 b.stops[0].name='故障地点';const fail=await fetch(base+'/api/library/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});assert.equal(fail.status,502);assert.ok(!(await fail.text()).includes('confidential'));
});

