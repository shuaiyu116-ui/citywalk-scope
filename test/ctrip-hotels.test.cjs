const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHotelRequest, normalizeHotels, searchMcpHotels, planHotelRequest, enrichRouteHotels } = require('../lib/ctrip-hotels');
const { buildDecisionInput, decideNextStep } = require('../lib/agent-decision');
const { scope } = require('../lib/agent-scope');

const route = () => ({ city: '上海', context: { dayCount: 3 }, days: [{index:1},{index:2},{index:3}], stops: [{ name:'静安寺', city:'上海' }], legs: [] });
const product = (id = 12) => ({ productID:id, basicInfo:{ productID:id, name:'上海示例酒店', cityName:'上海', available:true, price:360, priceIncludeTax:false, score:4.8, address:'真实供应商地址', imageURL:'https://dimg04.c-ctrip.com/images/a.jpg' }, additionalInfo:{ coordinate:{lat:31.22636,lng:121.435755}, star:4, zoneName:'静安寺', introduce:'<p>供应商酒店介绍</p>' }, urlInfo:{h5Url:'https://m.ctrip.com/webapp/hotels/detail?hotelid='+id} });
const query = {cityName:'上海',landmarkName:'静安寺'};

test('hotel request uses actual MCP fields, explicit dates and trip cities only', () => {
  const trip = route(); trip.context.startDate='2026-10-17';
  assert.deepEqual(normalizeHotelRequest({cityName:'上海市',landmarkName:'静安寺',maxPrice:900,checkInDate:'2030-01-01',keyword:'unsupported',roomCount:3},{route:trip,preferences:{budgetMax:500,roomCount:2}}),{
    cityName:'上海',landmarkName:'静安寺',checkInDate:'2026-10-17',checkOutDate:'2026-10-19',maxPrice:500
  });
  const anchored=normalizeHotelRequest({cityName:'上海',tags:'亲子乐园',hotelName:'某酒店',landmarkName:'静安寺'},{route:route()});
  assert.equal(anchored.landmarkName,'静安寺');assert.equal(anchored.tags,undefined);
  assert.equal(normalizeHotelRequest({cityName:'上海',tags:'亲子乐园'},{route:route()}).tags,'亲子乐园');
  assert.equal(normalizeHotelRequest({cityName:'上海',checkInDate:'2030-01-01'},{route:route()}).checkInDate,undefined);
  assert.throws(()=>normalizeHotelRequest({cityName:'北京'},{route:route()}));
  assert.throws(()=>normalizeHotelRequest(query,{route:route(),preferences:{checkIn:'2026-10-19',checkOut:'2026-10-17'}}));
});

test('real product normalization rejects foreign cities, duplicates, unsafe URLs and budget excess', () => {
  const wrong=product(13);wrong.basicInfo.cityName='北京';
  const expensive=product(14);expensive.basicInfo.price=1200;
  const unsafe=product(15);unsafe.basicInfo.imageURL='javascript:alert(1)';unsafe.urlInfo.h5Url='https://ctrip.com.evil.invalid/hotel';unsafe.additionalInfo.coordinate={lat:'',lng:null};
  const candidates=normalizeHotels([product(),product(),wrong,expensive,unsafe,{name:'fabricated'}],{...query,maxPrice:500},{retrievedAt:'2026-10-17T00:00:00Z'});
  assert.equal(candidates.length,2);assert.equal(candidates[0].id,'ctrip-hotel-12');
  assert.equal(candidates[0].price.amount,360);assert.equal(candidates[0].taxIncluded,false);
  assert.match(candidates[0].price.description,/默认日期参考/);assert.equal(candidates[0].rating,4.8);
  assert.equal(candidates[0].description,'供应商酒店介绍');assert.equal(candidates[0].source,'ctrip');
  assert.notEqual(candidates[0].location.lat,31.22636);assert.equal(candidates[0].coordinateSystem,'wgs84');
  assert.equal(candidates[1].location,null);assert.equal(candidates[1].image,'');assert.equal(candidates[1].detailUrl,'');
  const dated=normalizeHotels([product()],{...query,checkInDate:'2026-10-17',checkOutDate:'2026-10-19'})[0];
  assert.doesNotMatch(dated.price.description,/默认日期/);
});

test('hotel tool receives bounded real query contract and empty/error results do not become example hotels',async()=>{
  let calls=0;
  const options={token:'fixture-token',fetchImpl:async(_url,opts)=>{
    calls++;const body=JSON.parse(opts.body);
    assert.equal(body.params.name,'query_hotel');
    assert.deepEqual(body.params.arguments,query);
    return new Response(JSON.stringify({id:body.id,result:{content:[{type:'text',text:JSON.stringify(calls===1?[product()]:[])}]}}));
  }};
  const first=await searchMcpHotels({...query,roomCount:2,adultCount:3},options);
  assert.equal(first.status,'ready');assert.equal(first.request.roomCount,2);assert.equal(first.candidates.length,1);
  assert.equal((await searchMcpHotels(query,options)).status,'empty');
  await assert.rejects(searchMcpHotels(query,{token:'fixture-token',fetchImpl:async()=>{throw Error('fixture-token private response');}}),error=>!error.message.includes('fixture-token'));
});

