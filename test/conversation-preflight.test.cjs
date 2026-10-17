const test=require('node:test'),assert=require('node:assert/strict');
const {conversationInput}=require('../lib/conversation');
const {prepareConversation}=require('../lib/conversation-planner');
const {normalizeHotelPreferences}=require('../lib/conversation-preflight');

async function prepare(prompt,plan,{pending,context={},inspect}={}){
  let calls=0;
  const conversation=await conversationInput({mode:'new',pending});
  const run={check(){},async call(tool,label,fn){assert.equal(tool,'conversation');calls++;return plan;}};
  const input={run,conversation,prompt,apiKey:'fixture-only',explicitContext:context};
  try{const result=await prepareConversation(input);assert.equal(calls,1);inspect?.(result);return result;}
  catch(error){assert.equal(calls,1);throw error;}
}

test('DS may ask one useful preflight question and preserves trip and hotel preferences across the answer',async()=>{
  let clarification;
  try{
    await prepare('上海玩四天，想住地铁旁的酒店',{city:'上海',conditions:{dayCount:4},hotelPreferences:{requested:true,area:'地铁旁'},question:'酒店每间每晚预算多少，几个人入住？',questionField:'hotelBudget'},{context:{transportMode:'transit'}});
    assert.fail('expected question');
  }catch(error){clarification=error;}
  assert.equal(clarification.code,'CLARIFY');assert.match(clarification.message,/按默认安排/);
  const pending={request:'上海玩四天，想住地铁旁的酒店',question:clarification.message,...clarification.pending};
  assert.equal(pending.preflightAsked,true);assert.equal(pending.conditions.dayCount,4);assert.equal(pending.conditions.transportMode,'transit');
  const answered=await prepare('两位成人一间房，每晚600以内',{city:'上海',hotelPreferences:{budgetMax:600,roomCount:1,adultCount:2},question:'请再说一下酒店预算',questionField:'hotelBudget'},{pending});
  assert.deepEqual(answered.hotelPreferences,{requested:true,area:'地铁旁',budgetMax:600,roomCount:1,adultCount:2});
  assert.equal(answered.explicitContext.dayCount,4);assert.equal(answered.explicitContext.transportMode,'transit');
  const planning=JSON.parse(answered.planningPrompt);assert.equal(planning.previousRequest,pending.request);assert.equal(planning.hotelPreferences.budgetMax,600);
});

test('defaults and declined hotels proceed without re-asking or inventing dates, prices or rooms',async()=>{
  const pending={request:'杭州三天需要酒店',question:'什么日期入住，每晚预算多少？',field:'hotelDates',city:'杭州',conditions:{dayCount:3},hotelPreferences:{requested:true},preflightAsked:true};
  const skipped=await prepare('按默认安排直接生成',{question:'入住日期是什么时候？',questionField:'hotelDates'},{pending});
  assert.equal(skipped.city,'杭州');assert.equal(skipped.explicitContext.dayCount,3);assert.deepEqual(skipped.hotelPreferences,{requested:true});
  for(const prompt of ['杭州三天，不需要酒店，直接生成','杭州三天，不住酒店','杭州三天，酒店我已经订好了']){
    const declined=await prepare(prompt,{city:'杭州',conditions:{dayCount:3},hotelPreferences:{requested:true},question:'酒店预算多少？',questionField:'hotelBudget'});
    assert.equal(declined.hotelPreferences.requested,false);
  }
  const direct=await prepare('直接生成上海两天计划',{city:'上海',conditions:{dayCount:2},question:'哪天出发？',questionField:'startDate'});
  assert.equal(direct.explicitContext.dayCount,2);assert.equal(direct.explicitContext.startDate,undefined);
});

