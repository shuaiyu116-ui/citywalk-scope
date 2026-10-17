// Credentials and all upstream I/O are replaced by offline parent fixtures.
require('./w09-offline.cjs');
const previous=global.fetch;
global.fetch=async(url,options={})=>{
  if(String(url)==='https://u.ctrip.com/faas/mcp'){
    const body=JSON.parse(options.body),args=body.params.arguments;
    if(args.scenicSpotName){
      if(args.scenicSpotName==='故障地点')throw Error('confidential fixture failure');
      const products=args.scenicSpotName==='不存在'?[]:[{basicInfo:{name:args.scenicSpotName,cityName:args.cityName,address:'离线核对地址',available:true},additionalInfo:{poiId:'fresh-'+args.scenicSpotName,coordinate:{lat:31.2,lng:121.4}},urlInfo:{h5Url:'https://m.ctrip.com/sight/test.html'}}];
      return new Response(JSON.stringify({id:body.id,result:{content:[{type:'text',text:JSON.stringify(products)}]}}));
    }
  }
  return previous(url,options);
};
