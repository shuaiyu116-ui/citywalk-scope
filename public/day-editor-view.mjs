const el = (tag, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
const field = (form, name, label, value, type = 'text') => {
  const wrap = el('label',label), input = el('input'); input.name=name; input.type=type; input.value=value ?? ''; input.setAttribute('aria-label',label);
  wrap.append(input); form.append(wrap); return input;
};
export function renderDayEditor(route, dayId, stage) {
  const day = route.days.find(d => d.id === dayId), form = el('form'); form.className='day-form';
  form.append(el('h4',`第 ${day.index} 天设置`));
  field(form,'date','本日日期',day.date,'date');
  field(form,'start','本日开始',day.requestedWindow?.start,'time'); field(form,'end','本日结束',day.requestedWindow?.end,'time');
  const rest = field(form,'restMinutes','本日游玩前休息（分钟）',day.restMinutes || 0,'number'); rest.min=0; rest.max=720; rest.step=1;
  field(form,'lodging','住宿/夜间位置备注（仅记录，不自动定位或核实）',day.lodging?.text).maxLength=300;
  const stops=route.stops.filter(s => s.dayId === day.id);
  for (const [name,label,value] of [['startStopId','当天起点',stops[0]?.id],['endStopId','当天终点',stops.at(-1)?.id]]) {
    const wrap=el('label',label), select=el('select'); select.name=name; select.setAttribute('aria-label',label);
    for (const stop of stops) {const o=el('option',stop.name);o.value=stop.id;select.append(o);} select.value=value || '';select.disabled=!stops.length; wrap.append(select);form.append(wrap);
  }
  form.append(el('p','起终点从当天已核对地点中选择；酒店、车站可先检索加入。日期按北京时间，结束较早表示次日；住宿备注不参与交通推算。'));
  const save=el('button','每日设置加入草稿'); save.type='submit';form.append(save);
  form.addEventListener('submit',e => {e.preventDefault();stage({type:'day',dayId:day.id,...Object.fromEntries(new FormData(form))});});
  return form;
}
export function bookingEditor(leg, stage) {
  const details=el('details');details.className='booking-editor';details.append(el('summary',leg.booking?'编辑已填写的预订交通':'填写已预订交通（含日期与接驳）'));
  const form=el('form');form.className='day-form';const b=leg.booking || {};
  field(form,'label','车次/航班或交通备注（选填）',b.label).maxLength=120;
  field(form,'departure','交通出发日期时间',b.departure,'datetime-local').required=true;
  field(form,'arrival','交通到达日期时间',b.arrival,'datetime-local').required=true;
  for(const [key,label] of [['beforeMinutes','前一地点到发车/起飞的接驳和候车（分钟）'],['afterMinutes','到站/落地到后一地点的接驳（分钟）']]) {
    const input=field(form,key,label,b[key],'number');input.min=0;input.max=1440;input.step=1;input.placeholder='未知留空，明确无需接驳可填0';
  }
  form.append(el('p','请按真实预订填写北京时间。不会查询或编造班次、余票或住宿；地图只显示地点间虚线，不能作为铁路/航线导航。'));
  const save=el('button','交通时间加入草稿');save.type='submit';form.append(save);
  form.addEventListener('submit',e => {e.preventDefault();stage({type:'booking',legId:leg.id,booking:Object.fromEntries(new FormData(form))});});
  if(b.departure) {const clear=el('button','清除预订时间，恢复道路方式');clear.type='button';clear.addEventListener('click',()=>stage({type:'booking',legId:leg.id,booking:null}));form.append(clear);}
  details.append(form);return details;
}
