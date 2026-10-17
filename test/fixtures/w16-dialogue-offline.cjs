require('./w08-offline.cjs');
const previous=global.fetch;
let repeated=false;
global.fetch=async(url,options={})=>{
  if(String(url)===process.env.CTRIP_API_BASE_URL){
    const {matchTarget}=JSON.parse(options.body);
    const index=['上海博物馆','上海环球港'].indexOf(matchTarget.name);
    if(index>=0)return new Response(JSON.stringify({pois:[{id:`dialogue-${index}`,name:matchTarget.name,city:'上海',location:{lat:31.22+index*.002,lng:121.44}}]}));
  }
  if(String(url)===process.env.DEEPSEEK_API_URL){
    const body=JSON.parse(options.body);
    if(body.messages[0]?.content.startsWith('你是 Citywalk Scope 的行程决策助手。')){
      return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:20},choices:[{message:{content:JSON.stringify({actions:[],reason:'根据返回的地点和交通结果，保留本轮分天和新增安排。'})}}]}));
    }
    if(body.temperature===0.15){
      const state=JSON.parse(body.messages[1].content),request=body.messages.at(-1).content;
      if(request==='同时'||request.includes('分散到四天')){
        if(request==='同时'&&!repeated){repeated=true;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({question:state.pending.question})}}]}));}
        if(request==='同时'&&!body.messages.some(message=>message.role==='assistant'&&message.content===state.pending.question))throw Error('Missing assistant clarification turn');
        const plan={reply:'我会保留原有地点，分成四天，并加入推荐的景点和商场供你确认。',actions:[{type:'redistribute',dayCount:4},{type:'add',name:'上海博物馆',city:'上海',recommended:true},{type:'add',name:'上海环球港',city:'上海',recommended:true}]};
        return new Response(JSON.stringify({usage:{prompt_tokens:200,completion_tokens:100},choices:[{message:{content:JSON.stringify(plan)}}]}));
      }
      if(request==='为什么这样安排？'){
        if(!state.current.legs.every(leg=>leg.status==='routed'&&Number.isFinite(leg.distanceMeters)&&Number.isFinite(leg.durationMinutes))||!state.current.days[0].schedule||!state.current.stops[0].schedule)throw Error('Current traffic and schedule omitted from conversation facts');
        return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:`已取得${state.current.legs.length}段道路的距离和耗时，可据此解释安排；地点开放信息仍需确认。`})}}]}));
      }
    }
  }
  return previous(url,options);
};
