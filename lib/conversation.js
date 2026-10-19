'use strict';
const { normalizeTripInput }=require('./itinerary');
const { redistribute }=require('./conversation-operations');
const { PlanningError }=require('./planning-error');
const {QUESTION_FIELDS,normalizeHotelPreferences}=require('./conversation-preflight');
const modules=Promise.all([import('../public/itinerary-editor.mjs'),import('../public/conversation-state.mjs'),import('../public/profile-schema.mjs')]);
class Clarification extends Error {constructor(question,pending={}){super(question);this.code='CLARIFY';this.pending=pending;}}
async function conversationInput(value={}) {
  const [,{normalizePreferences,cleanText},{profileForPlanning}]=await modules;
  if(!['new','edit'].includes(value.mode))throw Error('对话模式无效');
  return {mode:value.mode,preferences:normalizePreferences(value.preferences),profile:profileForPlanning(value.profile),messages:Array.isArray(value.messages)?value.messages.slice(-10).filter(message=>message&&['user','assistant'].includes(message.role)).map(message=>({role:message.role,content:cleanText(message.content,600)})):[],changes:Array.isArray(value.changes)?value.changes.slice(0,8).map(v=>cleanText(v,160)):[],pending:value.pending?{request:cleanText(value.pending.request,500),question:cleanText(value.pending.question,240),city:cleanText(value.pending.city,80).trim(),conditions:normalizeTripInput(value.pending.conditions),hotelPreferences:normalizeHotelPreferences(value.pending.hotelPreferences),preflightAsked:value.pending.preflightAsked===true,field:QUESTION_FIELDS.includes(value.pending.field)?value.pending.field:null}:null};
}
async function applyConversationActions(base, actions, {run,search}) {
  const [{editRoute},{cleanText}]=await modules;
  if(!Array.isArray(actions)||!actions.length||actions.length>12)throw new Clarification('请说明想调整的内容；可以同时修改天数并增加地点。');
  let route=structuredClone(base);const changes=[],notices=[];
  const spread=actions.filter(action=>action.type==='redistribute');
  if(spread.length>1)throw new Clarification('本次要安排几天？请给出一个确定的天数。');
  if(spread.length){
    try{route=await run.call('edit',`重新安排为 ${spread[0].dayCount} 天`,()=>redistribute(route,spread[0].dayCount));}
    catch(error){run.check();if(error.code==='AGENT_LIMIT')throw error;throw new Clarification(error.message);}
    changes.push(`保留现有地点，重新分散到 ${spread[0].dayCount} 天`);
  }
  for(const raw of actions){
    if(raw.type==='redistribute')continue;
    run.check();let action,label;
    const stop=route.stops.find(s=>s.id===raw.stopId);
    let day=route.days.find(d=>d.id===raw.dayId) || (Number.isInteger(raw.dayIndex)?route.days[raw.dayIndex-1]:null);
    if(raw.type==='add'&&!raw.dayId&&raw.dayIndex===undefined)day=[...route.days].sort((a,b)=>a.stopIds.length-b.stopIds.length||a.index-b.index)[0];
    if(['remove','move','assign-day','visit','lock','replace'].includes(raw.type)&&!stop)throw new Clarification('要修改哪个地点？请用当前地点全名说明；重复到访请附上第几天。');
    switch(raw.type){
      case 'hotel': {
        const hotel=route.hotels?.candidates?.find(candidate=>candidate.id===raw.hotelId);
        if(!hotel)throw new Clarification('请从当前已查询的酒店候选中选择；也可说明预算或区域重新找酒店。');
        action={type:'hotel',hotelId:hotel.id};label=`选择住宿参考：${hotel.name}`;break;
      }
      case 'visit': {
        const visit={...stop.visit};
        for(const field of ['stayMinutes','restMinutes'])if(raw[field]!==undefined)visit[field]=raw[field];
        action={type:'visit',stopId:stop.id,visit};label=`${stop.name}：停留 ${visit.stayMinutes ?? '默认'} 分钟，休息 ${visit.restMinutes ?? 0} 分钟`;break;
      }
      case 'remove': action={type:'remove',stopId:stop.id};label=`删除 ${stop.name}`;break;
      case 'move': action={type:'move',stopId:stop.id,offset:raw.offset};label=`${stop.name} ${raw.offset===-1?'前移':'后移'}一站`;break;
      case 'assign-day': if(!day)throw new Clarification('请指定已有的第几天；需要增加天数可先说“增加一天”。');action={type:'assign-day',stopId:stop.id,dayId:day.id};label=`${stop.name} 移到第 ${day.index} 天`;break;
      case 'lock': if(stop.locked)continue;action={type:'lock',stopId:stop.id};label=`设为必去：${stop.name}`;break;
      case 'day': if(!day)throw new Clarification('请指定要调整第几天。');action={type:'day',dayId:day.id,date:raw.date===undefined?day.date:raw.date,start:raw.start===undefined?day.requestedWindow.start:raw.start,end:raw.end===undefined?day.requestedWindow.end:raw.end,restMinutes:raw.restMinutes===undefined?day.restMinutes:raw.restMinutes,lodging:day.lodging?.text};label=`第 ${day.index} 天：${action.date || '日期未定'} ${action.start || '未定'}–${action.end || '未定'}，休息 ${action.restMinutes || 0} 分钟`;break;
      case 'add-day': action={type:'add-day'};label='增加一天';break;
      case 'remove-day':action={type:'remove-day',dayId:raw.dayId};label=`删除空白的第 ${day?.index || '?'} 天`;break;
      case 'mode':{
        const leg=route.legs.find(l=>l.id===raw.legId);if(!leg||leg.booking)throw new Clarification('请指定普通路段；已有预订请到分日编辑中修改。');
        action={type:'mode',legId:leg.id,mode:raw.mode};label=`${route.stops.find(s=>s.id===leg.fromStopId).name} → ${route.stops.find(s=>s.id===leg.toStopId).name}：${{walking:'步行',cycling:'骑行',driving:'自驾',taxi:'打车',transit:'公共交通',mixed:'混合'}[raw.mode] || '未知方式'}`;break;
      }
      case 'budget':{
        const values=normalizeTripInput({maxWalkKm:raw.maxWalkKm});if(values.maxWalkKm===undefined)throw new Clarification('每天最多步行多少公里？');
        route.context.maxWalkKm=values.maxWalkKm;route.context.fieldSources.maxWalkKm='user';changes.push(`每日步行预算 ${values.maxWalkKm} 公里`);continue;
      }
      case 'add':case 'replace':{
        if(raw.type==='add'&&!day)throw new Clarification('要把新地点放在第几天？');
        const target={name:cleanText(raw.name,80).trim(),city:cleanText(raw.city,80).trim(),addressHint:cleanText(raw.addressHint,160).trim()};
        if(!target.name || !target.city)throw new Clarification('请提供新地点的全名和所属城市。');
        const matched=await run.call('places',`核对新地点：${target.city} · ${target.name}`,()=>search(target));
        if(matched.status!=='matched' || matched.candidates.length!==1){
          if(raw.type==='add'&&raw.recommended===true){notices.push(`${target.name}暂未核对成功，未加入行程。`);continue;}
          throw new Clarification(matched.status==='ambiguous'?'找到同名地点，请补充地址或分店名称；也可用编辑器选择具体结果。':'未找到唯一匹配的地点，请补充正式名称和城市，或使用编辑器检索。');
        }
        action={type:raw.type,stopId:stop?.id,dayId:day?.id,poi:matched.candidates[0]};label=raw.type==='add'?`第 ${day.index} 天加入 ${target.name}`:`${stop.name} 换为 ${target.name}`;break;
      }
      default:throw new Clarification('这项修改请在行程编辑器中明确填写；对话可调整地点、排序、日期、时段、停留、休息和交通。开放规则和预订不会由模型编造。');
    }
    try {
      const next=await run.call('edit',label,()=>editRoute(route,action));
      // Active user edits may alter visits/days, but never silently drop fixed bookings.
      for(const leg of route.legs.filter(l=>l.booking))if(!next.legs.some(l=>l.id===leg.id && JSON.stringify(l.booking)===JSON.stringify(leg.booking)))throw new Clarification('这项修改会移除已有预订，请先在编辑器中处理该预订，再继续。');
      route=next;changes.push(label);
    }catch(error){if(error.code==='CLARIFY'||error.code==='AGENT_LIMIT')throw error;run.check();throw new Clarification(stop?.locked?'该地点是必去点；若要删除或替换，请先在编辑器明确解锁。':'修改与当前日期、地点数量或输入范围冲突，请核对后说明；当前行程未改变。');}
  }
  if(spread.length)route=await redistribute(route,spread[0].dayCount);
  if(!changes.length&&notices.length)throw new PlanningError('PLACES_UNMATCHED');
  if(!changes.length)throw new Clarification('这些条件已经满足，可以继续说明其他修改。');
  return {route,changes,notices};
}
module.exports={Clarification,conversationInput,applyConversationActions};
