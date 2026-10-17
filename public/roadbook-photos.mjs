// Offline export downloads only the app's fixed image providers through its
// same-origin proxy, or bundled assets. These limits also bound large trips.
export const MAX_OFFLINE_PHOTO = 1.5 * 1024 * 1024;
export const MAX_OFFLINE_PHOTOS = 12 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function offlinePhotoRequest(value, origin = globalThis.location?.origin || 'http://localhost') {
  try {
    const url = new URL(value, origin);
    if (url.username || url.password || url.port && url.origin !== origin) return '';
    if (url.origin === origin) {
      if (url.pathname.startsWith('/assets/') && /\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname)) return url.pathname + url.search;
      if (url.pathname === '/api/location-photo/image') return offlinePhotoRequest(url.searchParams.get('url'), origin);
      return '';
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(/^(?:img\d+|t\d+)\.baidu\.com$/.test(host)
      || /^[a-z0-9.-]+\.c-ctrip\.com$/.test(host) || host === 'upload.wikimedia.org')) return '';
    if ([...url.searchParams.keys()].some(k => /token|key|auth|secret|signature|credential|proof/i.test(k))) return '';
    return `/api/location-photo/image?${new URLSearchParams({ url: url.href })}`;
  } catch { return ''; }
}

function imageType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return 'image/png';
  const ascii = (start,end) => String.fromCharCode(...bytes.subarray(start,end));
  if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a$/.test(ascii(0,6))) return 'image/gif';
  return '';
}

function rawDataUrl(bytes, type) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${type};base64,${btoa(binary)}`;
}

async function encodePhoto(bytes, type) {
  // A same-origin response can be decoded without a tainted canvas. Resizing
  // keeps fifty-stop itineraries readable without retaining full-size photos.
  if (typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
    let image;
    try {
      image = await createImageBitmap(new Blob([bytes], { type }));
      const ratio = Math.min(1, 840 / image.width, 520 / image.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.76);
      if (data.length <= MAX_OFFLINE_PHOTO) return data;
    } catch { /* Valid raster bytes below remain a usable offline fallback. */ }
    finally { image?.close(); }
  }
  if (bytes.length * 4 / 3 + 64 > MAX_OFFLINE_PHOTO) return '';
  return rawDataUrl(bytes, type);
}

async function readPhoto(request, parentSignal, fetchImpl) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal.aborted) return '';
  parentSignal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 8500);
  try {
    const response = await fetchImpl(request, { signal: controller.signal, credentials: 'same-origin' });
    const type = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase().trim();
    if (!response.ok || !IMAGE_TYPES.has(type) || Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
      await response.body?.cancel(); return '';
    }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > MAX_DOWNLOAD_BYTES) { await reader.cancel(); return ''; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (parentSignal.aborted) return '';
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const verifiedType = imageType(bytes);
    return verifiedType ? await encodePhoto(bytes, verifiedType) : '';
  } catch { return ''; }
  finally { clearTimeout(timer); parentSignal.removeEventListener('abort', abort); }
}

export async function collectRoadbookPhotos(route, { photos = {}, signal, onProgress = () => {}, fetchImpl = globalThis.fetch, timeoutMs = 25000 } = {}) {
  const entities = [...(route.stops || []).map(stop => ({ key: stop.id, image: stop.image })),
    ...(route.hotels?.candidates || []).map(hotel => ({ key: `hotel:${hotel.id}`, image: hotel.image }))];
  const result = {}; let bytes = 0;
  const add = (key, data) => {
    if (typeof data !== 'string' || data.length > MAX_OFFLINE_PHOTO || bytes + data.length > MAX_OFFLINE_PHOTOS
      || !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
    result[key] = data; bytes += data.length; return true;
  };
  for (const entity of entities) add(entity.key, photos[entity.key]);
  if (globalThis.navigator?.onLine === false || typeof fetchImpl !== 'function') return result;
  const jobs = entities.filter(entity => !result[entity.key]).map(entity => ({...entity, request: offlinePhotoRequest(entity.image)})).filter(entity => entity.request);
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) return result;
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs); let next = 0, complete = 0;
  const downloads = new Map();
  try {
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
      while (next < jobs.length && !controller.signal.aborted && bytes < MAX_OFFLINE_PHOTOS) {
        const job = jobs[next++];
        let download = downloads.get(job.request);
        if (!download) { download = readPhoto(job.request, controller.signal, fetchImpl); downloads.set(job.request, download); }
        const data = await download;
        if (!controller.signal.aborted) add(job.key, data);
        onProgress({ completed: ++complete, total: jobs.length, embedded: Object.keys(result).length });
      }
    }));
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  return result;
}
