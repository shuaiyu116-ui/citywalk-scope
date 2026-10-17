// User-reported progress is separate from supplier facts and actual GPS tracks.
export function normalizeProgress(input) {
  if (!input?.completed) return null;
  const s = input.schedule || {};
  const times = {};
  for (const key of ['arrival','visitStart','visitEnd','departure']) {
    const t = s[key];
    if (t == null) { times[key] = null; continue; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) || !Number.isInteger(t.dayOffset) || t.dayOffset < 0 || t.dayOffset > 60 || (t.date != null && (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !Number.isFinite(Date.parse(t.date+'T00:00:00Z')) || new Date(t.date+'T00:00:00Z').toISOString().slice(0,10)!==t.date))) throw Error('已游览记录的时间格式无效');
    times[key] = {date:t.date || null,time:t.time,dayOffset:t.dayOffset};
  }
  const values = {};
  for (const key of ['stayMinutes','restMinutes','waitMinutes']) {
    const n=s[key]; if(n != null && (!Number.isFinite(n) || n<0 || n>86400)) throw Error('已游览记录的时长无效');
    values[key]=n ?? null;
  }
  return {completed:true,source:'user',schedule:{...times,...values,status:'unknown',timingBasis:'user-history',staySource:'user-history',openingSource:null,checks:[{code:'visited-history',status:'unknown',message:'用户标记已游览；保留标记时的计划，不是实际到离记录或营业认证'}]}};
}

export const completedCount = route => route.stops.filter(s=>s.progress?.completed).length;
export function assertProgress(route) {
  let unfinished=false;
  for(const stop of route.stops) { if(!stop.progress?.completed) unfinished=true; else if(unfinished) throw Error('请按行程顺序标记已游览，已完成地点必须在行程前部'); }
}
export function protectHistory(before, after) {
  const done=before.stops.filter(s=>s.progress?.completed);
  for(let i=0;i<done.length;i++) {
    const a=done[i],b=after.stops[i];
    if(!b || ['id','dayId','visit','progress'].some(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]))) throw Error('已游览的地点、顺序和安排已保护；如需修正请先撤销已游览标记');
    const oldDay=before.days.find(d=>d.id===a.dayId),newDay=after.days.find(d=>d.id===a.dayId);
    if(['date','requestedWindow','restMinutes'].some(k=>JSON.stringify(oldDay[k])!==JSON.stringify(newDay?.[k]))) throw Error('已有游览记录的日期和开始条件已保护，请先撤销标记');
  }
  const visited=new Set(done.map(s=>s.id));
  for(const l of before.legs.filter(l=>visited.has(l.toStopId))) {
    const next=after.legs.find(n=>n.id===l.id);
    if(!next || ['fromStopId','toStopId','preferredMode','booking'].some(k=>JSON.stringify(l[k])!==JSON.stringify(next[k]))) throw Error('已完成的路段不可修改，请先撤销游览标记');
  }
  assertProgress(after);
}

export function distanceMeters(a,b) {
  const rad=n=>n*Math.PI/180;
  const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
  return 12742000*Math.asin(Math.sqrt(Math.min(1,h)));
}

// Insert into the remaining part of the chosen day, minimizing additional
// straight-line distance. This is a heuristic, never a road/time optimum.
export function insertRemaining(route, addedId) {
  const added=route.stops.find(s=>s.id===addedId),rest=route.stops.filter(s=>s.id!==addedId);
  const dayIndex=route.days.findIndex(d=>d.id===added.dayId);
  const laterDone=rest.some(s=>s.progress?.completed && route.days.findIndex(d=>d.id===s.dayId)>dayIndex);
  if(laterDone) throw Error('不能在已游览的日期之前加入地点');
  const candidates=[];
  for(let i=0;i<=rest.length;i++) {
    const prev=rest[i-1],next=rest[i];
    if(next?.progress?.completed) continue;
    if(prev && route.days.findIndex(d=>d.id===prev.dayId)>dayIndex) continue;
    if(next && route.days.findIndex(d=>d.id===next.dayId)<dayIndex) continue;
    if(prev && next && route.legs.some(l=>l.booking && l.fromStopId===prev.id && l.toStopId===next.id)) continue;
    const cost=(prev?distanceMeters(prev.location,added.location):0)+(next?distanceMeters(added.location,next.location):0)-(prev&&next?distanceMeters(prev.location,next.location):0);
    candidates.push({i,cost});
  }
  if(!candidates.length) throw Error('没有可保留已游览和预订交通的插入位置，请手动编辑后再加入');
  candidates.sort((a,b)=>a.cost-b.cost || a.i-b.i);
  rest.splice(candidates[0].i,0,added);route.stops=rest;
}
