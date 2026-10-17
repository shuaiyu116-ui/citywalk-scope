import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const { getLocationPhotoBytes } = createRequire(import.meta.url)('../lib/location-photo-proxy.js');

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

test('Baidu thumbnail bytes are served once, cached, and concurrent reads are shared', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(url.hostname, 'img1.baidu.com');
    assert.equal(options.headers.Referer, 'https://image.baidu.com/');
    return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const url = 'https://img1.baidu.com/it/test-cache';
    const results = await Promise.all([getLocationPhotoBytes(url), getLocationPhotoBytes(url)]);
    assert.deepEqual(results[0].data, Buffer.from(jpeg));
    assert.equal(results[0].contentType, 'image/jpeg');
    assert.equal(results[0], results[1]);
    assert.equal(await getLocationPhotoBytes(url), results[0]);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('the image endpoint cannot fetch arbitrary URLs or local network services', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No request should be made'); };
  try {
    for (const url of [
      'http://127.0.0.1/private', 'https://example.com/photo.jpg',
      'https://img1.baidu.com.example.com/photo.jpg',
      'https://img1.baidu.com:8443/photo.jpg', 'https://user@img1.baidu.com/photo.jpg',
      'https://images.c-ctrip.com.evil.example/photo.jpg', 'https://c-ctrip.com/photo.jpg',
      'https://www.ctrip.com/private'
    ]) {
      await assert.rejects(getLocationPhotoBytes(url), error => error.statusCode === 400);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('Ctrip raster photos use the same validated byte cache without browser CORS', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url.hostname, 'dimg04.c-ctrip.com');
    assert.equal(options.headers.Referer, 'https://www.ctrip.com/');
    return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const result = await getLocationPhotoBytes('https://dimg04.c-ctrip.com/images/offline-export-test.jpg');
    assert.equal(result.contentType, 'image/jpeg');
    assert.deepEqual(result.data, Buffer.from(jpeg));
  } finally { globalThis.fetch = originalFetch; }
});

test('redirects outside the thumbnail hosts are rejected before fetching the destination', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  };
  try {
    await assert.rejects(getLocationPhotoBytes('https://img1.baidu.com/it/test-redirect'), /redirect/);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('provider errors, HTML disguised as a photo, and oversized streams never become images', async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    () => new Response('denied', { status: 403 }),
    () => new Response('<html>blocked</html>', { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } })
  ];
  try {
    for (const [index, response] of cases.entries()) {
      globalThis.fetch = async () => response();
      await assert.rejects(getLocationPhotoBytes(`https://img1.baidu.com/it/test-invalid-${index}`));
    }
    // A failed fetch must remain retryable instead of caching the error.
    globalThis.fetch = async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
    assert.equal((await getLocationPhotoBytes('https://img1.baidu.com/it/test-invalid-0')).contentType, 'image/jpeg');
  } finally { globalThis.fetch = originalFetch; }
});
