'use strict';

const photos = import('../public/location-photos.mjs');
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 1000;
const MAPILLARY_API = 'https://graph.mapillary.com/images';

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function distanceMeters(origin, destination) {
  if (destination.lat == null || destination.lng == null) return Infinity;
  const radians = value => value * Math.PI / 180;
  const arc = Math.sin(radians(destination.lat - origin.lat) / 2) ** 2
    + Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat))
    * Math.sin(radians(destination.lng - origin.lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(Math.max(0, 1 - arc)));
}

function mapillaryPosition(image) {
  const coordinates = image?.computed_geometry?.coordinates || image?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  if (coordinates[0] == null || coordinates[1] == null || coordinates[0] === '' || coordinates[1] === '') return null;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function mapillaryBounds(lat, lng, radiusMeters) {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.max(0.1, Math.abs(Math.cos(lat * Math.PI / 180))));
  return [
    Math.max(-180, lng - lngDelta), Math.max(-90, lat - latDelta),
    Math.min(180, lng + lngDelta), Math.min(90, lat + latDelta)
  ].join(',');
}

async function findMapillaryImage(input, { timeoutMs = 4000, headers = {} } = {}) {
  const token = String(process.env.MAPILLARY_ACCESS_TOKEN || '').trim();
  if (!token) return null;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const radius = 1000;
  const params = new URLSearchParams({
    access_token: token,
    fields: 'id,thumb_1024_url,computed_geometry,geometry,captured_at,creator',
    bbox: mapillaryBounds(lat, lng, radius),
    limit: '25'
  });
  try {
    const response = await fetch(`${MAPILLARY_API}?${params}`, {
      headers: { Accept: 'application/json', Authorization: `OAuth ${token}`, ...headers },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const candidates = (Array.isArray(payload?.data) ? payload.data : []).map(image => {
      const imageUrl = httpsUrl(image?.thumb_1024_url);
      const position = mapillaryPosition(image);
      if (!imageUrl || !position) return null;
      const distance = distanceMeters({ lat, lng }, position);
      if (!Number.isFinite(distance) || distance > radius + 50) return null;
      const id = String(image.id || '').trim();
      if (!id) return null;
      const author = String(image.creator?.username || '').trim().slice(0, 100);
      const capturedAt = Number(image.captured_at);
      return {
        distance,
        result: {
          image: imageUrl,
          imageSource: 'Mapillary',
          imageKind: 'street-photo',
          imagePageUrl: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(id)}`,
          imageAttribution: ['Mapillary', author, 'CC BY-SA'].filter(Boolean).join(' · '),
          imageTitle: `Mapillary ${id}`,
          distanceMeters: Math.round(distance),
          ...(Number.isFinite(capturedAt) && capturedAt > 0 ? { imageCapturedAt: capturedAt } : {})
        }
      };
    }).filter(Boolean).sort((a, b) => a.distance - b.distance);
    return candidates[0]?.result || null;
  } catch { return null; }
}

async function findLocationImage(input = {}) {
  const hasName = typeof input.name === 'string' && input.name.trim();
  const hasCity = typeof input.city === 'string' && input.city.trim();
  const hasCoordinates = input.lat != null && input.lng != null && input.lat !== '' && input.lng !== '';
  // Domestic Baidu image search can work from a place name alone. Keep the
  // old null contract when a caller provides no usable search terms at all.
  if (!hasCoordinates && !hasName && !hasCity) return null;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const validCoordinates = Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (hasCoordinates && !validCoordinates) return null;
  const name = String(input.name || '').trim().slice(0, 160);
  const city = String(input.city || '').trim().slice(0, 100);
  const provider = String(process.env.MAPILLARY_ACCESS_TOKEN || '').trim() ? 'mapillary' : 'baidu';
  const latKey = validCoordinates ? lat.toFixed(5) : '';
  const lngKey = validCoordinates ? lng.toFixed(5) : '';
  const key = `${latKey}|${lngKey}|${name}|${city}|${provider}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const headers = { 'User-Agent': 'CitywalkScope/1.0 (hackathon demo)' };
  let value = validCoordinates
    ? await findMapillaryImage({ lat, lng, name, city }, { timeoutMs: 4000, headers })
    : null;
  if (!value) {
    const providerModule = await photos;
    // A token explicitly opts into the legacy Mapillary path. Keep its old
    // Commons fallback for compatibility; normal operation uses Baidu Images.
    value = String(process.env.MAPILLARY_ACCESS_TOKEN || '').trim()
      ? (validCoordinates
        ? await providerModule.findCommonsLocationPhoto({ lat, lng, name, city }, { timeoutMs: 4000, headers })
        : null)
      : await providerModule.findLocationPhoto({ lat: validCoordinates ? lat : null, lng: validCoordinates ? lng : null, name, city }, { timeoutMs: 4000, headers });
  }
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expiresAt: Date.now() + (value ? CACHE_TTL_MS : NEGATIVE_TTL_MS) });
  return value;
}

module.exports = { findLocationImage, searchLocationImage: findLocationImage };
