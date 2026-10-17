const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePlaceIdentities } = require('../lib/place-identity');
const poi = (id, overrides = {}) => ({ id, name:'云林寺',city:'杭州市',address:'西湖区灵隐路法云弄1号',source:'ctrip',provider:'ctrip-mcp',location:{lat:30.24,lng:120.1}, ...overrides });
const request = (targetId, candidates, target = {}) => ({targetId,target:{name:'灵隐寺',city:'杭州',...target},candidates});
const response = decisions => new Response(JSON.stringify({usage:{prompt_tokens:10,completion_tokens:10},choices:[{message:{content:JSON.stringify({decisions})}}]}));

test('AI alias decision selects only returned real POI and sends no coordinate, URL or credential in model input',async()=>{
  let calls=0;
  const result=await resolvePlaceIdentities([request('temple',[poi('ctrip-1',{detailUrl:'https://example.invalid/private',price:'must-not-copy'})])],{apiKey:'fixture-private-key',fetchImpl:async(url,options)=>{
    calls++;const body=JSON.parse(options.body);const input=JSON.parse(body.messages[1].content);
    assert.deepEqual(input.requests[0].candidates,[{candidateId:'ctrip-1',name:'云林寺',city:'杭州市',address:'西湖区灵隐路法云弄1号'}]);
    assert.ok(!options.body.includes('fixture-private-key'));assert.ok(!options.body.includes('https://example.invalid'));assert.ok(!options.body.includes('must-not-copy'));
    return response([{targetId:'temple',candidateId:'ctrip-1',decision:'same',reason:'云林寺是灵隐寺的别名',location:{lat:0,lng:0},price:0}]);
  }});
  assert.equal(calls,1);assert.equal(result[0].decision,'same');assert.equal(result[0].candidateId,'ctrip-1');assert.match(result[0].reason,/AI 判断/);assert.ok(!('location' in result[0]));
});

test('invented IDs, wrong city, invalid coordinates, mock data, uncertain and duplicate model decisions are never adopted',async()=>{
  const requests=[request('invented',[poi('real')]),request('city',[poi('wrong',{city:'南京'})]),request('coordinate',[poi('invalid',{location:{lat:NaN,lng:120}})]),request('mock',[poi('mock',{source:'mock'})]),request('uncertain',[poi('maybe')]),request('duplicate',[poi('dup')])];
  const results=await resolvePlaceIdentities(requests,{apiKey:'fixture-key',fetchImpl:async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.deepEqual(input.requests.map(r=>r.targetId),['invented','uncertain','duplicate']);
    return response([{targetId:'invented',candidateId:'not-returned',decision:'same'},{targetId:'city',candidateId:'wrong',decision:'same'},{targetId:'coordinate',candidateId:'invalid',decision:'same'},{targetId:'mock',candidateId:'mock',decision:'same'},{targetId:'uncertain',candidateId:'maybe',decision:'uncertain'},{targetId:'duplicate',candidateId:'dup',decision:'same'},{targetId:'duplicate',candidateId:'dup',decision:'same'}]);
  }});
  assert.equal(results.length,requests.length);assert.ok(results.every(r=>r.decision==='uncertain'&&r.candidateId===null));
});

test('explicit user address mismatch blocks AI adoption while a model-only address is never a hard constraint',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return response([{targetId:'model-address',candidateId:'same',decision:'same',reason:'fixture-private-key https://example.invalid'}]);};
  const result=await resolvePlaceIdentities([request('user-address',[poi('same')],{addressHint:'不同街道100号',addressHintSource:'user'}),request('model-address',[poi('same')],{addressHint:'模型虚构的地址',addressHintSource:'model'})],{apiKey:'fixture-private-key',fetchImpl});
  assert.equal(calls,1);assert.equal(result[0].decision,'uncertain');assert.equal(result[1].decision,'same');assert.ok(!JSON.stringify(result).includes('fixture-private-key'));assert.ok(!JSON.stringify(result).includes('https://example.invalid'));
  const unavailable=await resolvePlaceIdentities([request('blocked',[poi('other',{city:'南京'})])],{fetchImpl:()=>assert.fail('No eligible candidates means no model call')});assert.equal(unavailable[0].decision,'uncertain');
});
