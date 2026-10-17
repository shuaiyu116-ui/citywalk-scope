import { amapLink, positionWgs84 } from './navigation.mjs';
import { completedCount } from './journey.mjs';
import { modeLabels } from './transport.mjs';
const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(text,fn)=>{const n=el('button',text);n.type='button';n.onclick=fn;return n;};
const link=(text,to,from,mode)=>{const a=el('a',text);a.href=amapLink(to,from,mode);a.target='_blank';a.rel='noopener noreferrer';return a;};
export function createNavigationView({root,getSession,stage,commit,selectStop,isBusy,retryTransport,revealEditor}) {
  let identity='',seq=0,controller,origin=null,rawGps=null,result=null,message='',busy=false,geoBusy=false;
  let city='',dayId='',mode='walking',radius='2',selectedOrigin='',system='wgs84';
  let statusNode,resultsNode,originNode;
  const version=()=>{const r=getSession()?.current;return r?`${r.id}:${r.revision.number}`:'';};
  const cancel=()=>{seq++;controller?.abort();busy=false;geoBusy=false;};
  function ready(){if(isBusy() || getSession()?.draft || getSession()?.busy){message='请先结束规划、提交或放弃编辑草稿，再操作途中行程。';paint();return false;}return true;}
  function paint(){
    if(!statusNode)return;statusNode.textContent=message;
    for(const a of root.querySelectorAll('[data-stop-nav]')) {const s=getSession().current.stops.find(s=>s.id===a.dataset.stopNav);if(s)a.href=amapLink(s,origin,mode);}
    originNode.textContent=origin?`发现起点：${origin.name}${origin.accuracy!=null?` · 定位精度约 ${Math.round(origin.accuracy)} 米`:''}`:'选择一个起点，发现附近值得去的地方。';
    root.querySelector('[data-search]').disabled=busy || geoBusy;
    root.querySelector('[data-locate]').disabled=geoBusy;
    root.querySelector('[data-cancel]').hidden=!busy&&!geoBusy;
    resultsNode.replaceChildren();
    if(!result)return;
    resultsNode.append(el('p',result.message));
    if(!result.pois.length)resultsNode.append(el('p','范围内未返回真实地点；可调整城市、起点或范围后重试。此查询只覆盖携程可返回的景点，并非全部商户。'));
    for(const poi of result.pois){
      const travel=poi.travel,row=el('article','');row.className='nearby-result';
      row.append(el('strong',poi.name),el('p',[poi.city,poi.address].filter(Boolean).join(' · ')),el('p',`直线距离 ${(poi.straightLineMeters/1000).toFixed(2)} km`));
      if(Number.isFinite(travel?.durationMinutes))row.append(el('p',`${modeLabels[result.mode]}${travel.status==='estimated'?'粗估':'参考'} ${travel.durationMinutes} 分钟${Number.isFinite(travel?.distanceMeters)?` · ${(travel.distanceMeters/1000).toFixed(2)} km`:''}；实际耗时查看高德`));
      row.append(el('small','地点来自携程'),link('高德前往此地',poi,origin,result.mode));
      const add=button('加入剩余行程草稿',()=>{
        if(!ready())return;
        const accepted=stage({type:'add-nearby',dayId,poi});
        message=accepted?'已按直线增量选择剩余行程的插入位置，保留已游览与预订。请在“行程编辑”审阅、计算道路并提交；不保证最优。':'未能加入，请在“行程编辑”查看具体原因。';paint();
        if(revealEditor)revealEditor();
        else {document.getElementById('itineraryEditor').open=true;document.getElementById('itineraryEditor').scrollIntoView({block:'nearest'});}
      });
      const present=getSession().current.stops.some(s=>s.poiId===poi.id || (s.name===poi.name && s.city===poi.city));add.disabled=present;if(present)add.textContent='已在行程中';row.append(add);resultsNode.append(row);
    }
  }
  function invalidateLocation(){cancel();result=null;message='起点或查询条件已改变，请重新查询附近。';paint();}
  async function search(){
    if(!origin){message='请先定位或手动选择起点。';paint();return;}
    cancel();const token=seq,base=version();const requestController=controller=new AbortController();busy=true;result=null;message='正在查询真实附近景点并计算前往交通…';paint();
    const timer=setTimeout(()=>requestController.abort(),45000);
    try{
      const response=await fetch('/api/places/nearby',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({city:city.trim(),origin:origin.location,radiusKm:Number(radius),mode}),signal:requestController.signal});
      const value=await response.json();if(token!==seq || version()!==base)return;
      if(!response.ok)throw Error(value.error || '附近服务暂不可用');
      result=value;message='查询完成。加入只创建草稿；定位起点仅用于附近发现和高德跳转，不替换原行程起点。';
    }catch(e){if(token===seq)message=e.name==='AbortError'?'查询已取消或超时，可重试；没有使用示例结果。':e.message;}
    finally{clearTimeout(timer);if(token===seq){busy=false;paint();}}
  }
  function locate(){
    cancel();result=null;rawGps=null;
    if(!navigator.geolocation){message='当前浏览器不支持定位，请手动选择起点。';paint();return;}
    const token=seq;geoBusy=true;message='等待浏览器定位授权；拒绝后仍可手动选择起点。';paint();
    navigator.geolocation.getCurrentPosition(p=>{
      if(token!==seq)return;geoBusy=false;rawGps={lat:p.coords.latitude,lng:p.coords.longitude};
      origin={name:'浏览器定位',location:positionWgs84(rawGps,system),accuracy:p.coords.accuracy};
      message='已获取一次位置。请核对城市及坐标系；定位误差较大时建议手动选已知地点。';paint();
    },()=>{if(token!==seq)return;geoBusy=false;message='定位被拒绝、超时或不可用，请使用下面的手动起点。';paint();},{enableHighAccuracy:true,timeout:12000,maximumAge:0});
  }
  function render(){
    const route=getSession()?.current;if(!route)return;
    if(identity!==version()){const newTrip=identity.split(':')[0]!==route.id;cancel();result=null;identity=version();message='';if(newTrip){origin=null;rawGps=null;selectedOrigin='';city=route.stops[0]?.city || route.city;}}
    if(!route.days.some(d=>d.id===dayId))dayId=route.stops.find(s=>!s.progress?.completed)?.dayId || route.days.at(-1).id;
    root.replaceChildren(el('summary','导航与途中发现'));
    root.append(el('p','在高德中查看每一站的实际路线与出行时间。点击地点可查看地图，途中也可以发现附近景点。定位只在主动点击时获取一次。'));
    if(retryTransport && route.legs.some(leg=>['unknown','unavailable'].includes(leg.status)))root.append(button('更新路线预览',()=>{if(!isBusy())retryTransport();}));
    const count=completedCount(route),list=el('ol','');
    route.stops.forEach((stop,i)=>{
      const row=el('li',''),a=link('高德导航',stop,origin,mode);a.dataset.stopNav=stop.id;row.append(button(`${stop.progress?.completed?'✓ 已游览 · ':''}${stop.name}`,()=>selectStop(i)),a);
      const incoming=route.legs.find(leg=>leg.toStopId===stop.id),previous=incoming && route.stops.find(item=>item.id===incoming.fromStopId);
      if(previous){row.append(link(`从${previous.name}出发`,stop,previous,incoming.mode || incoming.preferredMode));if(Number.isFinite(incoming.durationMinutes))row.append(el('small',`${modeLabels[incoming.mode || incoming.preferredMode] || '交通'}${incoming.status==='estimated'?'粗估':'参考'} ${Math.ceil(incoming.durationMinutes)} 分钟`));}
      if(i===count || i===count-1)row.append(button(stop.progress?.completed?'撤销此站游览标记':'标记已游览',async()=>{if(!ready())return;if(stage({type:'visited',stopId:stop.id}))await commit(true);}));
      list.append(row);
    });root.append(list,el('p','按顺序标记已游览，保存的是当时的计划时刻，不是实际到离时间。已完成安排受到保护；改动可在编辑器撤销。'));
    const form=el('div','');form.className='nearby-controls';
    const locateButton=button('使用我的位置',locate);locateButton.dataset.locate='';form.append(locateButton);
    const select=(label,options,value,onChange)=>{const l=el('label',label),s=el('select','');s.setAttribute('aria-label',label);for(const [v,t]of options){const o=el('option',t);o.value=v;s.append(o);}s.value=value;s.onchange=()=>onChange(s.value);l.append(s);form.append(l);return s;};
    select('浏览器定位坐标系',[['wgs84','标准 GPS / WGS84'],['gcj02','GCJ02（设备已偏移时）']],system,v=>{system=v;if(rawGps)origin={...origin,location:positionWgs84(rawGps,system)};invalidateLocation();});
    select('手动选择发现起点',[['','请选择行程地点'],...route.stops.map(s=>[s.id,`${s.city || route.city} · ${s.name}`])],selectedOrigin,v=>{selectedOrigin=v;const s=route.stops.find(s=>s.id===v);origin=s?{name:s.name,location:{...s.location}}:null;rawGps=null;if(s){city=s.city || route.city;cityInput.value=city;}invalidateLocation();});
    const label=el('label','所在城市'),cityInput=el('input','');cityInput.value=city;cityInput.maxLength=80;cityInput.setAttribute('aria-label','附近查询城市');cityInput.oninput=()=>{city=cityInput.value;invalidateLocation();};label.append(cityInput);form.append(label);
    select('发现半径',[['1','1 km'],['2','2 km'],['5','5 km'],['8','8 km']],radius,v=>{radius=v;invalidateLocation();});
    select('前往方式',Object.entries(modeLabels).filter(([k])=>k!=='mixed'),mode,v=>{mode=v;invalidateLocation();});
    select('加入哪一天',route.days.map(d=>[d.id,`第 ${d.index} 天 · ${d.date || '日期未定'}`]),dayId,v=>{dayId=v;});
    const searchButton=button('查询附近真实地点',search);searchButton.dataset.search='';const cancelButton=button('取消查询/定位',()=>{cancel();message='已取消；迟到的位置或查询结果不会采用。';paint();});cancelButton.dataset.cancel='';form.append(searchButton,cancelButton);
    root.append(form,el('p','浏览器标准定位按 WGS84 处理；若设备提供 GCJ02，请明确切换。手动地点始终使用已存 WGS84。定位仅用于本次查询，不保存到行程或导出。'));
    originNode=el('p','');statusNode=el('p','');statusNode.setAttribute('role','status');resultsNode=el('div','');resultsNode.className='nearby-results';root.append(originNode,statusNode,resultsNode);paint();
  }
  return {render};
}

