// Full HTTP seam: fake credentials and provider responses; no external I/O.
require('./w03-offline.cjs');
process.env.CTRIP_MCP_TOKEN='offline-test-only';
process.env.CTRIP_MCP_COORDINATE_SYSTEM='wgs84';
process.env.DEEPSEEK_API_KEY='offline-test-only';
const previousFetch=global.fetch;
const names=['测试公园','测试展馆','测试老街'];
const point=index=>({lat:31.22+index*.002,lng:121.44});
const model=result=>new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:30},choices:[{message:{content:JSON.stringify(result)}}]}));
global.fetch=async(url,options={})=>{
  if(String(url)==='https://u.ctrip.com/faas/mcp'){
    const rpc=JSON.parse(options.body),args=rpc.params.arguments;
    let products;
    if(rpc.params.name==='query_ticket'){
      const index=names.indexOf(args.scenicSpotName);
      products=index<0?[]:[{basicInfo:{name:names[index],cityName:'上海',address:'测试地址',available:true},additionalInfo:{poiId:'test-'+index,coordinate:point(index),introduce:'这是接口返回的地点介绍'},urlInfo:{h5Url:'https://m.ctrip.com/ticket/1'}}];
    }else if(rpc.params.name==='query_hotel'){
      if(args.checkInDate!=='2026-11-01'||args.checkOutDate!=='2026-11-03'||args.maxPrice!==600)throw Error('Hotel dates/budget missing at MCP seam');
      products=[0,1].map(index=>({basicInfo:{productID:'http-'+index,name:'测试酒店'+index,cityName:'上海',address:'测试酒店地址',price:480+index*50,score:4.7},additionalInfo:{coordinate:point(index),star:4,introduce:'携程返回的酒店描述'},urlInfo:{h5Url:'https://m.ctrip.com/webapp/hotel/hoteldetail/100'+index+'.html'}}));
    }else throw Error('Unexpected MCP tool');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:{content:[{type:'text',text:JSON.stringify(products)}]}}));
  }
  if(String(url).includes('overpass-api.de'))return new Response(JSON.stringify({elements:[{type:'node',id:123,...{lat:point(0).lat,lon:point(0).lng},tags:{name:names[0],opening_hours:'Tu-Su 09:00-17:00'}}]}));
  if(String(url)===process.env.DEEPSEEK_API_URL){
    const body=JSON.parse(options.body),system=body.messages[0].content,input=JSON.parse(body.messages[1].content);
    if(body.temperature===0.15){
      if(input.current)return model({reply:'已按你选择的'+input.current.hotels.candidates.find(h=>h.id===input.current.hotels.selectedId)?.name+'保留住宿安排。'});
      if(!input.pending)return model({city:'上海',conditions:{dayCount:3},hotelPreferences:{requested:true},question:'酒店预算和入住日期是什么？',questionField:'hotelBudget'});
      return model({city:'上海',conditions:{dayCount:3,startDate:'2026-11-01'},hotelPreferences:{requested:true,budgetMax:600,roomCount:1,adultCount:2,checkIn:'2026-11-01',checkOut:'2026-11-03'},question:'还要问一次预算',questionField:'hotelBudget'});
    }
    if(system.startsWith('你是旅行需求分析器'))return model({city:'上海',interests:['人文'],requestedPlaces:[]});
    if(system.startsWith('你是城市旅行策划师'))return model({city:'上海',title:'上海三日图文计划',rationale:'按三天安排不同地点',stops:names.map(name=>({name,city:'上海',reason:'适合慢游',alternatives:[]}))});
    if(system.startsWith('你负责根据用户和已规划行程确定住宿检索条件'))return model({requested:true,cityName:'上海',landmarkName:'静安寺'});
    if(system.startsWith('你是 Citywalk Scope 的行程决策助手。')){
      if(input.current.hotels?.candidates?.length!==2||!input.current.stops[0].guide?.openingText)throw Error('Hotels or web sources missing from DS facts');
      return model({actions:[],reason:'结合酒店、地点资料和交通安排好了三日计划。'});
    }
    throw Error('Unexpected model prompt');
  }
  return previousFetch(url,options);
};
