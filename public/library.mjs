import { createPortable, parsePortable, publicText } from './portable-route.mjs';
export const LIBRARY_DB = 'citywalk-library';
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const uid = () => crypto.randomUUID();
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const nameOf = value => { const name = publicText(value).trim(); if (!name || name.length > 100) throw Error('收藏名称需为 1–100 个字符。'); return name; };
export function localRoute(packet) {
  const route = parsePortable(JSON.stringify(packet)).route;
  route.restoration = { status: 'unverified-local', restoredAt: new Date().toISOString() };
  return route;
}
function photosOf(photos = {}) {
  const clean = {}; let size = 0;
  for (const [id, data] of Object.entries(photos)) {
    if (typeof data !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > 600000 || (size += data.length) > 5*1024*1024) continue;
    clean[id] = data;
  }
  return clean;
}
export function appendVersion(record, name, route, photos = {}) {
  const value = record ? structuredClone(record) : { schemaVersion: 1, id: uid(), versions: [] };
  value.name = nameOf(name); value.updatedAt = new Date().toISOString();
  value.versions.push({ id: uid(), savedAt: value.updatedAt, packet: createPortable(route, { imported: true }), photos: photosOf(photos) });
  value.versions = value.versions.slice(-20);
  if (bytes(value) > 24*1024*1024) throw Error('此收藏超过 24 MB，保存未生效。请导出备份、另存收藏或删除较旧版本。');
  return value;
}
// v1 is the first database schema. Future versions must migrate explicitly, not reset.
export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw Error('备份不能超过 64 MB。');
  let data; try { data = JSON.parse(text); } catch { throw Error('备份 JSON 已损坏。'); }
  if (data?.format !== 'citywalk-library') return [appendVersion(null, data?.route?.title || data?.title || '导入的行程', parsePortable(text).route)];
  if (data.version !== 1 || !Array.isArray(data.records) || !data.records.length || data.records.length > 100) throw Error('不支持此行程库版本或收藏数量（1–100）。');
  return data.records.map(r => {
    if (r.schemaVersion !== 1 || !Array.isArray(r.versions) || !r.versions.length || r.versions.length > 20) throw Error('收藏版本结构无效。');
    let record = null;
    for (const v of r.versions) {
      record = appendVersion(record, r.name, parsePortable(JSON.stringify(v.packet)).route, v.photos);
      record.versions.at(-1).savedAt = typeof v.savedAt === 'string' && Number.isFinite(Date.parse(v.savedAt)) ? v.savedAt : record.updatedAt;
    }
    return record; // New library identity: importing never overwrites existing records.
  });
}
export function backupText(records) {
  const text = JSON.stringify({ format: 'citywalk-library', version: 1, exportedAt: new Date().toISOString(), records }, null, 2);
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw Error('备份超过 64 MB，请逐个收藏导出。');
  return text;
}
export function storageMessage(error) {
  return error?.name === 'QuotaExceededError' ? '本机存储空间不足，本次保存未生效，旧收藏未变。请先导出备份，再删除不需要的收藏或版本。' : error?.message || '本机存储不可用，请允许此网站存储，或下载 JSON / HTML 保管。';
}
export async function openLibrary(factory = globalThis.indexedDB) {
  if (!factory) throw Error('浏览器不支持本机行程库，请下载 JSON / HTML 保管。');
  const db = await new Promise((resolve, reject) => {
    let request; try { request = factory.open(LIBRARY_DB, 1); } catch { reject(Error('本机存储被禁用，请允许此网站存储，或下载文件保管。')); return; }
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('trips')) request.result.createObjectStore('trips', { keyPath: 'id' }); };
    request.onerror = () => reject(Error('本机行程库无法打开（权限、损坏或版本不兼容）；未清除数据，请保留原浏览器并重试。'));
    request.onblocked = () => reject(Error('行程库升级被其他页面占用，请关闭旧标签页后重试。'));
    request.onsuccess = () => resolve(request.result);
  });
  db.onversionchange = () => db.close();
  const tx = (mode, work) => new Promise((resolve, reject) => {
    const t = db.transaction('trips', mode), store = t.objectStore('trips'); let result, failure;
    t.oncomplete = () => resolve(result); t.onabort = () => reject(failure || t.error || Error('保存未完成，旧收藏未变。')); t.onerror = () => {};
    try { work(store, v => { result = v; }, e => { failure = e; t.abort(); }); } catch (e) { failure = e; t.abort(); }
  });
  return {
    list: () => tx('readonly', (s, done) => { s.getAll().onsuccess = e => done(e.target.result.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))); }),
    get: id => tx('readonly', (s, done) => { s.get(id).onsuccess = e => done(e.target.result); }),
    mutate: (id, change) => tx('readwrite', (s, done, fail) => { s.get(id).onsuccess = e => { try { const old = e.target.result; if (!old) throw Error('此收藏已在其他页面删除，请刷新列表。'); const next = change(old); if (next) s.put(next); else s.delete(id); done(next); } catch(err) { fail(err); } }; }),
    add: records => tx('readwrite', (s, done) => { records.forEach(r => s.add(r)); done(records); }),
    close: () => db.close()
  };
}
