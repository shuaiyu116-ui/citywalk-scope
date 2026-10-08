import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { selectLocationPhoto, findLocationPhoto } from '../public/location-photos.mjs';
const { findLocationImage } = createRequire(import.meta.url)('../lib/location-images.js');

const origin = { lat: 31.206, lng: 121.434, name: '武康大楼', city: '上海' };
function photo(title, lat, options = {}) {
  return {
    title: `File:${title}`,
    coordinates: [{ lat, lon: origin.lng }],
    imageinfo: [{
      url: 'https://upload.wikimedia.org/example.jpg', mime: 'image/jpeg',
      extmetadata: { Artist: { value: '<a href="https://example.com">Photographer</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
      ...options
    }]
  };
}

test('a named location beats a closer unrelated photograph and carries usable attribution', () => {
  const selected = selectLocationPhoto([photo('街角.jpg', 31.206), photo('武康大楼.jpg', 31.208)], origin);
  assert.equal(selected.imageKind, 'location-photo');
  assert.equal(selected.imageTitle, '武康大楼.jpg');
  assert.equal(selected.imageAttribution, 'Photographer · CC BY-SA 4.0');
  assert.match(decodeURIComponent(selected.imagePageUrl), /wiki\/File:武康大楼.jpg$/);
});

test('nearby photos are ranked by distance and never labelled as the named place', () => {
  const selected = selectLocationPhoto([photo('远处.jpg', 31.212), photo('街角.jpg', 31.207)], origin);
  assert.equal(selected.imageTitle, '街角.jpg');
  assert.equal(selected.imageKind, 'nearby-photo');
  assert.ok(selected.distanceMeters > 100 && selected.distanceMeters < 120);
});

test('invalid sources, non-photo media and locations outside the search area are excluded', () => {
  const selected = selectLocationPhoto([
    photo('武康大楼.jpg', 31.206, { url: 'javascript:alert(1)' }),
    photo('武康大楼.svg', 31.206, { mime: 'image/svg+xml' }),
    photo('武康大楼.jpg', 31.3)
  ], origin);
  assert.equal(selected, null);
});

test('missing coordinates are rejected before any network request', async () => {
  assert.equal(await findLocationPhoto({ lat: null, lng: origin.lng }), null);
  assert.equal(await findLocationPhoto({ lat: '', lng: origin.lng }), null);
});

test('Mapillary chooses a nearby street photo, preserves authorship and ignores invalid coordinates', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.MAPILLARY_ACCESS_TOKEN;
  process.env.MAPILLARY_ACCESS_TOKEN = 'test-token';
  globalThis.fetch = async (input, options) => {
    const request = new URL(input);
    assert.equal(request.hostname, 'graph.mapillary.com');
    assert.ok(request.searchParams.get('fields').includes('creator'));
    assert.equal(options.headers.Authorization, 'OAuth test-token');
    return { ok: true, json: async () => ({ data: [
      { id: 'invalid', thumb_1024_url: 'https://images.example.com/invalid.jpg', geometry: { coordinates: [null, null] } },
      { id: 'far', thumb_1024_url: 'https://images.example.com/far.jpg', geometry: { coordinates: [origin.lng, origin.lat + 0.02] } },
      { id: 'near', thumb_1024_url: 'https://images.example.com/near.jpg', geometry: { coordinates: [origin.lng, origin.lat + 0.001] }, creator: { username: 'photographer' }, captured_at: 1700000000000 }
    ] }) };
  };
  try {
    const selected = await findLocationImage({ ...origin, name: 'mapillary-test' });
    assert.equal(selected.imageSource, 'Mapillary');
    assert.equal(selected.imageKind, 'street-photo');
    assert.equal(selected.imagePageUrl, 'https://www.mapillary.com/app/?pKey=near');
    assert.equal(selected.imageAttribution, 'Mapillary · photographer · CC BY-SA');
    assert.equal(selected.imageCapturedAt, 1700000000000);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.MAPILLARY_ACCESS_TOKEN;
    else process.env.MAPILLARY_ACCESS_TOKEN = originalToken;
  }
});

test('Mapillary failure falls back to coordinate-based Commons photos', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.MAPILLARY_ACCESS_TOKEN;
  process.env.MAPILLARY_ACCESS_TOKEN = 'test-token';
  const providers = [];
  globalThis.fetch = async input => {
    const request = new URL(input);
    providers.push(request.hostname);
    if (request.hostname === 'graph.mapillary.com') return { ok: false };
    return { ok: true, json: async () => ({ query: { pages: { 1: photo('街角.jpg', origin.lat) } } }) };
  };
  try {
    const selected = await findLocationImage({ ...origin, name: 'fallback-test' });
    assert.equal(selected.imageSource, 'Wikimedia Commons');
    assert.deepEqual(providers, ['graph.mapillary.com', 'commons.wikimedia.org']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.MAPILLARY_ACCESS_TOKEN;
    else process.env.MAPILLARY_ACCESS_TOKEN = originalToken;
  }
});
