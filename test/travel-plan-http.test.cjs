const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
test('HTTP preflight answers flow into DS/MCP hotels, signed choice and the public roadbook',async t=>{
  const child=spawn(process.execPath,['--require','./test/fixtures/travel-plan-offline.cjs','server.js'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.once('error',reject);child.stdout.on('data',bytes=>{const found=bytes.toString().match(/localhost:(\d+)/);if(found){clearTimeout(timer);resolve('http://localhost:'+found[1]);}});});
  const post=async body=>{
    const response=await fetch(base+'/api/agent-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200);
    const events=(await response.text()).trim().split('\n').map(JSON.parse),last=events.at(-1);
    assert.equal(last.type,'result',JSON.stringify(last));return last.result;
  };
  const first=await post({prompt:'上海玩三天，需要酒店'});
  assert.equal(first.conversation.status,'clarify');assert.equal(first.conversation.pending.preflightAsked,true);
  const result=await post({prompt:'11月1日入住3日退房，两人一间每晚600以内',conversation:{mode:'new',pending:first.conversation.pending}});
  assert.equal(result.conversation.status,'candidate');assert.equal(result.route.hotels.status,'ready');assert.equal(result.route.hotels.candidates.length,2);
  assert.equal(result.route.hotels.request.maxPrice,600);assert.equal(result.route.hotels.request.roomCount,1);assert.equal(result.route.hotels.request.checkOutDate,'2026-11-03');
  assert.match(result.route.stops[0].guide.openingText,/周二/);assert.equal(result.agent.stopReason,'model-stopped');
  const {EditSession}=await import('../public/itinerary-editor.mjs');
  const session=new EditSession(result.route);session.stage({type:'hotel',hotelId:'ctrip-hotel-http-1'});
  const route=await session.commit(async()=>assert.fail('selection should reuse roads'),{allowIncomplete:true});
  const reply=await post({prompt:'为什么选择这家酒店？',currentRoute:route,conversation:{mode:'edit'}});
  assert.equal(reply.conversation.status,'reply');assert.match(reply.conversation.reply,/测试酒店1/);
  const {createPortable}=await import('../public/portable-route.mjs');const {renderRoadbook}=await import('../public/roadbook.mjs');
  const packet=createPortable(route);assert.equal(packet.route.hotels.request.adultCount,2);assert.equal(packet.route.hotels.selectedId,'ctrip-hotel-http-1');
  assert.match(renderRoadbook(packet),/已选 · 测试酒店1/);
});
