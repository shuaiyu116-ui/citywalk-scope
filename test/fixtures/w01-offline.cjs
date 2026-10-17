// Test-only preload. Never uses .env credentials or reaches external services.
for (const key of ['DEEPSEEK_API_KEY', 'CTRIP_MCP_TOKEN', 'CTRIP_API_BASE_URL', 'CTRIP_API_KEY', 'MAPILLARY_ACCESS_TOKEN']) process.env[key] = '';
process.env.DEEPSEEK_API_URL = 'https://w01.invalid/deepseek';
global.fetch = async (url, options) => {
  if (String(url) !== process.env.DEEPSEEK_API_URL) throw new Error('W01 offline fixture: external request blocked');
  if (options.headers.Authorization.includes('fail-fixture')) throw new Error('Simulated model failure');
  const body = JSON.parse(options.body);
  const user = body.messages.find(message => message.role === 'user').content;
  let result;
  if (body.temperature === 0.2) {
    result = { city: '上海', durationMinutes: 120, maxWalkKm: 8, interests: ['街区'] };
  } else {
    const { intent } = JSON.parse(user);
    // Visible fields verify that context reached generation, not only the wrapper.
    result = { city: '上海', title: '离线流程验证', summary: `budget=${intent.maxWalkKm};minutes=${intent.durationMinutes};mode=${intent.context.transportMode}`, duration: '约 2 小时', distance: '待计算', mood: '模拟响应', stops: ['武康大楼', '武康路梧桐段', '安福路转角'].map(name => ({ name, city: '上海', reason: '模拟地点说明', alternatives: [] })) };
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
