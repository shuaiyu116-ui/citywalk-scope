'use strict';
// One delivery-level chain against the extracted package. All upstream I/O is mocked.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const output=process.argv[3]&&path.resolve(process.argv[3]);
globalThis.crypto ||= require('node:crypto').webcrypto;
const mod=name=>import(pathToFileURL(path.join(root,'public',name+'.mjs')).href);
let child;
async function main(){
  assert.ok(!fs.existsSync(path.join(root,'.env')),'Never run release acceptance with a real .env');
  assert.ok(!fs.existsSync(path.join(root,'node_modules')),'Verify standalone vendor packaging');
  child=spawn(process.execPath,['--require','./test/fixtures/w11-offline.cjs','server.js'],{cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited before startup'));});
    child.stdout.on('data',b=>{const m=b.toString().match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://localhost:'+m[1]);}});
  });
  const get=async p=>{const res=await fetch(base+p);assert.equal(res.status,200,p);return res;};
  const post=async(p,b)=>{const res=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});assert.equal(res.status,200,p);return res;};
  // Delivery gap: verify shipped static dependencies (including offline shell), not old UI actions.
  const publicFiles=fs.readdirSync(path.join(root,'public')).filter(f=>/\.(?:html|css|mjs|js)$/.test(f));
  const vendorWalk=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?vendorWalk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  const vendorFiles=vendorWalk(path.join(root,'public/vendor')).filter(f=>/\.(?:js|css|png)$/.test(f)).map(f=>path.relative(path.join(root,'public/vendor'),f).replace(/\\/g,'/'));
  for(const file of [...publicFiles,...vendorFiles.map(f=>'vendor/'+f)]){
    const response=await get('/'+file);
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(path.join(root,'public',file))),file);
  }
  const original=(await(await get('/api/demo-route?city=上海')).json()).route;
  const {EditSession}=await mod('itinerary-editor');
  const {transportRequest,transportFingerprint,mergeTransport}=await mod('transport');
  const {applySchedule}=await mod('schedule');
  const {createPortable,parsePortable}=await mod('portable-route');
  const {makeShareLink,readShare,copyIntent}=await mod('share');
  const {appendVersion,backupText,parseBackup,localRoute}=await mod('library');
  const {renderRoadbook}=await mod('roadbook');
  const transport=async req=>(await(await post('/api/transport-route',req)).json());
  const fingerprint=transportFingerprint(original);
  assert.ok(mergeTransport(original,await transport(transportRequest(original)),fingerprint));applySchedule(original);
  const session=new EditSession(original);
  session.stage({type:'visit',stopId:original.stops[0].id,visit:{stayMinutes:35}});
  await session.commit(transport);
  assert.equal(session.current.stops[0].visit.stayMinutes,35);
  const committed=structuredClone(session.current);
  // Another unsaved edit must not enter any of the three delivery forms.
  session.stage({type:'visit',stopId:committed.stops[0].id,visit:{stayMinutes:55}});
  const route=session.current;route.apiKey='W14-PRIVATE-SENTINEL';route.planProof='W14-PRIVATE-SENTINEL';
  const packet=createPortable(route),html=renderRoadbook(route),link=await makeShareLink(route,base);
  assert.ok(!html.includes('W14-PRIVATE-SENTINEL'));
  assert.deepEqual(parsePortable(JSON.stringify(packet)).route,packet.route);
  const shared=await readShare(new URL(link.url).hash);
  assert.deepEqual(shared.packet.route,packet.route);assert.equal(packet.route.stops[0].visit.stayMinutes,35);
  const saved=appendVersion(null,'W14连续闭环',route);
  const restored=localRoute(parseBackup(backupText([saved]))[0].versions[0].packet);
  assert.equal(restored.restoration.status,'unverified-local');assert.equal(restored.id,committed.id);
  session.discard();session.restoreSnapshot(restored);
  const b=copyIntent(restored);b.context=restored.context;
  b.days.forEach((d,i)=>d.lodging=restored.days[i].lodging?.text);
  b.stops.forEach((s,i)=>{s.visit=restored.stops[i].visit;s.progress=restored.stops[i].progress;});
  b.bookings=restored.legs.map(l=>l.booking||null);
  const candidate=(await(await post('/api/library/recheck',b)).json()).route;
  assert.notEqual(candidate.id,restored.id);assert.equal(session.current.id,restored.id);
  session.restoreSnapshot(candidate);
  const result=await post('/api/agent-route',{prompt:'第一站停留20分钟',conversation:{mode:'edit'},currentRoute:session.current});
  const events=(await result.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).type,'result');const revised=events.at(-1).result.route;
  assert.equal(revised.stops[0].visit.stayMinutes,20);
  session.restoreSnapshot(revised);session.undo();session.undo();
  assert.equal(session.current.id,restored.id);assert.equal(session.current.stops[0].visit.stayMinutes,35);
  assert.equal((await readShare(new URL(link.url).hash)).packet.route.stops[0].visit.stayMinutes,35);
  const report={ok:true,node:process.version,scope:'Extracted package; no node_modules/.env; real local HTTP; all external providers mocked',
    staticFiles:publicFiles.length+vendorFiles.length,
    chain:['demo transport/schedule','edit commit','draft isolation','portable JSON + HTML + share same snapshot','library backup + full unverified restore','HTTP all-place recheck candidate','HTTP multi-turn from fresh proof','adopt and two undos restore saved identity','original share stays frozen'],
    notRun:['historical full suite','browser UI (W13 evidence reused)','real DeepSeek/Ctrip/Baidu/Valhalla','Docker/Render deployment','real mobile navigation']};
  if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{if(child)child.kill();});
