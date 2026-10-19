import { normalizeProfile, profileForPlanning, profileText, PROFILE_MAX_ITEMS } from './profile-schema.mjs';
import { normalizePreferences } from './conversation-state.mjs';

const IDENTITY_KEY = 'citywalk.device.id.v1';
const resourceKey = id => `citywalk.device.${id}.resources.v1`;
const clone = value => JSON.parse(JSON.stringify(value));
const safeStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const newId = () => globalThis.crypto?.randomUUID?.() || `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const isId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{10,100}$/.test(value);

// The request queue is page memory. Neither API keys nor conversations are stored.
function inputSnapshot(value = {}) {
  const context = {};
  for (const key of ['startDate', 'dayCount', 'dailyStartTime', 'dailyEndTime', 'transportMode', 'maxWalkKm']) {
    if (typeof value.context?.[key] === 'number' && Number.isFinite(value.context[key])) context[key] = value.context[key];
    else if (typeof value.context?.[key] === 'string') context[key] = profileText(value.context[key], 80);
  }
  if (Array.isArray(value.context?.companions)) context.companions = value.context.companions.filter(item => typeof item === 'string').slice(0, 8).map(item => profileText(item, 60));
  return {
    kind: ['planning', 'edit', 'manual'].includes(value.kind) ? value.kind : 'planning',
    prompt: profileText(value.prompt, 3000),
    messages: (Array.isArray(value.messages) ? value.messages : []).filter(message => message?.role === 'user').slice(-10).map(message => ({ role: 'user', content: profileText(message.content, 1000) })).filter(message => message.content),
    context,
    changes: (Array.isArray(value.changes) ? value.changes : []).filter(item => typeof item === 'string').slice(0, 40).map(item => profileText(item, 500))
  };
}

export function createDeviceProfileStore({ storage = safeStorage(), eventTarget = globalThis.window, fetcher = globalThis.fetch?.bind(globalThis), now = Date.now, uuid = newId } = {}) {
  let deviceId, persistent = false, status = 'idle', error = '', disposed = false;
  let running = false, scheduled = false, sequence = 0, lastFailed = null;
  const listeners = new Set(), queue = [];
  const revision = () => `${now()}-${++sequence}-${uuid()}`;
  const empty = () => ({ revision: '', profile: normalizeProfile({}), preferences: normalizePreferences({}) });
  let record = empty();

  function establishIdentity() {
    try {
      const saved = storage?.getItem(IDENTITY_KEY);
      deviceId = isId(saved) ? saved : uuid();
      if (!isId(deviceId)) deviceId = newId();
      if (!storage) return;
      storage.setItem(IDENTITY_KEY, deviceId);
      persistent = true;
    } catch { deviceId ||= newId(); persistent = false; }
  }
  function readRecord(raw) {
    if (!raw) return empty();
    try {
      const value = JSON.parse(raw);
      return { revision: typeof value.revision === 'string' ? value.revision : '', profile: normalizeProfile(value.profile), preferences: normalizePreferences(value.preferences) };
    } catch { return empty(); }
  }
  function refresh() {
    if (!persistent) return false;
    try {
      const next = readRecord(storage.getItem(resourceKey(deviceId)));
      if (next.revision === record.revision) return false;
      record = next;
      return true;
    } catch { persistent = false; return false; }
  }
  function getSnapshot() {
    return { deviceId, persistent, status, error, queued: queue.length + Number(running), profile: clone(record.profile), preferences: clone(record.preferences) };
  }
  function emit() { if (!disposed) for (const listener of listeners) { try { listener(getSnapshot()); } catch { /* A view cannot interrupt persistence or the queue. */ } } }
  function persist() {
    record.revision = revision();
    try {
      if (!storage) throw new Error('storage unavailable');
      storage.setItem(IDENTITY_KEY, deviceId);
      storage.setItem(resourceKey(deviceId), JSON.stringify(record));
      persistent = true;
    } catch { persistent = false; }
    emit();
  }
  function discardPending() {
    while (queue.length) queue.shift().resolve({ skipped: true });
    lastFailed = null;
  }
  function manuallyChange(change) {
    refresh(); discardPending();
    change(); status = 'saved'; error = ''; persist();
  }
  function saveItem(item = {}) {
    refresh();
    const current = record.profile.items.find(entry => entry.id === item.id);
    if (!current && record.profile.items.length >= PROFILE_MAX_ITEMS) return false;
    const candidate = normalizeProfile({ items: [{ scope: 'long-term', ...current, ...item, id: current?.id || item.id || uuid(), source: 'user', updatedAt: new Date(now()).toISOString() }] }).items[0];
    if (!candidate) return false;
    manuallyChange(() => {
      const items = record.profile.items.filter(entry => entry.id !== candidate.id);
      record.profile = normalizeProfile({ items: [...items, candidate], updatedAt: new Date(now()).toISOString() });
    });
    return true;
  }
  function deleteItem(id) { manuallyChange(() => { record.profile = normalizeProfile({ items: record.profile.items.filter(item => item.id !== id), updatedAt: new Date(now()).toISOString() }); }); }
  function clear() { manuallyChange(() => { record.profile = normalizeProfile({ items: [], updatedAt: new Date(now()).toISOString() }); }); }

  async function runQueue() {
    scheduled = false;
    if (running || disposed) return;
    running = true;
    while (queue.length && !disposed) {
      const job = queue.shift();
      refresh();
      const startRevision = record.revision, startIdentity = deviceId;
      status = 'updating'; error = ''; emit();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 65000);
      try {
        const apiKey = typeof job.getApiKey === 'function' ? job.getApiKey() : '';
        const response = await fetcher('/api/profile/update', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ ...(apiKey ? { apiKey } : {}), profile: clone(record.profile), input: job.input })
        });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 503 ? 'key' : 'request');
        const result = await response.json();
        if (!result || !Array.isArray(result.profile?.items)) throw new Error('response');
        refresh();
        if (disposed || startIdentity !== deviceId || startRevision !== record.revision) {
          job.resolve({ skipped: true });
          if (!disposed) { status = 'saved'; error = ''; emit(); }
          continue;
        }
        record.profile = normalizeProfile(result.profile);
        status = 'saved'; error = ''; lastFailed = null; persist();
        job.resolve({ profile: clone(record.profile) });
      } catch (failure) {
        refresh();
        if (disposed || startIdentity !== deviceId || startRevision !== record.revision) {
          job.resolve({ skipped: true });
          if (!disposed) { status = 'saved'; error = ''; emit(); }
        }
        else {
          status = 'error';
          error = failure?.message === 'key' ? '画像暂未更新，请在设置中检查 DeepSeek Key 后重试。' : '画像暂未更新，已保留原有内容，可稍后重试。';
          lastFailed = { input: job.input, getApiKey: job.getApiKey };
          job.resolve({ error }); emit();
        }
      } finally { clearTimeout(timer); }
    }
    running = false;
    emit();
  }
  function enqueue(input, getApiKey = () => '') {
    if (disposed) return Promise.resolve({ skipped: true });
    const promise = new Promise(resolve => queue.push({ input: inputSnapshot(input), getApiKey, resolve }));
    if (!running && !scheduled) { scheduled = true; Promise.resolve().then(runQueue); }
    emit();
    return promise;
  }
  function onStorage(event) {
    if (event.storageArea && storage && event.storageArea !== storage) return;
    if (event.key === IDENTITY_KEY || event.key === null) {
      const oldIdentity = deviceId;
      establishIdentity();
      if (oldIdentity !== deviceId || event.key === null) { discardPending(); record = empty(); status = 'idle'; error = ''; }
      refresh(); emit();
    } else if (event.key === resourceKey(deviceId)) { refresh(); emit(); }
  }
  establishIdentity(); refresh();
  eventTarget?.addEventListener?.('storage', onStorage);
  return {
    getSnapshot, getState: getSnapshot,
    getProfile() { refresh(); return clone(record.profile); },
    getProfileForPlanning() { refresh(); return profileForPlanning(record.profile); },
    getPlanningProfile() { refresh(); return profileForPlanning(record.profile); },
    getPreferences() { refresh(); return clone(record.preferences); },
    setPreferences(value) { manuallyChange(() => { record.preferences = normalizePreferences(value); }); },
    saveItem, editItem: saveItem, deleteItem, removeItem: deleteItem, clear, enqueue,
    retry() { const failed = lastFailed; if (!failed) return Promise.resolve({ skipped: true }); lastFailed = null; return enqueue(failed.input, failed.getApiKey); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; discardPending(); listeners.clear(); eventTarget?.removeEventListener?.('storage', onStorage); }
  };
}
