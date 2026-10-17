import { createPortable, parsePortable } from './portable-route.mjs';

export const MAX_SHARE_URL = 60000;
const MAX_RAW = 512 * 1024;
const encoder = new TextEncoder();
export class ShareError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function available() {
  if (!globalThis.CompressionStream || !globalThis.DecompressionStream || !globalThis.crypto?.subtle)
    throw new ShareError('unsupported', '此浏览器无法处理压缩分享链接，请使用新版浏览器与 HTTPS，或改用路书 JSON / HTML 文件。');
}
async function bytes(stream, limit) {
  const reader = stream.getReader(), parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) throw new ShareError('large', '行程超出链接容量，请改用路书 JSON / HTML 文件。');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const result = new Uint8Array(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
const digest = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
const base64 = data => btoa(Array.from(data, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The entire public version travels in the fragment, never a server disk/key store.
export async function makeShareLink(route, base, { days = 0, now = Date.now() } = {}) {
  available();
  if (![0, 7, 30].includes(days)) throw new ShareError('invalid', '分享有效期无效。');
  const packet = createPortable(route, { exportedAt: new Date(now).toISOString() });
  const data = encoder.encode(JSON.stringify({ version: 1, expiresAt: days ? now + days * 86400000 : null, packet }));
  if (data.length > MAX_RAW) throw new ShareError('large', '完整快照超出链接容量，请使用路书 JSON / HTML 文件分享。');
  const zipped = await bytes(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip')), 45000);
  const url = new URL('/share.html', base); url.search = ''; url.hash = `cw1=${await digest(zipped)}.${base64(zipped)}`;
  if (url.href.length > MAX_SHARE_URL) throw new ShareError('large', '分享链接过长，请使用路书 JSON / HTML 文件分享。');
  return { url: url.href, packet };
}
export async function readShare(hash, { now = Date.now() } = {}) {
  if (!hash || hash === '#cw1=') throw new ShareError('missing', '此链接没有行程内容（不存在或内容已被截掉），请向分享者索取完整链接或 JSON 文件。');
  available();
  if (hash.length > MAX_SHARE_URL) throw new ShareError('large', '分享链接超出容量，请索取 JSON / HTML 文件。');
  const match = /^#cw1=([a-f0-9]{64})\.([a-zA-Z0-9_-]+)$/.exec(hash);
  if (!match) throw new ShareError('damaged', '分享链接损坏或版本不支持，请重新复制完整链接。');
  try {
    const zipped = Uint8Array.from(atob(match[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if (await digest(zipped) !== match[1]) throw Error('checksum');
    const raw = await bytes(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_RAW);
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    if (envelope.version !== 1 || (envelope.expiresAt !== null && (!Number.isSafeInteger(envelope.expiresAt) || envelope.expiresAt < 0))) throw Error('version');
    if (envelope.expiresAt !== null && now >= envelope.expiresAt) throw new ShareError('expired', '此分享已超过约定有效期，请让分享者重新生成链接。');
    const packet = parsePortable(JSON.stringify(envelope.packet));
    packet.exportedAt = envelope.packet.exportedAt; // Display original export time, never a verification time.
    return { packet, expiresAt: envelope.expiresAt };
  } catch (error) {
    if (error instanceof ShareError) throw error;
    throw new ShareError('damaged', '分享内容损坏、被截断或结构无效，请索取完整链接或 JSON 文件。');
  }
}

// Only requests/constraints cross this boundary. No location, proof or provider facts.
export function copyIntent(route) {
  const r = createPortable(route).route;
  return {
    context: { dayCount: r.days.length, startDate: r.context?.startDate, dailyStartTime: r.context?.dailyStartTime,
      dailyEndTime: r.context?.dailyEndTime, transportMode: r.context?.transportMode, maxWalkKm: r.context?.maxWalkKm },
    days: r.days.map(d => ({ date: d.date, start: d.requestedWindow?.start, end: d.requestedWindow?.end, restMinutes: d.restMinutes })),
    stops: r.stops.map(s => ({ name: s.name, city: s.city || r.city, addressHint: s.address || '', dayIndex: r.days.findIndex(d => d.id === s.dayId),
      stayMinutes: s.visit?.stayMinutes, restMinutes: s.visit?.restMinutes, locked: s.locked === true })),
    modes: r.legs.map(l => l.preferredMode || r.context?.transportMode || 'walking')
  };
}
