import { openLibrary, appendVersion, parseBackup, backupText, localRoute, storageMessage, MAX_BACKUP_BYTES } from './library.mjs';
import { createPortable } from './portable-route.mjs';
import { renderRoadbook } from './roadbook.mjs';
import { cachedPhotos, collectRoadbookPhotos, downloadFile } from './roadbook-view.mjs';
import { copyIntent } from './share.mjs';
import { preserveFocus } from './ui-interactions.mjs';
const el = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
export function createLibraryView({ root, getRoute = () => null, blocked = () => false, adopt } = {}) {
  let db, selected = null, versionId = null, sequence = 0, controller, candidate, base, active = false;
  const status = el('p', '正在打开本机行程库…'); status.setAttribute('role','status');
  const warning = el('p', '仅保存在此设备、此浏览器、此网站地址（含端口）。换设备/地址、无痕窗口、清除网站数据或浏览器回收空间均可能丢失。没有云同步；请定期导出备份。主动保存才记入历史，最多保留最近20次，每条收藏24 MB。Key、对话、保存偏好、定位及内部签名不保存。本次同行、住宿、预订和已游览会保存，请妥善保管备份。');
  const controls = el('div',''); controls.className='library-actions';
  const group = (title, open=false) => { const d=el('details','');d.className='library-group';d.open=open;d.append(el('summary',title));return d; };
  const saveGroup=group(adopt?'保存与命名':'收藏命名'), backupGroup=group('导入 / 导出全部备份'), manageGroup=group('管理所选收藏');
  const backupControls=el('div',''), manageControls=el('div','');backupControls.className=manageControls.className='library-actions';
  const name = el('input',''); name.placeholder='收藏名称'; name.maxLength=100; name.setAttribute('aria-label','收藏名称');
  const search = el('input',''); search.type='search'; search.placeholder='按名称、城市或地点检索'; search.setAttribute('aria-label','检索本机收藏');
  const list = el('div',''), detail = el('section',''); list.className='library-list';
  const frame = el('iframe',''); frame.title='本机收藏路书预览'; frame.setAttribute('sandbox','allow-same-origin'); frame.className='library-preview';
  const msg = text => { status.textContent=text; };
  const button = (text, fn) => { const b=el('button',text); b.type='button'; b.addEventListener('click',async()=>{b.disabled=true;try{await run(fn);}finally{b.disabled=false;}}); return b; };
  async function run(fn) { try { await fn(); } catch(e) { msg(storageMessage(e)); } }
  const ready = async () => db || (db=await openLibrary());
  const selectedVersion = () => selected?.versions.find(v=>v.id===versionId);
  function stop() { sequence++; controller?.abort(); controller=null; candidate=null; }
  const show = () => {
    const restoreFocus=preserveFocus(detail);
    const historyOpen=detail.querySelector('.library-group')?.open || false;
    detail.replaceChildren(); const v=selectedVersion(); frame.srcdoc='';frame.hidden=!v; if(!v)return;
    const heading=el('h3',selected.name), versions=el('select',''); versions.setAttribute('aria-label','保存的历史版本');
    for (const item of [...selected.versions].reverse()) {const o=el('option',`${new Date(item.savedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · 行程版本 ${item.packet.route.revision.number}`);o.value=item.id;versions.append(o);} versions.value=v.id;
    versions.addEventListener('change',()=>{stop();versionId=versions.value;show();});
    detail.append(heading,el('p','本人完整快照 · 未核实本地数据。保留原分日、停留、开放规则、预订、已游览和计划；与清除作者个人记录的分享副本不同。地图重开不重新认证来源，可信多轮需联网重核。'),versions);
    const actions=el('div','');actions.className='library-actions';
    actions.append(button(adopt?'在当前页重开此版':'联网重开到规划页',async()=>{
      if(adopt){if(blocked())throw Error('请先结束规划、提交或放弃草稿。');await adopt(localRoute(v.packet),false);msg('本地版本已重开，可手动编辑及撤销；未联网核实，旧计划不表示今天可行。');}
      else {if(!navigator.onLine)throw Error('当前离线，可继续阅读路书；恢复联网后再打开地图编辑。');location.assign('/?library='+encodeURIComponent(selected.id)+'&version='+encodeURIComponent(v.id));}
    }),button('恢复此版为最新保存版本',async()=>{
      if(!confirm('将此历史版本另存为最新版本？现有版本仍保留，超过20次时移除最旧记录。'))return;
      selected=await (await ready()).mutate(selected.id,r=>appendVersion(r,r.name,v.packet.route,v.photos));versionId=selected.versions.at(-1).id;show();await refresh();msg('已恢复为最新保存版本；当前地图未自动改变，需点击重开。');
    }),button('导出此版 JSON',()=>downloadFile(JSON.stringify(v.packet,null,2),'application/json','citywalk-route.json')),
    button('下载此版离线 HTML',async()=>{
      msg('正在准备离线路书图片…');
      const photos=await collectRoadbookPhotos(v.packet.route,{photos:v.photos});
      downloadFile(renderRoadbook(v.packet,{photos}),'text/html;charset=utf-8','citywalk-roadbook.html');
      msg(`已下载离线路书，包含 ${Object.keys(photos).length} 张照片。`);
    }),
    button('导出此收藏全部历史',()=>downloadFile(backupText([selected]),'application/json','citywalk-library.json')),
    button('删除此历史版本',async()=>{
      if(selected.versions.length===1)throw Error('最后一个版本请使用“删除整个收藏”。');
      if(!confirm('确定删除此历史版本？请先按需导出。'))return;
      selected=await (await ready()).mutate(selected.id,r=>{r.versions=r.versions.filter(x=>x.id!==v.id);if(!r.versions.length)throw Error('不能删除最后一个版本');return r;});versionId=selected.versions.at(-1).id;show();msg('版本已删除。');
    }));
    if(adopt) actions.append(button('联网重核此版全部地点',()=>recheck(v)));
    const historyGroup=group('历史恢复与版本导出 / 删除',historyOpen);
    const historyActions=el('div','');historyActions.className='library-actions';
    // Reopen and recheck stay primary; the five history/file operations are secondary.
    for(const b of [...actions.children].slice(1,6))historyActions.append(b);
    historyGroup.append(historyActions);
    if(adopt){const cancel=button('取消重核',()=>{stop();show();msg('重核已取消，原行程与收藏未改变。');});cancel.dataset.cancelRecheck='';cancel.hidden=!controller;actions.append(cancel);}
    detail.append(actions,historyGroup);frame.srcdoc=renderRoadbook({...v.packet,imported:true},{photos:v.photos,interactive:false});
    restoreFocus();
  };
  async function recheck(v) {
    if(!navigator.onLine)throw Error('当前离线，仅能查看缓存路书；生成、地点查询和在线导航需要网络。');
    if(blocked())throw Error('请先结束规划、提交或放弃草稿。');
    stop();show();const token=sequence;base=getRoute();controller=new AbortController();const currentController=controller;
    detail.querySelector('[data-cancel-recheck]').hidden=false;
    msg('正在重新查询全部地点（最多约2分钟），原收藏与当前行程保持不变…');
    const r=v.packet.route, body=copyIntent(r);
    body.context=r.context;body.days.forEach((d,i)=>d.lodging=r.days[i].lodging?.text||'');
    body.stops.forEach((s,i)=>{s.visit=r.stops[i].visit;s.progress=r.stops[i].progress;});body.bookings=r.legs.map(l=>l.booking||null);
    const timer=setTimeout(()=>currentController.abort(),125000);
    try {
      const response=await fetch('/api/library/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:currentController.signal});
      const data=await response.json();if(!response.ok)throw Error(data.error||'重核失败，请重试。');if(token!==sequence)return;
      candidate=data.route;frame.srcdoc=renderRoadbook(createPortable(candidate),{interactive:false});
      showCandidate(token);msg('重核候选已就绪：新服务身份与新地点依据；个人条件和已游览记录保留，原自由描述未当事实沿用。交通待重算、用户预订未认证。明确采用后才改变地图，可撤销；收藏不会自动覆盖。');
    } catch(e) {if(token===sequence)msg(e.name==='AbortError'?'重核已取消或超时，可重试；旧行程未变。':'重核失败：'+e.message);}
    finally {clearTimeout(timer);if(token===sequence){controller=null;const b=detail.querySelector('[data-cancel-recheck]');if(b)b.hidden=true;}}
  }
  function showCandidate(token) {
    const b=button('接受未知并采用重核候选',async()=>{
      if(token!==sequence||!candidate)throw Error('候选已失效，请重新核对。');
      if(blocked()||getRoute()!==base)throw Error('当前行程已改变或有草稿，请重新重核。');
      b.disabled=true;try {await adopt(candidate,true);stop();show();msg('已采用重核候选，交通正在重算；如需持久保存，请另存或保存到收藏。');}finally{b.disabled=false;}
    });detail.append(b);
  }
  async function select(id, vid) {
    stop();selected=await (await ready()).get(id);if(!selected)throw Error('收藏不存在或已删除。');
    versionId=vid||selected.versions.at(-1).id;if(!selectedVersion())throw Error('历史版本不存在或已删除。');name.value=selected.name;show();
  }
  async function refresh() {
    const records=await (await ready()).list(), query=search.value.trim().toLowerCase(), restoreFocus=preserveFocus(list);list.replaceChildren();
    for(const r of records.filter(r=>[r.name,...r.versions.at(-1).packet.route.stops.map(s=>s.name+' '+s.city)].join(' ').toLowerCase().includes(query)))list.append(button(`${r.name} · ${r.versions.length}次保存`,()=>select(r.id)));
    if(!list.children.length)list.append(el('p',records.length?'没有匹配的收藏。':'暂无收藏。可保存当前行程或导入 JSON / 行程库备份。'));
    restoreFocus();
  }
  controls.append(name);
  if(adopt) controls.append(button('另存当前行程为新收藏',async()=>{
    const route=getRoute();if(!route)throw Error('请先生成或重开行程。');const r=appendVersion(null,name.value||route.title,route,cachedPhotos(route));await (await ready()).add([r]);await select(r.id);await refresh();msg('已保存当前已提交版本及可读取照片；草稿和未采用候选不保存。');
  }),button('将当前版本保存到所选收藏',async()=>{
    if(!selected)throw Error('请先选择收藏，或另存新收藏。');const route=getRoute();if(!route)throw Error('没有可保存的行程。');
    if(!confirm('将当前已提交行程追加到所选收藏？超过20次将移除最旧版本。'))return;
    selected=await (await ready()).mutate(selected.id,r=>appendVersion(r,name.value,route,cachedPhotos(route)));versionId=selected.versions.at(-1).id;show();await refresh();msg('已追加保存，旧版本保留在历史中。');
  }));
  controls.append(button('重命名所选收藏',async()=>{if(!selected)throw Error('请先选择收藏。');const n=name.value.trim();if(!n||n.length>100)throw Error('名称需为1–100字符');selected=await(await ready()).mutate(selected.id,r=>({...r,name:appendVersion(null,n,selectedVersion().packet.route).name}));show();await refresh();msg('名称已更新。');}));
  manageControls.append(button('删除整个收藏',async()=>{if(!selected)throw Error('请先选择收藏。');if(!confirm('删除整个收藏及全部历史？此操作无法撤销，请先按需导出。'))return;await(await ready()).mutate(selected.id,()=>null);stop();selected=null;detail.replaceChildren();frame.srcdoc='';frame.hidden=true;await refresh();msg('整个收藏已删除。');}));
  const refreshButton=button('刷新列表 / 重试存储',async()=>{db?.close();db=null;await refresh();msg('列表已刷新。');});
  backupControls.append(button('导出全部收藏备份',async()=>{const rows=await(await ready()).list();if(!rows.length)throw Error('当前没有收藏。');downloadFile(backupText(rows),'application/json','citywalk-library.json');}));
  const file=el('input','');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','导入行程或备份 JSON');
  file.addEventListener('change',()=>run(async()=>{const f=file.files[0];if(!f)return;try{if(f.size>MAX_BACKUP_BYTES)throw Error('文件超过64 MB');const records=parseBackup(await f.text());await(await ready()).add(records);await refresh();await select(records[0].id);msg(`已导入 ${records.length} 个新收藏，已有收藏不覆盖。内容未核实，不自动替换地图。`);}finally{file.value='';}}));
  const fileLabel=el('label','导入行程或备份 JSON（最多64 MB）');fileLabel.append(file);backupControls.append(fileLabel);search.addEventListener('input',()=>run(refresh));
  saveGroup.append(controls);backupGroup.append(backupControls);manageGroup.append(manageControls);
  frame.hidden=true;
  const searchLabel=el('label','查找收藏');searchLabel.className='library-search';searchLabel.append(search);
  root.append(status,warning,saveGroup,backupGroup,searchLabel,refreshButton,list,detail,manageGroup,frame);
  window.addEventListener('offline',()=>{stop();msg('当前离线：可读本机路书及导出备份。生成、地图瓦片、地点查询和在线导航不可用。');});
  window.addEventListener('online',()=>{if(active)msg('网络连接已恢复；地点与交通不会自动重新核实。');});
  return { async open(id, vid) {active=true;msg('正在打开本机行程库…');await run(async()=>{await refresh();if(id)await select(id,vid);saveGroup.open=!list.querySelector('button');msg(navigator.onLine?'本机收藏已加载。保存时间不代表地点核实时间。':'当前离线，仅可读本机路书及导出备份。');});}, close(){active=false;stop();}, async route(id,vid){await select(id,vid);return localRoute(selectedVersion().packet);} };
}
