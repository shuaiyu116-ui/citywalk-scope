require('./w07-offline.cjs');
const previous=global.fetch;
global.fetch=async(url,options={})=>{
  if(String(url)===process.env.DEEPSEEK_API_URL){
    const body=JSON.parse(options.body);
    if(body.temperature===0.15){
      if(options.headers.Authorization.includes('fail-fixture'))return new Response('{}',{status:503});
      if(options.headers.Authorization.includes('auth-fixture'))return new Response('{"error":"vendor-secret-must-not-leak"}',{status:401});
      if(options.headers.Authorization.includes('slow-fixture'))await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,5000);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('cancelled'));},{once:true});});
      const input=JSON.parse(body.messages[1].content),r=input.current;
      let plan;
      if(!r){
        if(input.request.includes('城市未定'))plan={question:'想在哪座城市游玩？'};
        else if(['6天','六天','6'].includes(input.request))plan={question:'想玩几天？'};
        else if(input.request==='上海已填天数'){
          if(input.known?.conditions?.dayCount!==4||input.explicitContext?.dayCount!==4)throw Error('Form context omitted from conversation input');
          plan={city:'上海',question:'想玩几天？',conditions:{dayCount:1}};
        }
        else plan={city:'上海',conditions:input.request.includes('步行')?{transportMode:'walking'}:{}};
      }
      else if(input.request.includes('换一个'))plan={question:'要替换哪一站？'};
      else if(input.request.includes('预算'))plan={actions:[{type:'budget',maxWalkKm:2}]};
      else if(input.request.includes('删除'))plan={actions:[{type:'remove',stopId:r.stops[2].id}]};
      else if(input.request.includes('换成'))plan={actions:[{type:'replace',stopId:r.stops[0].id,name:'景山公园',city:'北京'}]};
      else plan={actions:[{type:'visit',stopId:r.stops[0].id,stayMinutes:20}]};
      return new Response(JSON.stringify({usage:{prompt_tokens:200,completion_tokens:40},choices:[{message:{content:JSON.stringify(plan)}}]}));
    }
  }
  return previous(url,options);
};
