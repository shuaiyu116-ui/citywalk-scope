import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPortable, parsePortable, MAX_PORTABLE_BYTES } from '../public/portable-route.mjs';
import { renderRoadbook, preparation } from '../public/roadbook.mjs';
import { applySchedule } from '../public/schedule.mjs';
const require=createRequire(import.meta.url), fixture=require('./fixtures/w10-route.cjs');

test('public export excludes private state/proofs at every level; immutable and JSON roundtrip keeps current entities',()=>{
  const r=fixture();applySchedule(r);
  r.planProof={signature:'PRIVATE_SIGNATURE'};r.apiKey='PRIVATE_KEY';r.conversation={secret:'PRIVATE_DIALOG'};r.preferences={secret:'PRIVATE_PREF'};r.origin={secret:'PRIVATE_GPS'};
  r.context.extra='PRIVATE_CONTEXT';r.stops[0].placeProof={signature:'PRIVATE_PLACE'};r.stops[0].schedule.extra='PRIVATE_NESTED';r.days[0].privateNote='PRIVATE_DAY';
  r.stops[0].progress={completed:true,source:'user',schedule:{...r.stops[0].schedule,status:'unknown',timingBasis:'user-history'}};
  const before=JSON.stringify(r), packet=createPortable(r), json=JSON.stringify(packet);
  assert.equal(JSON.stringify(r),before);assert.doesNotMatch(json,/PRIVATE_|planProof|placeProof|apiKey|preferences|conversation|origin/);
  const restored=parsePortable(json);assert.equal(restored.imported,true);assert.equal(restored.trust,'unsigned-readonly');assert.deepEqual(restored.route,packet.route);
  assert.equal(restored.route.legs[1].booking.beforeMinutes,null);assert.equal(restored.route.stops[0].progress.completed,true);
  assert.equal(restored.route.revision.number,4);assert.equal(restored.route.days[1].stopIds.length,0);
  // W09 and raw v1 imports are permitted for read-only conversion, stripped alike.
  assert.deepEqual(parsePortable(JSON.stringify({route:r})).route,packet.route);
  assert.deepEqual(parsePortable(JSON.stringify(r)).route,packet.route);
});

test('illustrated plan retains days, history, bookings, sources and advice without constraint panels',()=>{
  const r=fixture();applySchedule(r);r.stops[0].progress={completed:true,source:'user',schedule:{...r.stops[0].schedule,status:'unknown'}};
  const html=renderRoadbook(createPortable(r));
  for(const text of ['旅行概览','本日为空日','2027-01-01','用户标记已游览 / 原计划','用户预订记录','跨日衔接','用户填写开放规则','查看营业与预约安排','高德导航','带儿童','轮椅/婴儿车','自驾/租车','保存为 PDF'])assert.ok(html.includes(text),text);
  const visible=html.replace(/<script[\s\S]*?<\/script>/g,'');
  assert.doesNotMatch(visible,/本日约束检查|耗时 未知|供应商更新|日内耗时|存在冲突/);
  assert.ok(!/src="https?:/.test(html),'no external resources required offline');
  assert.ok(html.includes('application/json'));assert.ok(html.includes('@media print'));
  const extracted=JSON.parse(html.match(/<script id="route-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(parsePortable(JSON.stringify(extracted)).route,createPortable(r).route);
  assert.ok(renderRoadbook(parsePortable(JSON.stringify(extracted))).includes('所有事实、来源、时间'));
  r.context.companions=['seniors','stroller'];r.context.transportMode='cycling';r.legs[0].mode='taxi';r.legs[2].preferredMode='mixed';r.days.forEach(d=>d.date=null);
  const tips=preparation(r).join(' ');for(const t of ['有老人同行','轮椅/婴儿车','骑行/租车','打车','混合出行','日期尚未填写'])assert.ok(tips.includes(t),t);
});

test('HTML/script/URL injection and key-like free text cannot execute or enter active links',()=>{
  const r=fixture();const attack='</script><img src=x onerror=alert(1)><script>alert(2)</script>';
  r.title=attack;r.summary=attack+' sk-abcdefghijklmnop Bearer secret-token';r.stops[0].name=attack;
  r.stops[0].detailUrl='javascript:alert(3)';r.stops[0].imagePageUrl='https://example.com/?token=PRIVATE_TOKEN';r.days[2].lodging.text=attack;
  const html=renderRoadbook(createPortable(r));assert.ok(html.includes('&lt;/script&gt;'));assert.doesNotMatch(html,/<img src=x|<script>alert|javascript:|PRIVATE_TOKEN|sk-abcdefghijklmnop|Bearer secret-token/);
  assert.equal((html.match(/<script/g)||[]).length,2);
  const embedded=html.match(/<script id="route-data" type="application\/json">([\s\S]*?)<\/script>/)[1];assert.ok(embedded.includes('\\u003c'));assert.equal(JSON.parse(embedded).route.title,attack);
  assert.equal(renderRoadbook(createPortable(r),{interactive:false}).includes('addEventListener'),false);
});

test('offline HTML includes place and hotel image bytes with their descriptions and rejects active image sources',()=>{
  const r=fixture();
  r.hotels={status:'ready',request:{city:'上海'},candidates:[{id:'hotel-a',name:'测试住宿',city:'上海',description:'步行可达目的地',source:'ctrip',provider:'ctrip-mcp'}],selectedId:'hotel-a'};
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=';
  const html=renderRoadbook(createPortable(r),{photos:{[r.stops[0].id]:png,'hotel:hotel-a':png,[r.stops[1].id]:'data:image/svg+xml;base64,PHN2Zz4=',unrelated:'https://example.com/photo.jpg'}});
  assert.equal((html.match(/<img src="data:image\/png;base64,/g)||[]).length,2);
  assert.ok(html.includes('测试住宿'));assert.ok(html.includes('步行可达目的地'));
  assert.match(html,/class="stop-layout"/);assert.match(html,/grid-template-columns:60mm/);
  const visible=html.replace(/<script[\s\S]*?<\/script>/g,'');
  assert.doesNotMatch(visible,/使用与恢复边界|永久恢复凭据|src="https?:|src="data:image\/svg/);
});

test('broken, unsupported, huge and structurally inconsistent imports fail without trusting signatures',()=>{
  assert.throws(()=>parsePortable('{'),/JSON/);assert.throws(()=>parsePortable('null'));assert.throws(()=>parsePortable(' '.repeat(MAX_PORTABLE_BYTES+1)),/8 MB/);
  assert.throws(()=>parsePortable(JSON.stringify({format:'citywalk-route',formatVersion:99,route:fixture()})),/版本/);
  for(const mutate of [r=>r.stops[0].location.lat=200,r=>r.stops[1].id=r.stops[0].id,r=>r.days[0].stopIds.reverse(),r=>r.legs.pop(),r=>r.schemaVersion=2,r=>r.stops[1].progress={completed:true},r=>r.days[0]=null]){
    const r=fixture();mutate(r);assert.throws(()=>parsePortable(JSON.stringify({route:r})));
  }
});
