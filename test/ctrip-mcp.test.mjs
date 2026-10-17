import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { parseRpcResponse, callTool, normalizeProducts, searchMcpPois, gcj02ToWgs84, wgs84ToGcj02 } = require('../lib/ctrip-mcp');
const { loadLocalEnv } = require('../lib/local-env');

function product(id, name = '武康大楼', lat = 31.2044589, lng = 121.4382306) {
  return {
    basicInfo: { name, cityName: '上海', available: true, imageURL: 'https://dimg04.c-ctrip.com/images/test.jpg' },
    additionalInfo: { poiId: id, coordinate: { lat, lng }, introduce: '<p>历史建筑</p>' },
    urlInfo: { h5Url: 'https://m.ctrip.com/webapp/sight?poiId=' + id }
  };
}

test('JSON and SSE replies select the matching request and ignore notifications', () => {
  const reply = { jsonrpc: '2.0', id: 42, result: { content: [] } };
  assert.deepEqual(parseRpcResponse(JSON.stringify(reply), 42), reply.result);
  const stream = 'event: message\r\ndata: {"method":"notifications/progress"}\r\n\r\nevent: message\r\ndata: '+JSON.stringify(reply)+'\r\n\r\n';
  assert.deepEqual(parseRpcResponse(stream, 42), reply.result);
  assert.throws(() => parseRpcResponse(JSON.stringify(reply), 43));
  assert.throws(() => parseRpcResponse('{"id":42,"error":{"message":"private-token"}}', 42), e => !e.message.includes('private-token'));
  assert.throws(() => parseRpcResponse('{"id":42,"result":{"isError":true}}', 42));
});

test('HTTP calls use documented authentication and JSON-RPC, never the generic POI contract', async () => {
  const ids = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://u.ctrip.com/faas/mcp');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    ids.push(body.id);
    assert.equal(body.method, 'tools/call');
    assert.deepEqual(body.params, { name: 'query_ticket', arguments: { cityName: '上海', resourceSize: 1 } });
    return new Response(JSON.stringify({ id: body.id, result: { content: [] } }));
  };
  await callTool('query_ticket', { cityName: '上海', resourceSize: 1 }, { token: 'test-token', fetchImpl });
  await callTool('query_ticket', { cityName: '上海', resourceSize: 1 }, { token: 'test-token', fetchImpl });
  assert.ok(ids[1] > ids[0]);
  await assert.rejects(callTool('query_ticket', {}, { token: 'test-token', fetchImpl: async () => { throw new Error('test-token'); } }), e => !e.message.includes('test-token'));
});

test('MCP field mapping preserves real IDs, photos and links and rejects unusable results', () => {
  const wrongCity = product(2); wrongCity.basicInfo.cityName = '北京';
  const invalid = product(3, '无坐标', null);
  const external = product(4); external.basicInfo.imageURL = 'https://example.com/a.jpg';
  const results = normalizeProducts([product(1), product(1), wrongCity, invalid, external, { h5Url: 'https://m.ctrip.com/search' }], '上海');
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'ctrip-1');
  assert.equal(results[0].note, '历史建筑');
  assert.equal(results[0].imageSource, '携程 MCP 景点图片');
  assert.match(results[0].detailUrl, /poiId=1/);
  assert.equal(results[1].image, '');
});

test('GCJ-02 normalization avoids a second map offset; WGS84 override is supported', () => {
  const gcj = { lat: 31.2044589, lng: 121.4382306 };
  const wgs = gcj02ToWgs84(gcj);
  // Existing map reference and provider point may mark different spots on the
  // building; both must agree within roughly 30 m, not the ~500 m GCJ offset.
  assert.ok(Math.abs(wgs.lat - 31.20626) < 0.0003);
  assert.ok(Math.abs(wgs.lng - 121.43373) < 0.0003);
  const display = wgs84ToGcj02(wgs);
  assert.ok(Math.abs(display.lat-gcj.lat) < 1e-7);
  assert.ok(Math.abs(display.lng-gcj.lng) < 1e-7);
  assert.deepEqual(normalizeProducts([product(1)], '上海', 'wgs84')[0].location, gcj);
  assert.throws(() => normalizeProducts([], '上海', 'unknown'));
});

