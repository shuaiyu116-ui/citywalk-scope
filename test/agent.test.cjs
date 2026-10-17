const test = require('node:test');
const assert = require('node:assert/strict');
const { runAgent, LIMITS } = require('../lib/web-agent');
const { scope, scopedFetch } = require('../lib/agent-scope');
const { applyConversationActions } = require('../lib/conversation');
const { createItinerary, resolveTripContext } = require('../lib/itinerary');
const make = (context={}) => createItinerary({ city:'上海', stops:[0,1,2,3].map(i => ({name:'地点'+i,city:'上海',location:{lat:31.2+i*.001,lng:121.4}})) }, resolveTripContext({startDate:'2026-10-17',dailyStartTime:'09:00',dailyEndTime:'11:00',maxWalkKm:5,...context}));
const roads = async body => ({ legs: body.legs.map(l => ({...l,status:'routed',mode:'walking',durationMinutes:10,distanceMeters:300})) });
const execute = ({route,actions,run}) => applyConversationActions(route,actions,{run,search:async()=>assert.fail('This action does not require a place query')});

test('DS can act without conflicts and select a recalculated version without metric improvement', async () => {
  const route=make({dailyEndTime:'18:00'}),events=[];
  route.stops[0].locked=true;
  const original=structuredClone(route),action={type:'move',stopId:route.stops[2].id,offset:-1};
  let calls=0;
  const result=await runAgent({seed:async()=>({route,source:'demo'}),transport:roads,execute,emit:e=>events.push(e),decide:async input=>{
    calls++;
    if(calls===1){
      assert.equal(input.versions[0].metrics.conflicts,0);assert.equal(input.canAct,true);
      return {actions:[action],reason:'按照用户偏好先去第三站'};
    }
    assert.equal(input.route.stops[1].id,action.stopId);assert.ok(input.route.days[0].schedule);
    assert.ok(input.route.legs.every(l=>l.status==='routed'));
    assert.equal(input.feedback.status,'completed');assert.deepEqual(input.feedback.actions,[action]);
    assert.ok(input.feedback.changes.length);assert.equal(input.versions.length,2);
    return {actions:[],versionId:'v1',reason:'保留新的游玩顺序'};
  }});
  assert.equal(calls,2);assert.equal(result.agent.versions.length,2);assert.equal(result.agent.selectedVersionId,'v1');
  assert.deepEqual(result.agent.versions[1].metrics,result.agent.versions[0].metrics);
  assert.deepEqual(route,original);assert.equal(result.route.id,route.id);assert.equal(result.route.revision.number,2);
  assert.equal(result.route.stops[0].id,original.stops[0].id);assert.equal(result.route.stops.length,4);
  assert.equal(events.filter(e=>e.tool==='schedule'&&e.status==='completed').length,2);
  assert.ok(!events.some(e=>e.tool==='compare'));assert.equal(result.agent.usage.rounds,1);
});

test('DS may choose the original version even when a newer version has fewer conflicts',async()=>{
  const route=make();let calls=0;
  const result=await runAgent({seed:async()=>({route}),transport:roads,execute,decide:async({versions})=>{
    calls++;
    if(calls===1)return {actions:[{type:'remove',stopId:route.stops[3].id}],reason:'尝试减少一站'};
    assert.ok(versions[1].metrics.conflicts<versions[0].metrics.conflicts);
    return {actions:[],versionId:'v0',reason:'保留用户更喜欢的四个地点'};
  }});
  assert.equal(result.agent.selectedVersionId,'v0');assert.equal(result.route.stops.length,4);
  assert.equal(result.agent.versions[1].route.stops.length,3);
});

test('coverage warnings follow the selected route and selecting the prior trip drops discarded warnings',async()=>{
  const route=make({dayCount:2}),{editRoute}=await import('../public/itinerary-editor.mjs');
  const withEmpty=editRoute(route,{type:'add-day'});let calls=0;
  const filled=await runAgent({seed:async()=>({route:withEmpty}),transport:roads,execute,decide:async()=>{
    if(++calls===1)return {actions:[{type:'assign-day',stopId:withEmpty.stops[3].id,dayId:withEmpty.days[2].id}]};
    return {actions:[],reason:'第三天已有地点'};
  }});
  assert.ok(filled.route.days.every(day=>day.stopIds.length));assert.doesNotMatch(filled.warning,/还没有安排地点/);
  const reverted=await runAgent({seed:async()=>({route:withEmpty,previousRoute:route,warning:'只属于放弃版本的提示'}),transport:roads,decide:async()=>({versionId:'current',reason:'保留修改前行程'})});
  assert.equal(reverted.route.days.length,2);assert.equal(reverted.warning,'');
});

