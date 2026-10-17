// W09 fixture: inherits complete credential replacement / external I/O blocking.
require('./w08-offline.cjs');
process.env.CTRIP_MCP_TOKEN = process.env.W09_NO_MCP === '1' ? '' : 'offline-test-only';
process.env.CTRIP_MCP_COORDINATE_SYSTEM = 'wgs84';
const previousNearbyFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if (String(url) === 'https://u.ctrip.com/faas/mcp') {
    const body = JSON.parse(options.body), args = body.params.arguments;
    if (Number.isFinite(args.latitude) && Number.isFinite(args.longitude)) {
      if (args.cityName === '故障城') throw new Error('fixture failure with confidential data');
      const products = args.cityName === '空城' ? [] : [
        ['nearby-park', '附近公园（离线测试）', .001, .001],
        ['nearby-gallery', '附近展馆（离线测试）', .004, .002],
        ['faraway', '远点（应过滤）', 1, 1]
      ].map(([id, name, dLat, dLng]) => ({ basicInfo: { name, cityName: args.cityName, address: '离线模拟地址', available: true }, additionalInfo: { poiId: id, coordinate: { lat: args.latitude+dLat, lng: args.longitude+dLng } }, urlInfo: { h5Url: `https://m.ctrip.com/sight/${id}.html` } }));
      return new Response(JSON.stringify({ id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(products) }] } }));
    }
  }
  return previousNearbyFetch(url, options);
};
