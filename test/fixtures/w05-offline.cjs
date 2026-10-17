require('./w03-offline.cjs');
const fallback=global.fetch;
process.env.CTRIP_MCP_TOKEN='offline-test-only';
process.env.CTRIP_MCP_COORDINATE_SYSTEM='wgs84';
global.fetch=async(url,options) => {
  if(String(url)==='https://u.ctrip.com/faas/mcp') {
    const body=JSON.parse(options.body), name=body.params.arguments.scenicSpotName;
    if(name==='失败地点') throw Error('offline failure');
    const entries=[['x','同名园','上海',31.22,121.45,'西路100号'],['y','同名园','上海',31.23,121.46,'东路200号'],['z','新公园','上海',31.21,121.44,'公园路1号']];
    const products=entries.filter(e => e[1]===name).map(([id,name,city,lat,lng,address]) => ({basicInfo:{name,cityName:city,address},additionalInfo:{poiId:id,coordinate:{lat,lng}},urlInfo:{h5Url:`https://m.ctrip.com/sight/${id}.html`}}));
    return new Response(JSON.stringify({id:body.id,result:{content:[{type:'text',text:JSON.stringify(products)}]}}));
  }
  return fallback(url,options);
};
