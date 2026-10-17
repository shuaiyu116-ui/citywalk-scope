// Local-only fixture. All credentials replaced and external I/O blocked by parent.
require('./w03-offline.cjs');
// Simulated real-provider adapter responses, never local .env or real services.
process.env.CTRIP_API_BASE_URL='https://w07.invalid/pois';
process.env.CTRIP_API_KEY='offline-test-only';
const parentFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if(String(url)===process.env.CTRIP_API_BASE_URL){
    const {matchTarget}=JSON.parse(options.body);
    const names=['武康大楼','武康路梧桐段','安福路转角','景山公园'];
    const index=names.indexOf(matchTarget.name);
    return new Response(JSON.stringify({pois:index<0?[]:[{id:`fixture-poi-${index}`,name:matchTarget.name,city:matchTarget.city,location:matchTarget.city==='北京'?{lat:39.925,lng:116.397}:{lat:31.206+index*.002,lng:121.434+index*.002}}]}));
  }
  if (String(url) === process.env.DEEPSEEK_API_URL) {
    const body = JSON.parse(options.body);
    if (options.headers.Authorization.includes('slow-fixture')) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 5000);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    });
    if (body.messages[0]?.content.startsWith('你是 Citywalk Scope 的行程决策助手。')) {
      const { request, current, versions, canAct } = JSON.parse(body.messages[1].content);
      const result = request === '上海街区散步' && versions.length === 1 && canAct
        ? { actions: [{ type: 'move', stopId: current.stops[2].id, offset: -1 }], reason: '根据返回地点调整游玩顺序' }
        : { actions: [], reason: '保留当前安排' };
      return new Response(JSON.stringify({ usage: { prompt_tokens: 123, completion_tokens: 12 }, choices: [{ message: { content: JSON.stringify(result) } }] }));
    }
  }
  return parentFetch(url, options);
};
