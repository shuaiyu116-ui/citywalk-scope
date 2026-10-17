import { createPortable, parsePortable, MAX_PORTABLE_BYTES } from './portable-route.mjs';
import { renderRoadbook } from './roadbook.mjs';
import { collectRoadbookPhotos } from './roadbook-photos.mjs';
export { collectRoadbookPhotos } from './roadbook-photos.mjs';

export function downloadFile(contents, type, name) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Fast local snapshot for preview and library saves. Export also downloads
// missing provider images with collectRoadbookPhotos below.
export function cachedPhotos(route) {
  const result = {}; let bytes = 0;
  const imagesByStop = new Map();
  for (const card of document.querySelectorAll('#scheduleDetails .travel-stop[data-stop-id], #storyboard .story-card[data-stop-id], #scheduleDetails .travel-hotel[data-hotel-id]')) {
    const image = card.querySelector('img');
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) continue;
    const key = card.dataset.stopId || `hotel:${card.dataset.hotelId}`;
    const images = imagesByStop.get(key) || [];
    images.push(image); imagesByStop.set(key, images);
  }
  for (const key of [...route.stops.map(stop => stop.id), ...(route.hotels?.candidates || []).map(hotel => `hotel:${hotel.id}`)]) {
    for (const image of imagesByStop.get(key) || []) try {
      const canvas = document.createElement('canvas'), ratio = Math.min(1, 840 / image.naturalWidth, 520 / image.naturalHeight);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.76);
      if (data.length <= 600000 && bytes + data.length <= 5 * 1024 * 1024) { result[key] = data; bytes += data.length; break; }
    } catch { /* Provider images can instead use the bounded same-origin reader. */ }
  }
  return result;
}

export function createRoadbookView({ getRoute, hasDraft, toast }) {
  const dialog = document.getElementById('roadbookDialog');
  const frame = document.getElementById('roadbookPreview'), status = document.getElementById('roadbookStatus');
  const htmlButton = document.getElementById('downloadRoadbook'), jsonButton = document.getElementById('downloadRoadbookJson'), printButton = document.getElementById('printRoadbook');
  const file = document.getElementById('importRoadbookJson');
  let packet = null, photos = {}, sequence = 0, photoController = null, loadingPhotos = false;
  const buttons = enabled => { htmlButton.disabled = !enabled; jsonButton.disabled = !enabled; printButton.disabled = true; };
  const show = () => {
    buttons(false);
    const html = renderRoadbook(packet, { photos, interactive: false });
    frame.onload = () => { if (packet && dialog.open) printButton.disabled = loadingPhotos; };
    frame.srcdoc = html;
    htmlButton.disabled = loadingPhotos; jsonButton.disabled = false;
    status.textContent = `${packet.route.days.length} 天 / ${packet.route.stops.length} 站。${!packet.imported && hasDraft() ? '尚有编辑草稿，本次未包含。' : ''}${loadingPhotos ? '正在准备离线图片…' : `已嵌入 ${Object.keys(photos).length} 张照片，可下载离线阅读。`}`;
  };
  const preparePhotos = async (route, request) => {
    const controller = new AbortController(); photoController = controller; loadingPhotos = true; show();
    const prepared = await collectRoadbookPhotos(route, { photos, signal: controller.signal, onProgress: progress => {
      if (request === sequence && dialog.open) status.textContent = `正在准备离线图片 ${progress.completed}/${progress.total}，已嵌入 ${progress.embedded} 张…`;
    } });
    if (request !== sequence || !dialog.open) return;
    photos = prepared; loadingPhotos = false; photoController = null; show();
  };
  const current = async () => {
    const request = ++sequence; photoController?.abort(); loadingPhotos = false; file.value = '';
    try {
      const route = getRoute();
      if (!route) throw new Error('当前还没有已提交行程；可先导入 JSON 查看。');
      packet = createPortable(route); photos = cachedPhotos(route); await preparePhotos(route, request);
    } catch (err) { if (request !== sequence || !dialog.open) return; loadingPhotos = false; packet = null; photos = {}; frame.srcdoc = ''; buttons(false); status.textContent = err.message; }
  };
  document.getElementById('roadbookButton').addEventListener('click', () => { dialog.showModal(); current(); });
  document.getElementById('closeRoadbook').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { sequence++; photoController?.abort(); photoController = null; loadingPhotos = false; packet = null; photos = {}; frame.onload = null; frame.srcdoc = ''; file.value = ''; });
  document.getElementById('roadbookCurrent').addEventListener('click', current);
  file.addEventListener('change', async () => {
    const selected = file.files[0]; if (!selected) return;
    const request = ++sequence; photoController?.abort(); loadingPhotos = false; buttons(false); status.textContent = '正在读取本地文件…';
    try {
      if (selected.size > MAX_PORTABLE_BYTES) throw new Error('JSON 文件不能超过 8 MB。');
      const contents = await selected.text();
      if (request !== sequence || !dialog.open) return;
      packet = parsePortable(contents); photos = {}; await preparePhotos(packet.route, request);
    } catch (err) {
      if (request !== sequence || !dialog.open) return;
      packet = null; photos = {}; frame.srcdoc = ''; buttons(false);
      status.textContent = `${err.message} 当前网页行程未改变；可重新选择文件或点击“使用当前已提交行程”。`;
    } finally { if (request === sequence) file.value = ''; }
  });
  htmlButton.addEventListener('click', () => {
    if (!packet) return;
    try { downloadFile(renderRoadbook(packet, { photos }), 'text/html;charset=utf-8', 'citywalk-roadbook.html'); toast('已下载离线路书，可直接打开并打印'); }
    catch (err) { status.textContent = err.message; }
  });
  jsonButton.addEventListener('click', () => { if (packet) downloadFile(JSON.stringify(packet, null, 2), 'application/json', 'citywalk-route.json'); });
  printButton.addEventListener('click', () => {
    if (!packet || printButton.disabled) return;
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch { status.textContent = '此浏览器限制内嵌打印，请下载 HTML 打开后打印 / 保存为 PDF。'; }
  });
  return { exportJson() {
    try {
      if (!getRoute()) throw new Error('请先生成行程。');
      downloadFile(JSON.stringify(createPortable(getRoute()), null, 2), 'application/json', 'citywalk-route.json');
      toast('已导出当前已提交行程（脱敏、无内部签名）；可在路书中导入只读预览');
    } catch (err) { toast(err.message); }
  } };
}