test('DS hotel planner receives actual trip and preferences, accounts for model usage, and strips key',async()=>{
  let sent;
  const run={check(){},signal:new AbortController().signal,limits:{networkCalls:4},modelReports:0,usage:{networkCalls:0,promptTokens:0,completionTokens:0,tokenUsageComplete:true}};
  const answer={requested:true,cityName:'上海',landmarkName:'静安寺',reason:'靠近游览区域'};
  const result=await scope.run(run,()=>planHotelRequest('fixture-private-key',{route:route(),request:'我输入了fixture-private-key，想住静安寺附近',hotelPreferences:{budgetMax:500},conversation:{}},{fetchImpl:async(_url,opts)=>{
    sent=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(answer)}}],usage:{prompt_tokens:20,completion_tokens:5}})};
  }}));
  assert.deepEqual(result,answer);const input=JSON.parse(sent.messages[1].content);
  assert.equal(input.trip.stops[0].name,'静安寺');assert.equal(input.preferences.budgetMax,500);assert.doesNotMatch(input.request,/fixture-private-key/);
  assert.equal(run.modelReports,1);assert.equal(run.usage.promptTokens,20);
});

test('hotel enrichment retains selected facts on ordinary edits, permits decline, and reports query failure safely',async()=>{
  const trip=route(), events=[];let plans=0,searches=0;
  const run={check(){},call:async(name,_message,fn,config)=>{events.push({name,model:!!config?.model});return fn();}};
  const options={token:'fixture-token',plan:async()=>{plans++;return {requested:true,cityName:'上海',landmarkName:'静安寺'};},search:async req=>{searches++;return {status:'ready',request:req,candidates:normalizeHotels([product()],req),selectedId:null,queriedAt:'2026-10-17T00:00:00Z',message:'酒店候选'};}};
  await enrichRouteHotels({route:trip,apiKey:'fixture',request:'帮我找酒店',hotelPreferences:{requested:true,budgetMax:500,roomCount:2},run},options);
  assert.equal(trip.hotels.status,'ready');assert.equal(trip.hotels.request.roomCount,2);
  assert.deepEqual(events.map(event=>event.name),['hotel-plan','hotels']);assert.ok(events[0].model);
  trip.hotels.selectedId=trip.hotels.candidates[0].id;
  await enrichRouteHotels({route:trip,apiKey:'fixture',request:'选第一家酒店',run},options);
  assert.equal(plans,1);assert.equal(searches,1);assert.equal(trip.hotels.selectedId,'ctrip-hotel-12');
  await enrichRouteHotels({route:trip,apiKey:'fixture',request:'再找个酒店',hotelPreferences:{requested:true},run},{...options,search:async()=>{throw Error('private token fixture');}});
  assert.equal(trip.hotels.status,'unavailable');assert.equal(trip.hotels.candidates.length,0);assert.doesNotMatch(JSON.stringify(trip.hotels),/private token|fixture/);
  await enrichRouteHotels({route:trip,apiKey:'fixture',hotelPreferences:{requested:false},run},options);
  assert.equal(trip.hotels.status,'not-requested');assert.equal(plans,2);
});

test('DS receives actual hotel prices and external opening sources and can select a candidate ID',async t=>{
  const trip=route();trip.hotels={status:'ready',request:query,candidates:normalizeHotels([product()],query),selectedId:null,queriedAt:'now'};
  trip.stops[0].guide={openingText:'周一-周五 09:00-17:00',source:'OpenStreetMap',url:'https://www.openstreetmap.org/node/12',retrievedAt:'now'};
  trip.hotels.privateSecret='do-not-copy';trip.hotels.candidates[0].proof='private-proof';
  const input={route:trip,versions:[{id:'v0',route:trip}],canAct:true};
  const summary=buildDecisionInput(input);
  assert.equal(summary.current.hotels.candidates[0].price.amount,360);assert.equal(summary.current.stops[0].guide.source,'OpenStreetMap');assert.doesNotMatch(JSON.stringify(summary),/do-not-copy|private-proof/);
  t.mock.method(global,'fetch',async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({actions:[{type:'hotel',hotelId:'ctrip-hotel-12',price:1}],reason:'选择靠近游览区域的酒店参考。'})}}]})}));
  assert.deepEqual((await decideNextStep('fixture',input)).actions,[{type:'hotel',hotelId:'ctrip-hotel-12'}]);
});
