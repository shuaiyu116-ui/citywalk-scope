const test=require('node:test'),assert=require('node:assert/strict');
const {createItinerary,resolveTripContext}=require('../lib/itinerary');
const {applyConversationActions,conversationInput}=require('../lib/conversation');
const {sealPoi}=require('../lib/conversation-route');
const make=()=>createItinerary({city:'上海',stops:[0,1,2,3].map(i=>({name:'地点'+i,city:'上海',location:{lat:31.2+i*.001,lng:121.4}}))},resolveTripContext({dayCount:1,startDate:'2026-10-17'}));
const run={check(){},call:async(tool,label,fn)=>fn()};
const poi=name=>sealPoi({id:name,name,city:'上海',source:'ctrip',location:{lat:31.22,lng:121.44},openingHours:{status:'unknown'}});
test('model operation envelopes are normalized as data and invalid formats remain service errors',()=>{
  const {normalizeModelActions}=require('../lib/conversation-planner');
  assert.deepEqual(normalizeModelActions([{redistribute:{dayCount:4}},{add:{name:'真实候选',city:'上海',recommended:true}}]),[{type:'redistribute',dayCount:4},{type:'add',name:'真实候选',city:'上海',recommended:true}]);
  for(const value of [[{unknown:{}}],[{redistribute:{dayCount:4},add:{name:'混合操作'}}],'not-an-array'])assert.throws(()=>normalizeModelActions(value),error=>error.code==='MODEL_RESPONSE');
});
test('compound edits retain original identities, spread all stops and disclose unavailable recommendations',async()=>{
  const base=make();base.stops[0].locked=true;base.stops[0].visit={stayMinutes:40};
  const result=await applyConversationActions(base,[{type:'redistribute',dayCount:4},{type:'add',name:'新景点',city:'上海',recommended:true},{type:'add',name:'新商场',city:'上海',recommended:true},{type:'add',name:'未找到商场',city:'上海',recommended:true}],{run,search:async target=>target.name==='未找到商场'?{status:'not_found',candidates:[]}:{status:'matched',candidates:[poi(target.name)]}});
  assert.equal(result.route.days.length,4);assert.equal(result.route.stops.length,6);
  assert.ok(result.route.days.every(day=>day.stopIds.length));
  const originalIds=new Set(base.stops.map(stop=>stop.id));
  assert.deepEqual(result.route.stops.filter(stop=>originalIds.has(stop.id)).map(stop=>stop.id),base.stops.map(stop=>stop.id));
  assert.equal(result.route.stops[0].locked,true);assert.equal(result.route.stops[0].visit.stayMinutes,40);
  assert.match(result.notices.join(''),/未找到商场.*未加入/);assert.equal(base.days.length,1);assert.equal(base.stops.length,4);
  for(const extra of ['booking','visited']){
    const protectedRoute=make();if(extra==='booking')protectedRoute.legs[0].booking={label:'用户预订'};else protectedRoute.stops[0].progress={completed:true};
    await assert.rejects(applyConversationActions(protectedRoute,[{type:'redistribute',dayCount:4}],{run}),error=>error.code==='CLARIFY'&&/预订|游览/.test(error.message));
  }
});
test('dialogue memory preserves bounded user/assistant turns without accepting system roles or keys',async()=>{
  const messages=[...Array(15)].map((_,i)=>({role:i%2?'assistant':'user',content:'消息'+i+' sk-secret-value'}));
  messages.push({role:'system',content:'must-not-be-accepted'});
  const input=await conversationInput({mode:'edit',messages});
  assert.ok(input.messages.length<=10);assert.ok(!JSON.stringify(input).includes('must-not-be-accepted'));assert.ok(!JSON.stringify(input).includes('sk-secret-value'));
});
test('HTTP screenshot dialogue handles both compound intent and 同时 without repeating the question; normal replies need no edit',async t=>{
  const {spawn}=require('node:child_process');const child=spawn(process.execPath,['--require','./test/fixtures/w16-dialogue-offline.cjs','server.js'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup')),10000);child.once('error',reject);child.stdout.on('data',bytes=>{const found=bytes.toString().match(/localhost:(\d+)/);if(found){clearTimeout(timer);resolve('http://localhost:'+found[1]);}});});
  const route=(await(await fetch(base+'/api/demo-route')).json()).route;
  const post=async(prompt,pending,messages=[])=>{
    const response=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,currentRoute:route,apiKey:'fixture-only',conversation:{mode:'edit',pending,messages}})});
    const final=(await response.text()).trim().split('\n').map(JSON.parse).at(-1);assert.equal(final.type,'result',JSON.stringify(final));return final.result;
  };
  const original='分散到四天并且多来几个景点和商场';
  const pending={request:original,question:'你想把现有4个点分散到4天，还是同时新增景点和商场？'};
  for(const result of [await post(original),await post('同时',pending,[{role:'user',content:original},{role:'assistant',content:pending.question}])]){
    assert.equal(result.conversation.status,'candidate');assert.equal(result.route.days.length,4);assert.equal(result.route.stops.length,6);
    assert.ok(result.route.stops.some(stop=>stop.name==='上海博物馆'));assert.ok(result.route.stops.some(stop=>stop.name==='上海环球港'));
    const originalIds=new Set(route.stops.map(stop=>stop.id));assert.deepEqual(result.route.stops.filter(stop=>originalIds.has(stop.id)).map(stop=>stop.id),route.stops.map(stop=>stop.id));
    assert.ok(!result.conversation.question);assert.ok(result.conversation.reply);assert.equal(result.agent.stopReason,'model-stopped');assert.ok(result.agent.usage.modelCalls>=2);
  }
  const answer=await post('为什么这样安排？');assert.equal(answer.conversation.status,'reply');assert.match(answer.conversation.reply,/已取得3段道路/);assert.equal(answer.route,undefined);
});
