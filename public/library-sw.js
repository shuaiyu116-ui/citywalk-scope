// Cache only a small read-only library shell. Never cache keys, API calls or maps.
const CACHE = 'citywalk-library-shell-v1.7';
const FILES = ['/library.html','/library-page.mjs','/library.mjs','/library-view.mjs','/library.css','/standalone.css','/portable-route.mjs','/roadbook.mjs','/roadbook-view.mjs','/roadbook-photos.mjs','/navigation.mjs','/coordinates.mjs','/share.mjs','/offline-register.mjs','/ui-interactions.mjs'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('citywalk-library-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  const u=new URL(event.request.url);
  if(event.request.method!=='GET'||u.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'&&(u.pathname==='/'||u.pathname==='/index.html'||u.pathname==='/library.html')){
    event.respondWith(fetch(event.request).catch(()=>caches.match('/library.html')));return;
  }
  if(FILES.includes(u.pathname)&&!u.search)event.respondWith(caches.open(CACHE).then(async c=>{
    const cached=await c.match(event.request);return cached||fetch(event.request);
  }));
});
