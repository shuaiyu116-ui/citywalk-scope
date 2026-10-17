import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedPhotos } from '../public/roadbook-view.mjs';
import { refreshStopTimes } from '../public/schedule-view.mjs';
import { collectRoadbookPhotos, offlinePhotoRequest } from '../public/roadbook-photos.mjs';

const image = (id, extra = {}) => ({id,complete:true,naturalWidth:640,naturalHeight:400,...extra});
const card = (id, photo, time = {textContent:''}) => ({dataset:{stopId:id},querySelector: selector => selector === 'time' ? time : photo});
function photoDocument(cards) {
  return {querySelectorAll: () => cards, createElement: () => {
    let drawn;
    return {getContext: () => ({drawImage: photo => {drawn=photo;}}),toDataURL: () => {if(drawn.tainted)throw Error('CORS');return `data:image/jpeg;base64,${drawn.id}`;}};
  }};
}
test('export photos map filtered and reordered cards by stop ID', () => {
  const previous=globalThis.document;
  globalThis.document=photoDocument([card('c',image('photo-c')),card('b',image('photo-b')),card('a',image('photo-a'))]);
  try { assert.deepEqual(cachedPhotos({stops:[{id:'a'},{id:'b'},{id:'c'}]}),{a:'data:image/jpeg;base64,photo-a',b:'data:image/jpeg;base64,photo-b',c:'data:image/jpeg;base64,photo-c'}); }
  finally {globalThis.document=previous;}
});
test('export falls back to readable same-stop image and skips undecoded photos', () => {
  const previous=globalThis.document;
  globalThis.document=photoDocument([card('b',image('locked',{tainted:true})),card('c',image('loading',{complete:false})),card('b',image('readable')),card('unrelated',image('other'))]);
  try { assert.deepEqual(cachedPhotos({stops:[{id:'a'},{id:'b'},{id:'c'}]}),{b:'data:image/jpeg;base64,readable'}); }
  finally {globalThis.document=previous;}
});
test('projected story and sidebar times follow stable IDs instead of global indices', () => {
  const a={textContent:''},c={textContent:''},cSidebar={textContent:''};
  const root={querySelectorAll:()=>[card('c',null,c),card('a',null,a),card('c',null,cSidebar)]};
  refreshStopTimes({stops:[{id:'a',schedule:{arrival:{time:'09:00'}}},{id:'b',schedule:{arrival:{time:'11:00'}}},{id:'c',schedule:{arrival:{time:'15:30'}}}]},root);
  assert.equal(a.textContent,'09:00');assert.equal(c.textContent,'15:30');assert.equal(cSidebar.textContent,'15:30');
});

const jpeg = Uint8Array.from([255,216,255,224,0,0]);
const photoResponse = () => new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
const photoUrl = suffix => `https://dimg04.c-ctrip.com/images/${suffix}.jpg`;
test('offline photo requests use only bundled assets and the fixed same-origin CDN proxy', () => {
  assert.equal(offlinePhotoRequest('/assets/reference.jpg','http://localhost:3000'),'/assets/reference.jpg');
  assert.match(offlinePhotoRequest(photoUrl('hotel')),/^\/api\/location-photo\/image\?url=/);
  const proxy=offlinePhotoRequest('https://img1.baidu.com/it/photo');
  assert.equal(offlinePhotoRequest(proxy),proxy);
  for (const url of ['https://example.com/photo.jpg','http://127.0.0.1/private','/api/capabilities','https://dimg04.c-ctrip.com.evil.example/x.jpg','https://user@dimg04.c-ctrip.com/x.jpg',photoUrl('test')+'?token=private','data:image/svg+xml,script']) assert.equal(offlinePhotoRequest(url),'');
});
test('offline export downloads unloaded stop and hotel photos, deduplicates sources, and retains cached images on failure', async () => {
  const requests=[];
  const route={stops:[{id:'a',image:photoUrl('same')},{id:'b',image:photoUrl('fail')},{id:'c',image:photoUrl('cached')}],hotels:{candidates:[{id:'hotel-1',image:photoUrl('same')}]}};
  const cached='data:image/jpeg;base64,/9j/4AAA';
  const result=await collectRoadbookPhotos(route,{photos:{c:cached},fetchImpl:async request=>{
    requests.push(request);
    if(request.includes('fail'))return new Response('missing',{status:502});
    return photoResponse();
  }});
  assert.equal(result.a,cached);assert.equal(result['hotel:hotel-1'],cached);assert.equal(result.c,cached);assert.equal(result.b,undefined);
  assert.equal(requests.length,2);assert.ok(requests.every(request=>request.startsWith('/api/location-photo/image?')));
});
test('offline export rejects disguised images and limits concurrent downloads to three', async () => {
  let active=0,maxActive=0;
  const route={stops:Array.from({length:6},(_,i)=>({id:String(i),image:photoUrl(String(i))}))};
  const result=await collectRoadbookPhotos(route,{fetchImpl:async request=>{
    active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,2));active--;
    if(request.includes('0.jpg'))return new Response('<html>not a photo</html>',{headers:{'content-type':'image/jpeg'}});
    if(request.includes('1.jpg'))return new Response(jpeg,{headers:{'content-type':'image/svg+xml'}});
    return photoResponse();
  }});
  assert.equal(maxActive,3);assert.equal(Object.keys(result).length,4);assert.equal(result['0'],undefined);assert.equal(result['1'],undefined);
});
test('offline export timeout keeps available photos and aborts pending image work', async () => {
  let aborted=false;
  const result=await collectRoadbookPhotos({stops:[{id:'saved'},{id:'slow',image:photoUrl('slow')}]},{photos:{saved:'data:image/jpeg;base64,/9j/4AAA'},timeoutMs:5,fetchImpl:async(_request,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true}))});
  assert.equal(aborted,true);assert.deepEqual(Object.keys(result),['saved']);
});
