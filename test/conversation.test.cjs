const test=require('node:test'),assert=require('node:assert/strict');
const {createItinerary,resolveTripContext}=require('../lib/itinerary');
const {sealRoute,sealPoi,validateCurrent}=require('../lib/conversation-route');
const {applyConversationActions,conversationInput}=require('../lib/conversation');
const make=()=>sealRoute(createItinerary({city:'上海',stops:[0,1,2,3].map(i=>({name:'地点'+i,city:'上海',location:{lat:31.2+i*.001,lng:121.4}}))},resolveTripContext({dayCount:2,startDate:'2026-10-17',dailyStartTime:'09:00',dailyEndTime:'18:00'})));
const run={check(){},call:async(tool,label,fn)=>fn()};
test('current route trusts signed facts only, validates topology, preserves user visits/booking and IDs',async()=>{
  const {editRoute}=await import('../public/itinerary-editor.mjs');
  let route=make();route=editRoute(route,{type:'visit',stopId:route.stops[0].id,visit:{stayMinutes:40,openingRules:{periods:[{start:'08:00',end:'18:00'}],closedWeekdays:[],closedDates:[]}}});
  route=editRoute(route,{type:'booking',legId:route.legs[1].id,booking:{departure:'2026-10-17T20:00',arrival:'2026-10-18T08:00',beforeMinutes:null,afterMinutes:30,label:'用户车次'}});
  const tampered=structuredClone(route);tampered.stops[0].location.lat=0;tampered.stops[0].openingHours={status:'verified',text:'虚假'};tampered.apiKey='must-not-copy';tampered.legs[0].status='routed';tampered.legs[0].durationMinutes=0;
  const clean=await validateCurrent(tampered);
  assert.equal(clean.summary,route.summary);assert.equal(clean.source,route.source);
  assert.deepEqual(clean.stops.map(s=>s.id),route.stops.map(s=>s.id));assert.deepEqual(clean.stops[0].location,route.stops[0].location);assert.deepEqual(clean.stops[0].visit,route.stops[0].visit);assert.deepEqual(clean.evidence.map(e=>e.id),route.evidence.map(e=>e.id));
  assert.deepEqual(clean.legs.find(l=>l.booking).booking,route.legs[1].booking);assert.equal(clean.legs[0].status,'unknown');assert.ok(!JSON.stringify(clean).includes('must-not-copy'));assert.notEqual(clean.stops[0].openingHours.status,'verified');
  const bad=structuredClone(route);bad.stops[0].placeProof+='bad';await assert.rejects(validateCurrent(bad));
  const duplicate=structuredClone(route);duplicate.stops[1].id=duplicate.stops[0].id;await assert.rejects(validateCurrent(duplicate));
  const wrong=structuredClone(route);wrong.legs[0].toStopId=wrong.stops[2].id;await assert.rejects(validateCurrent(wrong));
  const repeated=editRoute(route,{type:'repeat-stop',stopId:route.stops[0].id,dayId:route.days[1].id});assert.equal((await validateCurrent(repeated)).stops.length,5);
});
test('conversation actions retain opening rules, reject lock/booking loss and use verified search facts',async()=>{
  const {editRoute}=await import('../public/itinerary-editor.mjs');let base=make();base.stops[0].locked=true;base.stops[0].visit={stayMinutes:30,openingRules:{periods:[{start:'08:00',end:'18:00'}],closedWeekdays:[],closedDates:[]}};
  const revised=await applyConversationActions(base,[{type:'visit',stopId:base.stops[0].id,stayMinutes:20,openingRules:{periods:[]}}],{run});assert.equal(revised.route.stops[0].visit.stayMinutes,20);assert.equal(revised.route.stops[0].visit.openingRules.periods[0].start,'08:00');assert.equal(base.stops[0].visit.stayMinutes,30);
  await assert.rejects(applyConversationActions(base,[{type:'remove',stopId:base.stops[0].id}],{run}),e=>e.code==='CLARIFY');
  base=editRoute(base,{type:'booking',legId:base.legs[1].id,booking:{departure:'2026-10-17T20:00',arrival:'2026-10-18T08:00'}});
  await assert.rejects(applyConversationActions(base,[{type:'remove',stopId:base.stops[1].id}],{run}),e=>e.code==='CLARIFY');
  const poi=sealPoi({id:'verified-poi',name:'新地点',city:'上海',source:'ctrip',location:{lat:31.25,lng:121.45},openingHours:{status:'unknown'}});
  const added=await applyConversationActions(base,[{type:'add',dayId:base.days[1].id,name:'新地点',city:'上海',location:{lat:0,lng:0}}],{run,search:async()=>({status:'matched',candidates:[poi]})});assert.deepEqual(added.route.stops.at(-1).location,poi.location);assert.equal((await validateCurrent(added.route)).stops.length,5);
  await assert.rejects(applyConversationActions(base,[{type:'add',dayId:base.days[1].id,name:'同名',city:'上海'}],{run,search:async()=>({status:'ambiguous',candidates:[poi,poi]})}),e=>e.code==='CLARIFY');
});
test('structured memory is bounded, contains no credentials or automatic companion profile and can reset independently',async()=>{
  const {localPlan}=require('../lib/conversation-planner');
  assert.equal(localPlan('第一站停留20分钟',make()).actions[0].stayMinutes,20);
  assert.ok(localPlan('第一站不要停留20分钟',make()).question);
  assert.ok(localPlan('第一站停留20分钟，第三站停留30分钟',make()).question);
  const {ConversationState,normalizePreferences}=await import('../public/conversation-state.mjs');const memory=new ConversationState();memory.preferences=normalizePreferences({interests:['建筑','secret'],pace:'轻松',companions:['seniors'],apiKey:'private',maxWalkKm:3});
  memory.accept(make(),Array(40).fill('test sk-secret-key'));assert.equal(memory.changes.length,8);assert.ok(!JSON.stringify(memory).includes('sk-secret'));assert.ok(!JSON.stringify(memory.preferences).includes('seniors'));
  const input=await conversationInput({mode:'edit',preferences:memory.preferences,changes:memory.changes,apiKey:'SECRET',pending:{request:'sk-anotherkey',question:'q'}});assert.ok(!JSON.stringify(input).includes('SECRET'));assert.ok(!JSON.stringify(input).includes('sk-anotherkey'));
  memory.reset();assert.equal(memory.mode,'new');assert.equal(memory.request(make()).summary,null);assert.equal(memory.pending,null);assert.equal(memory.preferences.maxWalkKm,3);memory.preferences=normalizePreferences();assert.equal(memory.preferences.maxWalkKm,null);
});
test('day answers are exact user conditions, with Chinese numerals, short replies, and range validation',()=>{
  const {dayCountFromText}=require('../lib/conversation-planner');
  for(const answer of ['6天','六天','6'])assert.deepEqual(dayCountFromText(answer,'想玩几天？'),{dayCount:6});
  assert.deepEqual(dayCountFromText('不是3天，改成六天'),{dayCount:6});
  assert.deepEqual(dayCountFromText('第6天去公园'),{});
  assert.deepEqual(dayCountFromText('六'),{});
  assert.deepEqual(dayCountFromText('十四天'),{dayCount:14});
  assert.throws(()=>dayCountFromText('15天'),/1–14/);
});
test('without a Key explicit visit edits resolve current IDs locally, while compound and negative commands remain unresolved',async()=>{
  const {localPlan,prepareConversation}=require('../lib/conversation-planner');
  const route=make();
  for(const prompt of ['第一站停留20分钟，其他地方保持不变。','把第一站的停留时间改为20分钟','请将第一站的停留时间设置为20分钟，其他安排不变。']){
    assert.deepEqual(localPlan(prompt,route).actions,[{type:'visit',stopId:route.stops[0].id,stayMinutes:20}]);
    const prepared=await prepareConversation({run:{check(){},call:async(tool,label,fn)=>{assert.notEqual(tool,'conversation');return fn();}},conversation:{mode:'edit'},currentRoute:route,prompt});
    assert.equal(prepared.initial.route.stops[0].visit.stayMinutes,20);
    const userFacts=stop=>({id:stop.id,dayId:stop.dayId,name:stop.name,location:stop.location,visit:stop.visit,locked:stop.locked});
    assert.deepEqual(prepared.initial.route.stops.slice(1).map(userFacts),route.stops.slice(1).map(userFacts));
  }
  for(const prompt of ['第一站不要停留20分钟','把第一站的停留时间改为20分钟，第三站改成30分钟','第一站停留20分钟，其他地方不要保持不变'])assert.ok(!localPlan(prompt,route).actions);
});
test('with a Key even an explicit edit is interpreted by the model and its returned action is executed',async()=>{
  const {prepareConversation}=require('../lib/conversation-planner');const route=make();let calls=0;
  const prepared=await prepareConversation({run:{check(){},call:async(tool,label,fn)=>{if(tool==='conversation'){calls++;return {actions:[{type:'visit',stopId:route.stops[0].id,stayMinutes:20}]};}return fn();}},conversation:{mode:'edit'},currentRoute:route,prompt:'第一站停留20分钟，其他地方保持不变。',apiKey:'fixture-key'});
  assert.equal(calls,1);assert.equal(prepared.initial.route.stops[0].visit.stayMinutes,20);
  assert.deepEqual(prepared.initial.route.stops.slice(1).map(s=>s.id),route.stops.slice(1).map(s=>s.id));
});
test('failed initial model actions return safe tool feedback and the unchanged route for a model correction',async()=>{
  const {prepareConversation}=require('../lib/conversation-planner');const route=make();
  const actions=[{type:'visit',stopId:route.stops[0].id,stayMinutes:20},{type:'replace',stopId:route.stops[1].id,name:'新地点',city:'上海'}];
  const options={run:{check(){},call:async(tool,label,fn)=>tool==='conversation'?{reply:'已完成修改',actions}:fn()},conversation:{mode:'edit'},currentRoute:route,prompt:'调整第一站停留并换掉第二站',apiKey:'fixture-key'};
  for(const search of [async()=>({status:'not_found',candidates:[]}),async()=>{throw Object.assign(Error('vendor-secret-must-not-leak'),{code:'PLACES_UNAVAILABLE'});}]){
    const {initial}=await prepareConversation({...options,search});
    assert.deepEqual(initial.route,route);assert.deepEqual(initial.conversation.changes,[]);assert.equal(initial.conversation.reply,undefined);
    assert.equal(initial.feedback.status,'failed');assert.deepEqual(initial.feedback.actions,actions.map(action=>action.type==='replace'?{...action,addressHint:''}:action));assert.ok(initial.feedback.error);assert.ok(!JSON.stringify(initial).includes('vendor-secret'));
  }
  await assert.rejects(prepareConversation({...options,search:async()=>{throw Object.assign(Error('budget'),{code:'AGENT_LIMIT'});}}),error=>error.code==='AGENT_LIMIT');
});
test('model-only addresses do not become hard constraints on conversation place edits',async()=>{
  const {prepareConversation}=require('../lib/conversation-planner');const route=make();
  const poi=sealPoi({id:'verified-new-place',name:'新公园',city:'上海',source:'ctrip',location:{lat:31.25,lng:121.45},openingHours:{status:'unknown'}});
  for(const [prompt,expected] of [['第一站换成上海的新公园',''],['第一站换成上海的新公园，人民路 10 号','人民路10号']]){
    let observed;
    await prepareConversation({run:{check(){},call:async(tool,label,fn)=>tool==='conversation'?{actions:[{type:'replace',stopId:route.stops[0].id,name:'新公园',city:'上海',addressHint:'人民路10号'}]}:fn()},conversation:{mode:'edit'},currentRoute:route,prompt,apiKey:'must-not-be-used',search:async target=>{observed=target.addressHint;return {status:'matched',candidates:[poi]};}});
    assert.equal(observed,expected);
  }
});
test('HTTP multi-turn edit, clarification, preference precedence, failures and signed search integrate with existing agent',async t=>{
  const {spawn}=require('node:child_process');const child=spawn(process.execPath,['--require','./test/fixtures/w08-offline.cjs','server.js'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup')),10000);child.once('error',reject);child.stdout.on('data',b=>{const m=b.toString().match(/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://localhost:'+m[1]);}});});
  const post=async(body)=>{const res=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(res.status,200);const events=(await res.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'result',JSON.stringify(events.at(-1)));return events.at(-1).result;};
  const route=(await(await fetch(base+'/api/demo-route')).json()).route;
  const request={prompt:'第一站停留20分钟',currentRoute:route,conversation:{mode:'edit'}};
  const offline=await post(request);assert.equal(offline.route.stops[0].visit.stayMinutes,20);assert.equal(offline.route.id,route.id);assert.ok(offline.agent.versions.some(v=>v.id==='current'));assert.equal(offline.agent.usage.modelCalls,0);
  const follow=await post({...request,prompt:'步行预算改成2公里',currentRoute:offline.route,apiKey:'fixture-key'});assert.equal(follow.route.context.maxWalkKm,2);assert.equal(follow.route.stops[0].visit.stayMinutes,20);
  const question=await post({...request,prompt:'换一个',apiKey:'fixture-key'});assert.equal(question.conversation.status,'clarify');assert.ok(!question.route);
  const answered=await post({...request,conversation:{mode:'edit',pending:question.conversation.pending},apiKey:'fixture-key'});assert.equal(answered.route.stops[0].visit.stayMinutes,20);
  const errorPost=async(body)=>{const response=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return (await response.text()).trim().split('\n').map(JSON.parse).at(-1);};
  const direct=await post({...request,prompt:'第一站停留20分钟，其他地方保持不变。',apiKey:'fixture-key'});assert.equal(direct.route.stops[0].visit.stayMinutes,20);assert.equal(direct.agent.usage.modelCalls,2);assert.deepEqual(direct.route.stops.map(s=>s.id),route.stops.map(s=>s.id));
  const exactAuth=await errorPost({...request,prompt:'第一站停留20分钟',apiKey:'auth-fixture'});assert.equal(exactAuth.code,'MODEL_AUTH');
  const unavailable=await errorPost({...request,prompt:'帮我调整一下行程',apiKey:'fail-fixture'});assert.equal(unavailable.type,'error');assert.equal(unavailable.code,'MODEL_UNAVAILABLE');assert.ok(!JSON.stringify(unavailable).includes('fail-fixture'));
  const auth=await errorPost({...request,prompt:'帮我调整一下行程',apiKey:'auth-fixture'});assert.equal(auth.code,'MODEL_AUTH');assert.equal(auth.action,'settings');assert.ok(!JSON.stringify(auth).includes('vendor-secret'));
  const noKey=await errorPost({prompt:'杭州6天',conversation:{mode:'new'}});assert.equal(noKey.code,'MODEL_KEY_REQUIRED');assert.ok(!noKey.result);
  assert.deepEqual(await(await fetch(base+'/api/capabilities')).json(),{aiConfigured:false,placesConfigured:true});
  const missing=await post({prompt:'城市未定',conversation:{mode:'new'},apiKey:'fixture-key'});assert.equal(missing.conversation.status,'clarify');
  const fresh=await post({prompt:'上海这次步行',conversation:{mode:'new',preferences:{transportMode:'cycling',companions:['seniors']}},apiKey:'fixture-key'});assert.equal(fresh.route.context.transportMode,'walking');assert.deepEqual(fresh.route.context.companions,[]);
  const pending={request:'上海旅游',question:'想玩几天？',field:'dayCount',city:'上海',conditions:{transportMode:'cycling'}};
  const sixDays=await post({prompt:'6天',conversation:{mode:'new',pending},apiKey:'fixture-key'});assert.equal(sixDays.conversation.status,'candidate');assert.equal(sixDays.route.context.dayCount,6);assert.equal(sixDays.route.days.length,6);assert.equal(sixDays.route.context.transportMode,'cycling');assert.match(sixDays.warning,/还没有安排地点/);
  const form=await post({prompt:'上海已填天数',conversation:{mode:'new'},context:{dayCount:4},apiKey:'fixture-key'});assert.equal(form.route.context.dayCount,4);
  const cityMissing=await post({prompt:'城市未定，六天',conversation:{mode:'new'},apiKey:'fixture-key'});assert.equal(cityMissing.conversation.pending.conditions.dayCount,6);assert.equal(cityMissing.conversation.pending.field,'city');
  const cityAnswered=await post({prompt:'上海',conversation:{mode:'new',pending:cityMissing.conversation.pending},apiKey:'fixture-key'});assert.equal(cityAnswered.route.days.length,6);
  const invalid=structuredClone(route);invalid.stops[0].placeProof='forged';const res=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,currentRoute:invalid})});assert.equal(res.status,400);
  const search=await fetch(base+'/api/places/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'景山公园',city:'北京'})});const found=await search.json();assert.ok(found.candidates[0].placeProof);
});