test('nearby retrieval keeps a walkable cluster, deduplicates and does not invent missing POIs', async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.params.arguments);
    const products = [product(1), product(2, '武康路', 31.2111144, 121.4411412), product(3, '远郊', 31.7, 121.8)];
    return new Response(`event: message\ndata: ${JSON.stringify({ id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(products) }] } })}\n\n`);
  };
  const result = await searchMcpPois({ city: '上海市', intent: { startingPoint: '武康大楼', maxWalkKm: 3 } }, { token: 'test-token', fetchImpl });
  assert.deepEqual(result.pois.map(p => p.name), ['武康大楼', '武康路']);
  assert.equal(result.source, 'ctrip');
  assert.equal(result.provider, 'ctrip-mcp');
  assert.equal(calls[0].scenicSpotName, '武康大楼');
  assert.ok(Math.abs(calls[1].longitude-121.4382306) < 1e-7);
  assert.equal(calls[1].keyword, undefined);
});

test('initial MCP failure is not silently relabeled as local or legacy POI data', async () => {
  await assert.rejects(searchMcpPois({ city: '北京' }, { token: 'bad-token', fetchImpl: async () => new Response('denied', { status: 401 }) }));
  let calls = 0;
  const result = await searchMcpPois({ city: '上海' }, { token: 'test-token', fetchImpl: async (_url, options) => {
    if (++calls === 2) return new Response('unavailable', { status: 503 });
    const { id } = JSON.parse(options.body);
    return new Response(JSON.stringify({ id, result: { content: [{ type: 'text', text: JSON.stringify([product(1), product(2, '武康路')]) }] } }));
  } });
  assert.equal(result.pois.length, 2);
  assert.match(result.warning, /补充查询/);
});

test('identity lookup preserves distant and same-name candidates without nearby/radius filtering', async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.params.arguments);
    const wrongCity = product(4, '世纪公园'); wrongCity.basicInfo.cityName = '北京';
    const products = [product(1, '世纪公园'), product(2, '世纪公园', 31.7, 121.8), wrongCity];
    return new Response(JSON.stringify({ id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(products) }] } }));
  };
  const result = await searchMcpPois({ city: '上海市', placeName: '世纪公园', matchMode: 'identity', intent: { startingPoint: '武康大楼', maxWalkKm: 1 } }, { token: 'test-token', fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scenicSpotName, '世纪公园');
  assert.deepEqual(result.pois.map(p => p.id), ['ctrip-1', 'ctrip-2']);
  assert.equal(result.pois[0].city, '上海');
  assert.equal(result.pois[0].provider, 'ctrip-mcp');
  assert.equal(result.pois[0].retrievedAt, result.retrievedAt);
  assert.ok(Number.isFinite(Date.parse(result.retrievedAt)));
  assert.equal(result.providerUpdatedAt, null);
  assert.equal(result.pois[0].providerUpdatedAt, null);
  assert.equal(result.pois[0].openingHours.status, 'unknown');
  assert.equal(result.pois[0].openingHours.text, null);
  await assert.rejects(searchMcpPois({ city: '上海', matchMode: 'identity' }, { token: 'test-token', fetchImpl }), /地点名称/);
});

test('local environment loading cannot overwrite platform credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citywalk-env-'));
  try {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, '# comment\nCTRIP_MCP_TOKEN=local-token\nCTRIP_MCP_COORDINATE_SYSTEM="gcj02"\n');
    const env = { CTRIP_MCP_TOKEN: 'platform-token' };
    loadLocalEnv(file, env);
    assert.equal(env.CTRIP_MCP_TOKEN, 'platform-token');
    assert.equal(env.CTRIP_MCP_COORDINATE_SYSTEM, 'gcj02');
  } finally { fs.rmSync(dir, { recursive: true }); }
});
