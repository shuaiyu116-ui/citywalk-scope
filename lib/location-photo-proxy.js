'use strict';

const cache = new Map();
const pending = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
let cacheBytes = 0;

function baiduImageUrl(value) {
  try {
    const url = new URL(value);
    // This proxy accepts Baidu thumbnail hosts only, never arbitrary URLs.
    if (url.protocol !== 'https:' || !/^(?:img\d+|t\d+)\.baidu\.com$/i.test(url.hostname)
      || url.port || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  return '';
}

async function downloadImage(url) {
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual', signal,
      headers: {
        Accept: 'image/webp,image/png,image/jpeg,image/gif',
        Referer: 'https://image.baidu.com/',
        'User-Agent': 'CitywalkScope/1.0'
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      const next = location && baiduImageUrl(new URL(location, url).href);
      if (!next || redirects === 3) throw new Error('Unsupported image redirect');
      url = next;
      continue;
    }
    const declaredType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !/^image\/(jpeg|png|webp|gif)$/.test(declaredType)
      || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      throw new Error('Image provider returned an invalid response');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) throw new Error('Image exceeds size limit');
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    const contentType = imageType(data);
    if (!contentType) throw new Error('Image provider returned no image data');
    return { data, contentType };
  }
}

async function getLocationPhotoBytes(value) {
  const url = baiduImageUrl(value);
  if (!url) {
    const error = new Error('Unsupported image URL');
    error.statusCode = 400;
    throw error;
  }
  const key = url.href;
  for (const [cacheKey, entry] of cache) {
    if (entry.expiresAt <= Date.now()) {
      cache.delete(cacheKey);
      cacheBytes -= entry.data.length;
    }
  }
  const cached = cache.get(key);
  if (cached) return cached;
  if (pending.has(key)) return pending.get(key);
  const task = downloadImage(url).then(photo => {
    while (cache.size >= 64 || cacheBytes + photo.data.length > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).data.length;
      cache.delete(oldest);
    }
    const entry = { ...photo, expiresAt: Date.now() + CACHE_TTL_MS };
    cache.set(key, entry);
    cacheBytes += photo.data.length;
    return entry;
  });
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

module.exports = { getLocationPhotoBytes };
