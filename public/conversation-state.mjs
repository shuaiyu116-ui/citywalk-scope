export const interestOptions = ['建筑','历史','艺术','自然','美食','咖啡','摄影','购物'];
export const paceOptions = ['轻松','适中','紧凑'];
export function cleanText(value, max=300) {
  return typeof value === 'string' ? value.replace(/\bsk-[a-zA-Z0-9_-]+/g,'[已隐藏密钥]').replace(/Bearer\s+\S+/gi,'[已隐藏凭据]').slice(0,max) : '';
}
export function normalizePreferences(value={}) {
  return { interests: interestOptions.filter(v=>Array.isArray(value?.interests)&&value.interests.includes(v)), pace:paceOptions.includes(value?.pace)?value.pace:'', transportMode:['walking','cycling','transit','driving','taxi','mixed'].includes(value?.transportMode)?value.transportMode:'',maxWalkKm:value?.maxWalkKm!=='' && value?.maxWalkKm!=null && Number.isFinite(Number(value.maxWalkKm)) && Number(value.maxWalkKm)>=0 && Number(value.maxWalkKm)<=50 ? Number(value.maxWalkKm):null };
}
export function routeSummary(route) {
  if(!route)return null;
  return {tripId:route.id,revision:route.revision.number,city:cleanText(route.city,80),days:route.days.length,visits:route.stops.length,completed:route.stops.filter(s=>s.progress?.completed).length,locked:route.stops.filter(s=>s.locked).slice(0,12).map(s=>cleanText(s.name,80)),context:{transportMode:route.context.transportMode,maxWalkKm:route.context.maxWalkKm}};
}
// Bounded page memory only; never persisted or exported with the itinerary.
export class ConversationState {
  constructor(){this.preferences=normalizePreferences();this.reset();}
  reset(){this.mode='new';this.pending=null;this.turns=0;this.changes=[];this.summary=null;this.messages=[];}
  accept(route,changes=[]){this.mode='edit';this.pending=null;this.turns++;this.summary=routeSummary(route);this.changes=changes.slice(0,8).map(v=>cleanText(v,160));}
  request(route){return {mode:this.mode,preferences:normalizePreferences(this.preferences),summary:this.mode==='edit'?routeSummary(route):null,changes:this.changes,pending:this.pending,messages:this.messages.slice(-10).map(message=>({role:message.role,content:cleanText(message.content,600)}))};}
}

