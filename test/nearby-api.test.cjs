const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeNearbyInput, discoverNearby, NearbyInputError, NearbyUnavailableError } = require('../lib/nearby');
const { searchNearbyMcpPois, wgs84ToGcj02 } = require('../lib/ctrip-mcp');
const { createItinerary } = require('../lib/itinerary');
const { sealRoute, validateCurrent } = require('../lib/conversation-route');
const input = { city: '上海', origin: { lat: 31.206, lng: 121.434 }, radiusKm: 2, mode: 'walking' };
const product = (id, point, city='上海') => ({ basicInfo: { name: `真实适配测试${id}`, cityName: city, available: true }, additionalInfo: { poiId: id, coordinate: point } });
const reply = products => async (url, options) => { const body = JSON.parse(options.body); return new Response(JSON.stringify({ id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(products) }] } })); };

test('nearby validates WGS84 input and directly anchors MCP query with explicit coordinate conversion/radius', async () => {
  assert.deepEqual(normalizeNearbyInput({ city:'上海市', origin:input.origin }), input);
  for (const patch of [{origin:{lat:'31',lng:121}}, {origin:{lat:91,lng:121}}, {origin:{lat:0,lng:0}}, {radiusKm:0}, {radiusKm:9}, {mode:'mixed'}, {city:''}]) assert.throws(() => normalizeNearbyInput({...input,...patch}), NearbyInputError);
  let calls=0;
  const projected=wgs84ToGcj02(input.origin);
  const products = Array.from({length:9},(_,i)=>product(i+1,wgs84ToGcj02({lat:input.origin.lat+i*.001,lng:input.origin.lng})));
  products.push(product('far',wgs84ToGcj02({lat:32,lng:121})),product('wrong-city',projected,'北京'),product(1,projected),product('invalid',{lat:null,lng:121}));
  const result=await searchNearbyMcpPois(input,{token:'test',coordinateSystem:'gcj02',fetchImpl:async(url, options)=>{
    calls++; const args=JSON.parse(options.body).params.arguments; assert.equal(args.latitude,projected.lat);assert.equal(args.longitude,projected.lng);assert.ok(!args.scenicSpotName);
    return reply(products)(url,options);
  }});
  assert.equal(calls,1);assert.equal(result.pois.length,6);assert.equal(result.pois[0].straightLineMeters,0);assert.ok(Math.abs(result.pois[0].location.lat-input.origin.lat)<1e-7);
  assert.ok(result.pois.every(p=>p.source==='ctrip' && p.provider==='ctrip-mcp' && p.straightLineMeters<=2000));
});

test('nearby missing/upstream/empty states never mock; road failure is explicit and signed POIs survive editing', async () => {
  await assert.rejects(discoverNearby(input,{token:''}),NearbyUnavailableError);
  await assert.rejects(discoverNearby(input,{token:'private-token',fetchImpl:async()=>{throw Error('private-token');}}),e=>!e.message.includes('private-token'));
  const empty=await discoverNearby(input,{token:'test',coordinateSystem:'wgs84',fetchImpl:reply([])});assert.deepEqual(empty.pois,[]);assert.equal(empty.source,'ctrip');
  const options={token:'test',coordinateSystem:'wgs84',fetchImpl:async(url, options)=>{
    if(String(url).includes('faas/mcp'))return reply([product('p',{lat:31.207,lng:121.435})])(url,options);
    throw Error('private-router-detail');
  }};
  const result=await discoverNearby(input,options), poi=result.pois[0];
  assert.equal(poi.travel.status,'estimated');assert.equal(poi.travel.routingStatus,'failed');assert.equal(poi.travel.source,'local-estimate');assert.equal(poi.travel.geometry.kind,'straight-line');assert.match(poi.travel.warning,/粗估/);assert.ok(poi.placeProof);
  const transit=(await discoverNearby({...input,mode:'transit'},options)).pois[0];assert.equal(transit.travel.status,'unavailable');assert.equal(transit.travel.durationMinutes,null);
  const {editRoute}=await import('../public/itinerary-editor.mjs');
  const base=sealRoute(createItinerary({city:'上海',stops:[0,1].map(i=>({name:'原点'+i,city:'上海',location:{lat:31.2+i*.001,lng:121.4}}))}));
  const route=editRoute(base,{type:'add',dayId:base.days[0].id,poi});
  const checked=await validateCurrent(route);assert.equal(checked.stops.at(-1).poiId,poi.id);assert.deepEqual(checked.stops.at(-1).location,poi.location);assert.equal(checked.evidence.find(e=>e.subjectId===checked.stops.at(-1).id&&e.field==='location').source,'ctrip-mcp');
  assert.ok(!JSON.stringify(result).includes('private-router-detail'));
});

test('HTTP nearby integrates signed add + conversation, validates input and exposes clean failures', async t => {
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,['--require','./test/fixtures/w09-offline.cjs','server.js'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup')),10000);child.once('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://localhost:'+m[1]);}});});
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const res=await post('/api/places/nearby',input);assert.equal(res.status,200);const result=await res.json();assert.equal(result.pois.length,2);assert.equal(result.pois[0].travel.status,'routed');assert.equal(result.pois[0].travel.geometry.kind,'road');
  const cycling=await(await post('/api/places/nearby',{...input,mode:'cycling'})).json();assert.equal(cycling.pois[0].travel.status,'estimated');
  const invalid=await post('/api/places/nearby',{...input,origin:{lat:'bad',lng:121}});assert.equal(invalid.status,400);
  const failure=await post('/api/places/nearby',{...input,city:'故障城市'});assert.equal(failure.status,502);const failed=await failure.json();assert.deepEqual(failed.pois,[]);assert.ok(!JSON.stringify(failed).includes('confidential'));
  const {editRoute}=await import('../public/itinerary-editor.mjs');
  const demo=(await(await fetch(base+'/api/demo-route')).json()).route;
  const added=editRoute(demo,{type:'add',dayId:demo.days[0].id,poi:result.pois[0]});
  const edited=await post('/api/agent-route',{prompt:'第一站停留20分钟',currentRoute:added,conversation:{mode:'edit'}});assert.equal(edited.status,200);
  const events=(await edited.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'result');assert.ok(events.at(-1).result.route.stops.some(s=>s.poiId===result.pois[0].id));
});
