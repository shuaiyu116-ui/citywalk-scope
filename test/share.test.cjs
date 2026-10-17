const test = require('node:test'), assert = require('node:assert/strict');
const fixture = require('./fixtures/w10-route.cjs');
const { copySharedRoute } = require('../lib/share-copy');
const { sealRoute, validateCurrent } = require('../lib/conversation-route');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const hash = raw => {const z=gzipSync(Buffer.from(raw)); return '#cw1='+createHash('sha256').update(z).digest('hex')+'.'+z.toString('base64url');};

test('share freezes full public version without storage/keys/proofs and refuses corruption, expiry and oversized streams', async () => {
  const {makeShareLink,readShare}=await import('../public/share.mjs');
  const {createPortable}=await import('../public/portable-route.mjs');
  const route=fixture(), original=structuredClone(route);route.apiKey='SECRET';route.preferences={private:'PROFILE'};route.planProof='SIGNATURE';route.stops[0].placeProof='SIGNATURE';route.context.gps={lat:0};
  const now=Date.parse('2026-10-16T00:00:00Z');
  const result=await makeShareLink(route,'https://example.org/?key=must-not-copy',{now,days:7});
  assert.equal(new URL(result.url).pathname,'/share.html');assert.equal(new URL(result.url).search,'');
  route.stops[0].name='changed';
  const decoded=await readShare(new URL(result.url).hash,{now});
  assert.deepEqual(decoded.packet.route,createPortable(original).route);
  for(const secret of ['SECRET','PROFILE','SIGNATURE','gps'])assert.ok(!JSON.stringify(decoded).includes(secret));
  assert.equal(decoded.packet.exportedAt,new Date(now).toISOString());
  await assert.rejects(readShare('',{now}),e=>e.code==='missing');
  await assert.rejects(readShare(new URL(result.url).hash.slice(0,-3),{now}),e=>e.code==='damaged');
  await assert.rejects(readShare(new URL(result.url).hash,{now:now+7*86400000}),e=>e.code==='expired');
  await assert.rejects(readShare(hash(' '.repeat(600000)),{now}),e=>e.code==='large');
  const invalid=createPortable(original);invalid.route.legs[0].toStopId='missing';
  await assert.rejects(readShare(hash(JSON.stringify({version:1,expiresAt:null,packet:invalid})),{now}),e=>e.code==='damaged');
  const large=fixture();large.legs[0].geometry={coordinates:Array.from({length:20000},()=>[Math.random(),Math.random()])};
  await assert.rejects(makeShareLink(large,'https://example.org'),e=>e.code==='large');
});

test('copy rechecks all places, remaps every identity and preserves only requested schedule constraints; fresh proofs work with multi-turn', async () => {
  const {copyIntent}=await import('../public/share.mjs');const {EditSession}=await import('../public/itinerary-editor.mjs');
  const original=fixture(), intent=copyIntent(original);intent.planProof='FORGED';intent.context.companions=['seniors'];intent.stops[0].location={lat:0,lng:0};intent.stops[0].openingHours={status:'verified'};intent.stops[0].progress={completed:true};intent.stops[0].openingRules={periods:[{start:'00:00',end:'23:59'}]};intent.days[0].lodging='PRIVATE';
  const search=async target=>({source:'ctrip',provider:'fixture',pois:[{id:'fresh-'+target.query,name:target.query,city:target.city,address:'fresh address',location:{lat:32,lng:120}}]});
  intent.stops.forEach(s=>s.addressHint='');
  const route=await copySharedRoute(intent,{search});
  const {renderRoadbook}=await import('../public/roadbook.mjs');assert.ok(renderRoadbook(route).includes('分享的新副本，地点在复制时重新查询，未调用 AI 重新规划'));
  assert.equal(route.source,'shared-copy');assert.equal(route.revision.number,1);assert.notEqual(route.id,original.id);assert.equal(route.days[1].stopIds.length,0);
  const oldIds=new Set([original.id,...original.days.map(x=>x.id),...original.stops.map(x=>x.id),...original.legs.map(x=>x.id),...original.evidence.map(x=>x.id)]);
  for(const x of [...route.days,...route.stops,...route.legs,...route.evidence])assert.ok(!oldIds.has(x.id));
  assert.deepEqual(route.stops.map(s=>s.name),original.stops.map(s=>s.name));assert.deepEqual(route.stops[0].location,{lat:32,lng:120});assert.equal(route.stops[0].visit.stayMinutes,20);
  assert.deepEqual(route.context.companions,[]);assert.ok(route.stops.every(s=>!s.progress&&!s.visit.openingRules));assert.ok(route.days.every(d=>!d.lodging.text));assert.ok(route.legs.every(l=>l.status==='unknown'&&!l.booking&&!l.geometry));assert.ok(route.evidence.every(e=>e.status!=='verified'));
  await assert.rejects(validateCurrent(route));const signed=sealRoute(route);const normalized=await validateCurrent(signed);assert.equal(normalized.source,'shared-copy');assert.deepEqual(normalized.stops[0].location,{lat:32,lng:120});
  const session=new EditSession(original);session.draft=route;const accepted=await session.commit(()=>{throw Error('unexpected');},{allowIncomplete:true});accepted.revision={number:1};assert.equal(session.undo().revision.number,5);assert.equal(session.current.id,original.id);
});

test('copy rejects invalid/ambiguous/missing/unavailable inputs atomically and observes cancellation', async () => {
  const {copyIntent}=await import('../public/share.mjs');const intent=copyIntent(fixture());
  await assert.rejects(copySharedRoute({...intent,stops:[{}]},{search:()=>{throw Error('must not query');}}),e=>e.status===400);
  await assert.rejects(copySharedRoute(intent,{search:async()=>({source:'mock',pois:[]})}),e=>e.status===503);
  await assert.rejects(copySharedRoute(intent,{search:async()=>({source:'ctrip',pois:[]})}),e=>e.status===422);
  await assert.rejects(copySharedRoute(intent,{search:async target=>({source:'ctrip',pois:[1,2].map(id=>({id:String(id),name:target.query,city:target.city,location:{lat:32,lng:120}}))})}),e=>e.status===422);
  const c=new AbortController();c.abort();let calls=0;await assert.rejects(copySharedRoute(intent,{signal:c.signal,search:()=>{calls++;}}),e=>e.status===408);assert.equal(calls,0);
});

test('HTTP copy returns fresh server signatures and can continue editing; unavailable services never become demo copies',async t=>{
  const {spawn}=require('node:child_process');const child=spawn(process.execPath,['--require','./test/fixtures/w11-offline.cjs','server.js'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup')),10000);child.once('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://localhost:'+m[1]);}});});
  const {copyIntent}=await import('../public/share.mjs');const original=(await(await fetch(base+'/api/demo-route')).json()).route;
  const request=copyIntent(original),post=body=>fetch(base+'/api/share/copy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let res=await post(request);assert.equal(res.status,200);const {route}=await res.json();assert.ok(route.planProof);assert.ok(route.stops.every(s=>s.placeProof));assert.notEqual(route.id,original.id);
  res=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'第一站停留20分钟',conversation:{mode:'edit'},currentRoute:route})});assert.equal(res.status,200);const events=(await res.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'result');assert.equal(events.at(-1).result.route.stops[0].visit.stayMinutes,20);
  request.stops[0].name='故障地点';res=await post(request);assert.equal(res.status,502);const fail=await res.text();assert.ok(!fail.includes('confidential'));assert.ok(!fail.includes('planProof'));
  request.stops[0].name='不存在';res=await post(request);assert.equal(res.status,422);
});

