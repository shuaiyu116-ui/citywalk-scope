export async function enableOffline() {
  if (!('serviceWorker' in navigator)) return '此浏览器不支持离线入口，请下载 HTML 路书。';
  try {
    const registration = await navigator.serviceWorker.register('/library-sw.js');
    let timer;
    try { await Promise.race([navigator.serviceWorker.ready, new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cache timeout')),12000);})]); }
    finally { clearTimeout(timer); }
    return registration.active ? '离线入口已就绪：请收藏 /library.html；首次需联网打开，浏览器清缓存后需重新准备。' : '正在准备离线入口，请稍后联网打开本机行程库。';
  } catch { return '离线入口缓存失败；本机收藏仍可保留，建议下载 HTML 路书。HTTPS 或 localhost 才支持离线缓存。'; }
}
