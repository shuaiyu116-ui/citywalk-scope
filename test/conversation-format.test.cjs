const test=require('node:test'),assert=require('node:assert/strict');
const {prepareConversation}=require('../lib/conversation-planner');
const {normalizeTripInput}=require('../lib/itinerary');
const pending={request:'我想去南京，3天时间',question:'大概哪天出发，几个人一起去？（也可回复“按默认安排”直接生成。）',field:'startDate',city:'南京',conditions:{dayCount:3},preflightAsked:true};

function mockModel(t,plans){
  const previous=global.fetch,bodies=[];
  t.after(()=>{global.fetch=previous;});
  global.fetch=async(url,options)=>{
    bodies.push(JSON.parse(options.body));
    assert.ok(bodies.length<=plans.length,'format correction must be bounded');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plans[bodies.length-1])}}]}));
  };
  return bodies;
}
function prepare(context={}){
  return prepareConversation({run:{check(){},call:async(tool,label,fn)=>fn()},conversation:{mode:'new',pending,messages:[{role:'user',content:pending.request},{role:'assistant',content:pending.question}]},prompt:'10月18日，两个人',apiKey:'fixture-only',explicitContext:context});
}

test('Nanjing preflight repairs a model headcount in companions without losing the original trip',async t=>{
  const bodies=mockModel(t,[{city:'南京',conditions:{startDate:'2026-10-18',companions:'两个人'}},{city:'南京',conditions:{startDate:'2026-10-18'}}]);
  const result=await prepare();
  assert.equal(bodies.length,2);assert.equal(result.city,'南京');
  assert.deepEqual(result.explicitContext,{dayCount:3,startDate:'2026-10-18'});
  assert.equal(result.hotelPreferences.adultCount,undefined);
  const input=JSON.parse(bodies[1].messages[1].content);
  assert.equal(input.pending.request,pending.request);assert.equal(input.request,'10月18日，两个人');
  assert.equal(input.preflight.canAsk,false);assert.match(input.currentDate,/^\d{4}-\d{2}-\d{2}$/);
  assert.match(bodies[1].messages[0].content,/conditions\.companions/);
  assert.equal(JSON.parse(result.planningPrompt).previousRequest,pending.request);
  assert.equal(JSON.parse(result.planningPrompt).request,'10月18日，两个人');
});

test('month-day output is corrected once; repeated invalid model conditions fail without looping',async t=>{
  const bodies=mockModel(t,[{conditions:{startDate:'10月18日'}},{conditions:{startDate:'2026-02-31'}}]);
  await assert.rejects(prepare(),error=>error.code==='MODEL_RESPONSE');
  assert.equal(bodies.length,2);assert.match(bodies[1].messages[0].content,/conditions\.startDate/);
});

test('explicit conditions override malformed model values while direct HTTP input validation stays strict',async t=>{
  const bodies=mockModel(t,[{city:'南京',conditions:{dayCount:'三天',startDate:'10月18日',companions:2}}]);
  const result=await prepare({dayCount:4,startDate:'2026-10-20',companions:['children']});
  assert.equal(bodies.length,1);assert.deepEqual(result.explicitContext,{dayCount:4,startDate:'2026-10-20',companions:['children']});
  for(const context of [{companions:2},{companions:'两个人'},{startDate:'10月18日'}])assert.throws(()=>normalizeTripInput(context));
});
