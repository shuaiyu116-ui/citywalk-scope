'use strict';
// No real credentials or external services, even when a local .env exists.
process.env.DEEPSEEK_API_KEY = '';
process.env.DEEPSEEK_API_URL = 'https://profile-fixture.invalid/completions';
process.env.CTRIP_MCP_TOKEN = '';
process.env.CTRIP_API_KEY = '';
global.fetch = async (url, options = {}) => {
  if (String(url) !== process.env.DEEPSEEK_API_URL) throw Error('Fixture blocks external I/O');
  if (options.headers.Authorization === 'Bearer invalid-fixture') return new Response('{"error":"private-provider-body"}', { status: 401 });
  const request = JSON.parse(options.body), input = JSON.parse(request.messages[1].content);
  const evidence = input.userSources.find(source => source.includes('喜欢')) || input.userSources[0];
  const value = evidence.includes('摄影') ? '喜欢摄影' : '喜欢建筑';
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ upsert: [{ category: '兴趣', label: '游览兴趣', value, scope: 'long-term', evidence }], remove: [] }) } }] }));
};
