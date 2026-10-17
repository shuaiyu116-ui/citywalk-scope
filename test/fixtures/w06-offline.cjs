require('./w05-offline.cjs');
const fallback=global.fetch;
global.fetch=async(url,options)=>{
 if(String(url)==='https://u.ctrip.com/faas/mcp') {
  const body=JSON.parse(options.body);
  if(body.params.arguments.scenicSpotName==='南京站') return new Response(JSON.stringify({id:body.id,result:{content:[{type:'text',text:JSON.stringify([{basicInfo:{name:'南京站',cityName:'南京',address:'模拟地址：玄武区龙蟠路'},additionalInfo:{poiId:'fixture-nanjing',coordinate:{lat:32.087,lng:118.797}},urlInfo:{h5Url:'https://m.ctrip.com/sight/fixture-nanjing.html'}}])}]}}));
 }
 return fallback(url,options);
};
