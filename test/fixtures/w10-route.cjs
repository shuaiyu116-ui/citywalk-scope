const { createItinerary, resolveTripContext } = require('../../lib/itinerary');
module.exports = function fixture() {
  const route = createItinerary({ city: '上海', title: '跨年慢游测试', summary: '原始摘要：两小时走完（编辑后不保证）', stops: ['起点公园','老街','车站','终点展馆'].map((name,i) => ({ name, city: '上海', note: '推荐描述', location: {lat:31.2+i*.005,lng:121.4+i*.005}, source:'ctrip', provider:'ctrip-mcp', retrievedAt:'2026-10-16T10:00:00Z', detailUrl:'https://example.com/place', openingHours:{status:'reported',text:'供应商说09:00–17:00',source:'ctrip-mcp',retrievedAt:'2026-10-16T10:00:00Z'} })) }, resolveTripContext({ dayCount:3, startDate:'2026-12-30', dailyStartTime:'09:00', dailyEndTime:'19:00', companions:['children','wheelchair'], transportMode:'driving', maxWalkKm:2 }), {source:'deepseek',poiSource:'ctrip'});
  route.stops[2].dayId=route.days[2].id;
  for(const d of route.days){d.stopIds=route.stops.filter(s=>s.dayId===d.id).map(s=>s.id);d.legIds=[];}
  route.legs.forEach((l,i)=>{
    l.dayId=route.stops[i+1].dayId;l.fromDayId=route.stops[i].dayId;l.kind=l.dayId!==l.fromDayId?'interday':'local';
    route.days.find(d=>d.id===l.dayId).legIds.push(l.id);
    if(i===0)Object.assign(l,{mode:'walking',status:'estimated',distanceMeters:1200,durationMinutes:20,source:'local-estimate',estimate:{straightLineMeters:1000,detourFactor:1.2,speedKmh:3.6}});
    if(i===1)Object.assign(l,{mode:'transit',status:'scheduled',source:'user',durationMinutes:510,booking:{departure:'2026-12-31T23:30',arrival:'2027-01-01T08:00',label:'用户记录测试班次',beforeMinutes:null,afterMinutes:15,durationMinutes:510,source:'user',verifiedAt:null}});
  });
  route.stops[0].visit={stayMinutes:20,openingRules:{periods:[{start:'09:00',end:'17:00'}],closedWeekdays:[1],closedDates:['2026-12-30'],note:'用户查阅说明',recordedAt:'2026-10-16T11:00:00Z'}};
  route.days[2].lodging={text:'住宿由用户备注',source:'user',status:'user-reported'};
  route.revision.number=4;route.revision.reason='user-edit';
  return route;
};
