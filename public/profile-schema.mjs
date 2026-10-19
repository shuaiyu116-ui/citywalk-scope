// Shared, bounded device profile contract. No browser storage or DOM access.
export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_MAX_ITEMS = 40;

export function profileText(value, max = 320) {
  return typeof value === 'string' ? value
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[已隐藏密钥]')
    .replace(/Bearer\s+\S+/gi, '[已隐藏凭据]')
    .replace(/\b(?:api[_-]?key|token|authorization)\s*[:=]\s*["']?[^\s,"'}]+/gi, '[已隐藏凭据]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim().slice(0, max) : '';
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return '';
  return new Date(value).toISOString();
}

function itemId(item) {
  let hash = 2166136261;
  for (const character of `${item.scope}|${item.category}|${item.label}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `profile-${(hash >>> 0).toString(36)}`;
}

export function normalizeProfile(value = {}) {
  const items = [], ids = new Set();
  for (const raw of (Array.isArray(value?.items) ? value.items : []).slice(0, PROFILE_MAX_ITEMS)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = {
      category: profileText(raw.category, 40) || '其他', label: profileText(raw.label, 60),
      value: profileText(raw.value, 320), scope: raw.scope === 'long-term' ? 'long-term' : 'trip',
      evidence: profileText(raw.evidence, 500), source: raw.source === 'user' ? 'user' : 'ds',
      updatedAt: timestamp(raw.updatedAt)
    };
    if (!item.label || !item.value) continue;
    item.id = typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(raw.id) ? raw.id : itemId(item);
    if (ids.has(item.id)) continue;
    ids.add(item.id); items.push(item);
  }
  return { schemaVersion: PROFILE_SCHEMA_VERSION, items, updatedAt: timestamp(value?.updatedAt) };
}

// A previous trip's date, party and temporary constraints are history, never
// defaults for another trip. The active route supplies its own trip context.
export function profileForPlanning(value) {
  const profile = normalizeProfile(value);
  return { ...profile, items: profile.items.filter(item => item.scope === 'long-term') };
}
