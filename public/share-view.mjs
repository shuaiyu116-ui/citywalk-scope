import { makeShareLink, readShare, copyIntent } from './share.mjs';
import { createPortable } from './portable-route.mjs';
import { renderRoadbook } from './roadbook.mjs';
import { downloadFile } from './roadbook-view.mjs';

export function createShareView({ getRoute = () => null, blocked = () => false, adopt, toast = () => {} } = {}) {
  const $ = id => document.getElementById(id), box = $('shareDialog'), frame = $('sharePreview'), status = $('shareStatus');
  const copy = $('copyShareLink'), rebuild = $('rebuildShared'), accept = $('acceptShared'), cancel = $('cancelShareCopy');
  let packet = null, url = '', candidate = null, controller = null, sequence = 0, base = null, expiresAt = null;
  const expired = () => expiresAt !== null && Date.now() >= expiresAt;
  function stop() { sequence++; controller?.abort(); controller = null; cancel.hidden = true; }
  function reset() {
    stop(); packet = null; candidate = null; url = ''; expiresAt = null; frame.srcdoc = ''; $('shareLink').value = '';
    copy.disabled = true; rebuild.disabled = true; accept.hidden = true; $('shareJson').disabled = true;
  }
  function showPacket(value) {
    frame.srcdoc = renderRoadbook(value, { interactive: false });
    $('shareJson').disabled = false;
  }
  const show = () => { if (box.tagName === 'DIALOG' && !box.open) box.showModal(); };
  async function incoming() {
    reset(); show(); $('shareOutgoing').hidden = true; $('shareIncoming').hidden = false;
    const token = sequence; status.textContent = '正在读取分享快照…';
    try {
      const data = await readShare(location.hash);
      if (token !== sequence) return;
      packet = data.packet; expiresAt = data.expiresAt; url = new URL('/share.html', location.href).href + location.hash;
      showPacket(packet); rebuild.disabled = false;
      status.textContent = `分享只读 · 版本 ${packet.route.revision.number} · ${packet.route.days.length} 天 / ${packet.route.stops.length} 站。${data.expiresAt ? '约定有效期至 ' + new Date(data.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '（北京时间）。' : '未设自动过期。'} 内容未重新核实，未替换当前行程。`;
    } catch (error) { if (token === sequence) status.textContent = error.message; }
  }
  $('shareButton')?.addEventListener('click', () => {
    reset(); show(); $('shareOutgoing').hidden = false; $('shareIncoming').hidden = true;
    $('shareConsent').checked = false;
    try {
      packet = createPortable(getRoute()); showPacket(packet);
      status.textContent = `已冻结当前提交版本 ${packet.route.revision.number}，不含草稿或未采用候选。先检查下方完整公开内容，再生成链接。`;
    } catch { status.textContent = '请先生成一条行程；也可在路书中导入 JSON 只读查看。'; }
  });
  $('generateShare')?.addEventListener('click', async () => {
    if (!packet || !$('shareConsent').checked) { status.textContent = '请先预览并勾选公开内容确认。'; return; }
    const token = ++sequence; copy.disabled = true; $('shareLink').value = ''; status.textContent = '正在生成完整版本链接…';
    try {
      const result = await makeShareLink(packet.route, location.href, { days: Number($('shareExpiry').value) });
      if (token !== sequence) return;
      url = result.url; packet = result.packet; $('shareLink').value = url; copy.disabled = false;
      status.textContent = `链接已生成（${url.length} 字符）。不使用服务器或浏览器存储；任何取得完整链接的人都能读取。修改原行程不会改变此链接。${['localhost','127.0.0.1','[::1]'].includes(location.hostname) ? '当前是本机地址，其他设备无法直接访问；对外使用需在已部署网站生成链接。' : ''}`;
    } catch (error) { if (token === sequence) status.textContent = error.message; }
  });
  copy.addEventListener('click', async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); status.textContent = '已复制完整链接。若聊天软件截断，请使用 JSON / HTML 文件。'; }
    catch { $('shareLink').focus(); $('shareLink').select(); status.textContent = '剪贴板不可用，已选中链接，请手动复制；不需要开启本机存储。'; }
  });
  $('shareJson').addEventListener('click', () => { if (packet) downloadFile(JSON.stringify(packet, null, 2), 'application/json', 'citywalk-shared-route.json'); });
  rebuild.addEventListener('click', async () => {
    if (!packet) return;
    if (expired()) { reset(); status.textContent = '此分享已超过约定有效期，请索取新链接。'; return; }
    if (!adopt) { location.assign(new URL('/?copy=share', location.href).href + location.hash); return; }
    if (blocked()) { status.textContent = '请先结束规划、提交或放弃当前编辑草稿，再复制。'; return; }
    stop(); candidate = null; accept.hidden = true; rebuild.disabled = true; cancel.hidden = false;
    const token = sequence; base = getRoute(); controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(), 125000);
    status.textContent = '正在逐点重新查询（最多约 2 分钟）；原行程保持不变…';
    try {
      const response = await fetch('/api/share/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(copyIntent(packet.route)), signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '复制服务不可用，请重试。');
      if (token !== sequence) return;
      candidate = data.route; showPacket(createPortable(candidate)); accept.hidden = false;
      status.textContent = '新副本已重新匹配全部地点。请查看新预览：新身份，交通与营业仍可能未知；原作者的同行、住宿、预订、已游览、自填营业规则及自由文字已清除。确认后才替换当前行程，交通随后重算，可撤销。';
    } catch (error) {
      if (token === sequence) { status.textContent = error.name === 'AbortError' ? '复制已取消或超时，可重试；原行程未变。' : error.message; showPacket(packet); }
    } finally { clearTimeout(timer); if (token === sequence) { controller = null; cancel.hidden = true; rebuild.disabled = false; } }
  });
  cancel.addEventListener('click', () => { stop(); rebuild.disabled = !packet; status.textContent = '复制已取消，原行程未改变，可重试。'; });
  accept.addEventListener('click', async () => {
    if (!candidate) return;
    try {
      if (expired()) throw new Error('此分享已超过约定有效期，请索取新链接。');
      if (blocked() || getRoute() !== base) throw new Error('当前行程已改变或仍有草稿，请重新核对分享副本。');
      accept.disabled = true;
      await adopt(candidate); candidate = null;
      if (box.tagName === 'DIALOG') box.close();
      history.replaceState(null, '', '/'); toast('已采用自己的新副本，交通正在重算；可在编辑器撤销');
    } catch (error) { status.textContent = error.message; }
    finally { accept.disabled = false; }
  });
  $('closeShare')?.addEventListener('click', () => box.tagName === 'DIALOG' ? box.close() : location.assign('/'));
  if (box.tagName === 'DIALOG') box.addEventListener('close', reset);
  window.addEventListener('hashchange', () => { if (!adopt || location.hash.startsWith('#cw') || new URL(location.href).searchParams.get('copy') === 'share') incoming(); });
  return { incoming };
}
