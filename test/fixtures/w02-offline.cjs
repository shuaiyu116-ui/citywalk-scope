// Offline only: all credentials are replaced before .env loading; no external I/O.
for (const key of ['DEEPSEEK_API_KEY', 'CTRIP_API_BASE_URL', 'CTRIP_API_KEY', 'MAPILLARY_ACCESS_TOKEN']) process.env[key] = '';
process.env.CTRIP_MCP_TOKEN = 'offline-test-only';
process.env.CTRIP_MCP_COORDINATE_SYSTEM = 'wgs84';
process.env.DEEPSEEK_API_URL = 'https://w02.invalid/deepseek';
let phase = 'idle';
let missing = false;
const product = (id, name, city, lat, lng, address = '') => ({
  basicInfo: { name, cityName: city, address, available: true },
  additionalInfo: { poiId: id, coordinate: { lat, lng }, introduce: '全年开放，免费（商品文字不可作为营业证据）' },
  urlInfo: { h5Url: `https://m.ctrip.com/sight/${id}.html` }
});
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, options = {}) => {
  if (String(url) === process.env.DEEPSEEK_API_URL) {
    const body = JSON.parse(options.body);
    if (body.temperature === 0.2) {
      phase = 'analyzed'; missing = body.messages[1].content.includes('全都查不到');
      const generic = body.messages[1].content.includes('通用接口');
      process.env.CTRIP_MCP_TOKEN = generic ? '' : 'offline-test-only';
      process.env.CTRIP_API_BASE_URL = generic ? 'https://w02.invalid/pois' : '';
      process.env.CTRIP_API_KEY = generic ? 'generic-test-only' : '';
      return json({ choices: [{ message: { content: JSON.stringify({ city: '上海', maxWalkKm: 8 }) } }] });
    }
    if (phase !== 'analyzed') throw new Error('Incorrect model order');
    phase = 'proposed';
    const { intent, candidatePois } = JSON.parse(body.messages[1].content);
    if (candidatePois) throw new Error('Model must propose before POI retrieval');
    const proposal = {
      city: '上海', title: '离线提案验证', rationale: `budget=${intent.maxWalkKm};mode=${intent.context.transportMode}`,
      stops: [
        { name: '武康大楼', city: '上海', reason: '观察街区建筑', location: { lat: 0, lng: 0 }, openingHours: '模型虚构时间', price: '模型虚构价格' },
        { name: '世纪公园', city: '上海', reason: '开阔空间，骑行需求', location: { lat: 0, lng: 0 } },
        { name: '不存在的雕塑', city: '上海', reason: '文化主题', alternatives: [{ name: '夫子庙', city: '南京', reason: '跨日旧城备选' }] },
        { name: '同名园', city: '上海', reason: '需要分辨地址' }
      ]
    };
    return json({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
  }
  if (String(url) === 'https://w02.invalid/pois') {
    const { matchTarget } = JSON.parse(options.body);
    return json({ pois: ['武康大楼', '世纪公园'].includes(matchTarget.name) ? [{
      id: matchTarget.name, name: matchTarget.name, city: '上海', location: { lat: 31.2, lng: 121.5 },
      providerUpdatedAt: '2026-10-15T00:00:00Z', detailUrl: 'https://m.ctrip.com/sight/1.html',
      openingHours: { status: 'reported', text: '09:00–17:00', apiKey: 'must-be-stripped', providerUpdatedAt: '2026-10-14T00:00:00Z' }
    }] : [] });
  }
  if (String(url) === 'https://u.ctrip.com/faas/mcp') {
    if (phase !== 'proposed') throw new Error('POI requested before proposal');
    const body = JSON.parse(options.body);
    const args = body.params.arguments;
    // A nearby query is an error: identity retrieval must not use the old anchor.
    if (!args.scenicSpotName || args.latitude || args.longitude) throw new Error('Unexpected nearby query');
    const entries = [
      product(1, '武康大楼', '上海', 31.206, 121.434),
      product(2, '世纪公园', '上海', 31.216, 121.55),
      product(3, '夫子庙', '南京', 32.02, 118.79),
      product(4, '同名园', '上海', 31.20, 121.44, '西路100号'),
      product(5, '同名园', '上海', 31.30, 121.54, '东路200号'),
      product(6, '武康大楼', '北京', 39.9, 116.4)
    ];
    const products = missing ? [] : entries.filter(item => item.basicInfo.name === args.scenicSpotName);
    return json({ id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(products) }] } });
  }
  throw new Error('W02 offline fixture: external request blocked');
};