test('known travel or hotel values and a rich prompt generate directly; a city remains necessary',async()=>{
  const known=await prepare('上海亲子游四天，酒店每晚800以内，两人一间',{city:'上海',hotelPreferences:{requested:true,budgetMax:800,adultCount:2,roomCount:1},question:'一共几天？',questionField:'dayCount'},{context:{dayCount:4,startDate:'2026-10-20',companions:['children']}});
  assert.equal(known.explicitContext.dayCount,4);assert.equal(known.hotelPreferences.budgetMax,800);
  const rich=await prepare('上海2026-10-20起四天亲子游，每晚800以内酒店两人一间，住静安寺附近',{city:'上海',conditions:{dayCount:4,startDate:'2026-10-20',companions:['children']},hotelPreferences:{requested:true,budgetMax:800,adultCount:2,roomCount:1,area:'静安寺附近'}});
  assert.equal(rich.hotelPreferences.area,'静安寺附近');
  const noBudgetRepeat=await prepare('上海四天酒店每晚500以内',{city:'上海',conditions:{dayCount:4},hotelPreferences:{requested:true,budgetMax:500},question:'酒店每晚多少预算？',questionField:'hotelBudget'});
  assert.equal(noBudgetRepeat.hotelPreferences.budgetMax,500);
  await assert.rejects(prepare('城市还没定，六天住酒店',{conditions:{transportMode:'cycling'},hotelPreferences:{requested:true}}),error=>error.code==='CLARIFY'&&error.pending.field==='city'&&error.pending.conditions.dayCount===6&&error.pending.hotelPreferences.requested);
  const cityAnswered=await prepare('杭州',{city:'杭州',question:'要玩几天？',questionField:'dayCount'},{pending:{request:'城市未定，六天',question:'想去哪座城市？',field:'city',conditions:{dayCount:6,transportMode:'cycling'},hotelPreferences:{requested:true}}});
  assert.equal(cityAnswered.explicitContext.dayCount,6);assert.equal(cityAnswered.city,'杭州');
});

test('pending hotel preferences are bounded user input and strip credentials, facts and arbitrary fields',async()=>{
  const input=await conversationInput({mode:'new',pending:{request:'上海',question:'住宿预算？',field:'hotelBudget',preflightAsked:true,conditions:{dayCount:4},hotelPreferences:{requested:true,budgetMax:600,roomCount:2,adultCount:3,childCount:1,area:'人民广场 sk-secret',requirements:'安静 Bearer secret',checkIn:'2026-10-20',checkOut:'2026-10-23',apiKey:'SECRET',available:true,price:1,provider:'invented'}}});
  assert.equal(input.pending.field,'hotelBudget');assert.equal(input.pending.preflightAsked,true);assert.equal(input.pending.hotelPreferences.budgetMax,600);
  assert.equal(input.pending.hotelPreferences.checkIn,'2026-10-20');assert.ok(!JSON.stringify(input).includes('SECRET'));assert.ok(!JSON.stringify(input).includes('sk-secret'));assert.equal(input.pending.hotelPreferences.available,undefined);
  assert.deepEqual(normalizeHotelPreferences({checkIn:'2026-02-31',budgetMax:'Infinity',roomCount:1.5,childCount:99,area:{},requested:'yes'}),{});
});

const makeCurrent=()=>{
  const {createItinerary,resolveTripContext}=require('../lib/itinerary');
  const route=createItinerary({city:'上海',stops:[0,1,2].map(index=>({name:'地点'+index,city:'上海',location:{lat:31.2+index*.001,lng:121.4}}))},resolveTripContext({dayCount:3}));
  route.hotels={status:'ready',request:{cityName:'上海',landmarkName:'静安寺',maxPrice:600,checkInDate:'2026-10-20',checkOutDate:'2026-10-22',roomCount:1,adultCount:2},selectedId:'hotel-one',candidates:[{id:'hotel-one',name:'真实酒店',city:'上海',address:'上海某路'}]};
  return route;
};