test('a failed action batch leaves the original intact and sends execution feedback to DS for correction',async()=>{
  const route=make();route.stops[0].locked=true;
  const original=structuredClone(route);let calls=0;
  const result=await runAgent({seed:async()=>({route}),transport:roads,execute,decide:async input=>{
    calls++;
    if(calls===1)return {actions:[{type:'visit',stopId:route.stops[1].id,stayMinutes:12},{type:'remove',stopId:route.stops[0].id}]};
    if(calls===2){
      assert.equal(input.feedback.status,'failed');assert.ok(input.feedback.error);
      assert.equal(input.versions.length,1);assert.equal(input.route.stops.length,4);
      assert.deepEqual(input.route.stops[1].visit,original.stops[1].visit);
      return {actions:[{type:'remove',stopId:route.stops[3].id}],reason:'保留必去点，改为删去另一站'};
    }
    assert.equal(input.canAct,false);assert.equal(input.feedback.status,'completed');
    return {actions:[],versionId:'v1',reason:'采用已完成的调整'};
  }});
  assert.equal(calls,3);assert.equal(result.agent.usage.rounds,2);assert.equal(result.agent.versions.length,2);
  assert.equal(result.route.stops.length,3);assert.ok(result.route.stops.some(s=>s.id===route.stops[0].id));
  assert.deepEqual(route,original);
});

test('the executor preserves a fixed booking and reports an incompatible DS action',async()=>{
  const {editRoute}=await import('../public/itinerary-editor.mjs');
  let route=make();route=editRoute(route,{type:'booking',legId:route.legs[1].id,booking:{departure:'2026-10-17T09:20',arrival:'2026-10-17T09:50',beforeMinutes:10,afterMinutes:10,label:'用户预订'}});
  const original=structuredClone(route),booked=route.legs.find(l=>l.booking);let calls=0;
  const result=await runAgent({seed:async()=>({route}),transport:async body=>{assert.ok(!body.legs.some(l=>l.id===booked.id));return roads(body);},execute,decide:async input=>{
    calls++;
    if(calls===1)return {actions:[{type:'remove',stopId:booked.toStopId}]};
    assert.equal(input.feedback.status,'failed');
    return {actions:[],versionId:'v0',reason:'保留已有预订及其衔接地点'};
  }});
  assert.equal(calls,2);assert.equal(result.agent.versions.length,1);assert.deepEqual(route,original);
  assert.deepEqual(result.route.legs.find(l=>l.id===booked.id).booking,booked.booking);
});

test('conversation edits are returned to DS as computed facts and do not trigger unsolicited edits',async()=>{
  const {prepareConversation}=require('../lib/conversation-planner');
  const route=make();route.stops[0].locked=true;
  const original=structuredClone(route);let calls=0;
  const result=await runAgent({seed:run=>prepareConversation({run,conversation:{mode:'edit'},currentRoute:route,prompt:'第一站停留20分钟，其他地方保持不变。',apiKey:''}).then(value=>value.initial),transport:roads,execute:()=>assert.fail('DS did not request any additional action'),decide:async({route:computed})=>{
    calls++;assert.equal(computed.stops[0].visit.stayMinutes,20);assert.ok(computed.days[0].schedule);
    return {actions:[],reason:'已按要求调整第一站，保留其余安排'};
  }});
  assert.equal(calls,1);assert.equal(result.agent.usage.modelCalls,1);assert.equal(result.agent.versions.length,1);
  assert.equal(result.route.stops[0].visit.stayMinutes,20);
  assert.deepEqual(result.route.stops.map(s=>({id:s.id,dayId:s.dayId,locked:s.locked})),original.stops.map(s=>({id:s.id,dayId:s.dayId,locked:s.locked})));
  assert.deepEqual(result.route.days.map(d=>({id:d.id,stopIds:d.stopIds})),original.days.map(d=>({id:d.id,stopIds:d.stopIds})));
  assert.deepEqual(result.route.stops.slice(1).map(s=>s.visit),original.stops.slice(1).map(s=>s.visit));
});