test('hotel-only and combined edits return preferences for enrichment; unrelated explanations stay read-only replies',async()=>{
  const route=makeCurrent();
  const options=plan=>({run:{check(){},call:async(tool,label,fn)=>tool==='conversation'?plan:fn()},conversation:{mode:'edit'},currentRoute:route,apiKey:'fixture-only'});
  const hotelOnly=await prepareConversation({...options({reply:'我会按每晚800以内重新找酒店。',hotelSearch:true,hotelPreferences:{budgetMax:800}}),prompt:'酒店预算改成800'});
  assert.deepEqual(hotelOnly.initial.route,route);assert.notEqual(hotelOnly.initial.route,route);assert.equal(hotelOnly.hotelPreferences.budgetMax,800);assert.equal(hotelOnly.hotelPreferences.area,'静安寺');assert.equal(hotelOnly.hotelPreferences.adultCount,2);assert.equal(hotelOnly.hotelPreferences.checkIn,'2026-10-20');
  const implicitModelSearch=await prepareConversation({...options({reply:'会结合入住安排重新查询。',hotelSearch:true}),prompt:'还是重新查一下吧'});
  assert.equal(implicitModelSearch.hotelPreferences.requested,true);
  const declinedRoute=structuredClone(route);declinedRoute.hotels.status='not-requested';declinedRoute.hotels.candidates=[];declinedRoute.hotels.selectedId=null;
  const resumed=await prepareConversation({...options({reply:'我会重新查询住宿。',hotelSearch:true}),currentRoute:declinedRoute,prompt:'还是重新查一下吧'});
  assert.equal(resumed.hotelPreferences.requested,true);
  const combined=await prepareConversation({...options({hotelPreferences:{budgetMax:700},actions:[{type:'visit',stopId:route.stops[0].id,stayMinutes:20}]}),prompt:'第一站停留20分钟，酒店改成每晚700以内'});
  assert.equal(combined.initial.route.stops[0].visit.stayMinutes,20);assert.equal(combined.hotelPreferences.budgetMax,700);
  const decline=await prepareConversation({...options({reply:'本次不安排酒店。'}),prompt:'不需要酒店'});
  assert.equal(decline.hotelPreferences.requested,false);assert.deepEqual(decline.initial.route.hotels,route.hotels);
  await assert.rejects(prepareConversation({...options({reply:'这里交通方便。',hotelPreferences:{requested:true,budgetMax:600}}),prompt:'为什么选择这家酒店？'}),error=>error.code==='CONVERSATION_REPLY');
  const unrelated=await prepareConversation({...options({actions:[{type:'visit',stopId:route.stops[0].id,stayMinutes:25}]}),prompt:'第一站停留25分钟'});
  assert.equal(unrelated.hotelPreferences,undefined);assert.equal(route.stops[0].visit?.stayMinutes,undefined);
});

test('the DS current-route summary contains existing hotel choices and their request without treating them as new actions',async t=>{
  const route=makeCurrent(),previousFetch=global.fetch;let modelInput;
  route.stops[0].guide={description:'网络地点介绍',openingText:'每日09:00起开放',source:'place-page',url:'https://example.org/place',retrievedAt:'2026-10-17T00:00:00Z'};
  Object.assign(route.hotels.candidates[0],{price:{amount:588,currency:'CNY',unit:'起价',description:'携程参考价'},rating:4.8,stars:4,area:'静安寺',description:'携程酒店简介'});
  t.after(()=>{global.fetch=previousFetch;});
  global.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);modelInput=JSON.parse(body.messages[1].content);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'你已选择真实酒店。'})}}]}));
  };
  await assert.rejects(prepareConversation({run:{check(){},call:async(tool,label,fn)=>fn()},conversation:{mode:'edit'},currentRoute:route,prompt:'看看已选酒店',apiKey:'fixture-only'}),error=>error.code==='CONVERSATION_REPLY');
  assert.equal(modelInput.current.hotels.selectedId,'hotel-one');assert.equal(modelInput.current.hotels.candidates[0].id,'hotel-one');assert.equal(modelInput.current.hotels.request.maxPrice,600);assert.equal(modelInput.current.hotels.preferences.budgetMax,600);assert.equal(modelInput.known.hotelPreferences.checkOut,'2026-10-22');
  assert.equal(modelInput.current.hotels.candidates[0].price.amount,588);assert.equal(modelInput.current.hotels.candidates[0].rating,4.8);assert.equal(modelInput.current.hotels.candidates[0].stars,4);assert.equal(modelInput.current.hotels.candidates[0].area,'静安寺');assert.equal(modelInput.current.hotels.candidates[0].description,'携程酒店简介');assert.deepEqual(modelInput.current.stops[0].guide,route.stops[0].guide);
});

test('DS hotel selection uses a current candidate ID without searching again, and invalid IDs become execution feedback',async()=>{
  const route=makeCurrent();route.hotels.candidates.push({id:'hotel-two',name:'第二家真实酒店',city:'上海',address:'上海另一条路'});
  const options=hotelId=>({run:{check(){},call:async(tool,label,fn)=>tool==='conversation'?{actions:[{type:'hotel',hotelId}]}:fn()},conversation:{mode:'edit'},currentRoute:route,apiKey:'fixture-only',prompt:'选择第二家酒店'});
  const selected=await prepareConversation(options('hotel-two'));
  assert.equal(selected.initial.route.hotels.selectedId,'hotel-two');assert.equal(selected.hotelPreferences,undefined);assert.equal(selected.initial.feedback.status,'completed');assert.equal(route.hotels.selectedId,'hotel-one');
  const invalid=await prepareConversation(options('invented-hotel'));
  assert.equal(invalid.initial.feedback.status,'failed');assert.equal(invalid.initial.route.hotels.selectedId,'hotel-one');assert.match(invalid.initial.feedback.error,/候选/);assert.equal(invalid.hotelPreferences,undefined);
});