test('timeouts, cancellation, round/tool/model/network bounds and safe failures stop extra work',async()=>{
  const options={seed:async()=>({route:make()}),transport:roads,execute};
  const controller=new AbortController();let reached=0;
  const running=runAgent({...options,signal:controller.signal,seed:async run=>{reached++;await new Promise(resolve=>setTimeout(resolve,35));run.check();return {route:make()};}});
  controller.abort();await assert.rejects(running,e=>e.code==='AGENT_CANCELLED');
  await assert.rejects(runAgent({...options,seed:()=>new Promise(()=>{}),limits:{timeoutMs:15}}),e=>e.code==='AGENT_TIMEOUT');
  const toolLimited=await runAgent({...options,limits:{toolCalls:1}});assert.equal(toolLimited.agent.stopReason,'budget');assert.equal(toolLimited.agent.usage.toolCalls,1);
  const modelLimited=await runAgent({...options,limits:{modelCalls:0},decide:()=>assert.fail('no model call')});assert.equal(modelLimited.agent.stopReason,'budget');
  const unknown=await runAgent({...options,transport:async()=>{throw new Error('SECRET vendor payload');},decide:async input=>{assert.ok(input.feedback.notices.length);assert.ok(input.route.legs.every(leg=>leg.status!=='routed'));return {actions:[],reason:'交通暂未取得，保留当前安排供确认'};}});assert.equal(unknown.agent.stopReason,'model-stopped');assert.ok(!JSON.stringify(unknown).includes('SECRET'));
  let decisions=0,executions=0;
  const roundLimited=await runAgent({...options,limits:{rounds:1},execute:input=>{executions++;return execute(input);},decide:async({route,canAct})=>{
    decisions++;assert.equal(canAct,decisions===1);
    return {actions:[{type:'move',stopId:route.stops[2].id,offset:-1}]};
  }});
  assert.equal(decisions,2);assert.equal(executions,1);assert.equal(roundLimited.agent.usage.rounds,1);assert.equal(roundLimited.agent.versions.length,2);
  const completed=await runAgent({...options,limits:{modelCalls:1},decide:async({route})=>({actions:[{type:'move',stopId:route.stops[2].id,offset:-1}]})});
  assert.equal(completed.agent.stopReason,'budget');assert.equal(completed.agent.selectedVersionId,'v1');assert.equal(completed.agent.versions.length,2);
  assert.deepEqual(completed.route,completed.agent.versions[1].route);
  const usage={networkCalls:0};await scope.run({usage,limits:{networkCalls:0},signal:new AbortController().signal,check(){}},async()=>assert.throws(()=>scopedFetch('https://must-not-be-called.invalid'),e=>e.code==='AGENT_LIMIT'));
  assert.ok(reached<=1);assert.equal(LIMITS.modelCalls,10);
});

test('scoped fetch cancels downstream response bodies and isolates concurrent request budgets',async()=>{
  const original=global.fetch;let aborted=0;
  global.fetch=async(url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>{aborted++;controller.error(new Error('aborted'));},{once:true});}}));
  try {
    const controller=new AbortController();
    let start;const began=new Promise(resolve=>{start=resolve;});
    const running=runAgent({signal:controller.signal,seed:async run=>run.call('intent','模型读取',async()=>{const response=await scopedFetch('https://fixture.invalid');start();await response.json();return {route:make()};}),transport:roads});
    await began;controller.abort();await assert.rejects(running,e=>e.code==='AGENT_CANCELLED');assert.equal(aborted,1);
    global.fetch=async()=>new Response('{}');
    const counters=await Promise.all([1,2].map(count=>{
      const usage={networkCalls:0};return scope.run({usage,limits:{networkCalls:count},signal:new AbortController().signal,check(){}},async()=>{for(let i=0;i<count;i++)await (await scopedFetch('https://fixture.invalid')).json();assert.throws(()=>scopedFetch('https://fixture.invalid'),e=>e.code==='AGENT_LIMIT');return usage.networkCalls;});
    }));assert.deepEqual(counters,[1,2]);
  } finally {global.fetch=original;}
});

test('HTTP stream returns DS decisions and revisions, rejects no-key/failure without demo fallback, and accepts cancellation',async t=>{
  const {spawn}=require('node:child_process');const child=spawn(process.execPath,['--require','./test/fixtures/w07-offline.cjs','server.js'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup')),10000);child.once('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://localhost:'+m[1]);}});});
  const request=async body=>{const response=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/ndjson/);return (await response.text()).trim().split('\n').map(line=>JSON.parse(line));};
  const body={prompt:'上海街区散步',apiKey:'fixture-only-key',context:{startDate:'2026-10-17',dailyStartTime:'09:00',dailyEndTime:'10:30'}};
  const stream=await request(body),final=stream.at(-1);assert.equal(final.type,'result');assert.equal(final.result.source,'deepseek');
  assert.ok(stream.some(e=>e.tool==='places'&&e.status==='completed'));assert.ok(stream.some(e=>e.tool==='decide'));assert.ok(!stream.some(e=>e.tool==='compare'));
  assert.ok(final.result.agent.versions.length>=2);assert.equal(final.result.agent.selectedVersionId,'v1');assert.ok(final.result.agent.usage.networkCalls>0);assert.equal(final.result.agent.usage.tokenUsageComplete,false);
  assert.ok(!JSON.stringify(stream).includes(body.apiKey));assert.ok(!JSON.stringify(stream).includes('offline-test-only'));
  const noKey=(await request({prompt:'上海散步'})).at(-1);assert.equal(noKey.type,'error');assert.equal(noKey.code,'MODEL_KEY_REQUIRED');assert.ok(!noKey.result);
  const failure=(await request({...body,apiKey:'fail-fixture'})).at(-1);assert.equal(failure.type,'error');assert.equal(failure.code,'MODEL_UNAVAILABLE');assert.ok(!failure.result);
  const cancel=new AbortController();const response=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,apiKey:'slow-fixture'}),signal:cancel.signal});
  const reader=response.body.getReader();const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/started/);cancel.abort();await assert.rejects(reader.read());
  const invalid=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'x',context:{dayCount:99}})});assert.equal(invalid.status,400);
});
