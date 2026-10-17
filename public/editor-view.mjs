import { modeLabels } from './transport.mjs';
import { renderDayEditor, bookingEditor } from './day-editor-view.mjs';
import { preserveFocus } from './ui-interactions.mjs';
const el = (tag, text, cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
export function createEditorView({ getSession, publish, selectStop, invalidate, resetForms }) {
  const panel = document.getElementById('itineraryEditor');
  let searchToken = 0, searchController, targetId = null, error = '', failed = false;
  let editDayId = null;
  const button = (text, fn, disabled = false) => { const b = el('button', text); b.type = 'button'; b.disabled = disabled; b.addEventListener('click', fn); return b; };
  function stage(action, refresh = true, reveal = true) {
    try {
      const wasBusy = getSession().busy;
      getSession().stage(action); invalidate(); failed = false; error = '';
      if (refresh || wasBusy) render();
      else {
        // A number-input blur must not remove the commit button before its click.
        panel.querySelector('summary').textContent = '编辑行程 · 有未提交草稿';
        panel.querySelector('summary + p').textContent = '草稿尚未提交；地图、卡片、时间轴和导出仍显示已提交版本。';
        panel.querySelector('.editor-status').textContent = '';
        const actions = panel.querySelector('.editor-actions');
        actions.children[0].disabled = false; actions.children[1].disabled = false;
      }
      if (reveal) panel.open = true; return true;
    }
    catch (e) { error = e.message; render(); return false; }
  }
  async function commit(allowIncomplete = false) {
    const invalid = [...panel.querySelectorAll('input[type="number"]')].find(input => !input.validity.valid);
    if (invalid) { invalid.reportValidity(); return; }
    const session = getSession();
    try {
      error = ''; failed = false;
      const work = session.commit(async (request, signal) => {
        const response = await fetch('/api/transport-route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
        if (!response.ok) throw new Error('交通服务暂不可用，当前版本未改变；可重试或保留未知提交。');
        return response.json();
      }, { allowIncomplete });
      render();
      const route = await work;
      if (getSession() !== session || !route) return;
      publish(route); error = '已提交，地图、卡片和时间轴已同步。';
    } catch (e) { if (getSession() === session) { error = e.name === 'AbortError' ? '已取消计算，草稿保留，可重试。' : e.message; failed = true; } }
    if (getSession() === session) render();
  }
  function openSearch(id = null) {
    if (id) editDayId = (getSession().draft || getSession().current).stops.find(s => s.id === id)?.dayId;
    targetId = id; render(); panel.open = true;
    panel.querySelector('[name="placeName"]').focus();
  }
  function render() {
    const restoreFocus = preserveFocus(panel);
    searchController?.abort(); searchToken++;
    const session = getSession(); if (!session) return;
    const route = session.draft || session.current;
    panel.replaceChildren(el('summary', `手动调整行程${session.draft ? ' · 有未提交草稿' : ''}`));
    panel.append(el('p', session.draft ? '以下为编辑草稿。地图、卡片、时间轴和导出仍显示已提交版本；计算并提交后统一更新。' : '可先调整多项，再计算并提交。必去锁定防止删除/换点，仍允许排序和修改停留。'));
    const message = el('p', error, 'editor-status'); message.setAttribute('role', 'status'); panel.append(message);
    const controls = el('div', '', 'editor-actions');
    controls.append(button(session.busy ? '正在重算…' : '计算并提交草稿', () => commit(), !session.draft || session.busy), button('放弃草稿', () => { session.discard(); resetForms?.(); error = ''; failed = false; render(); }, !session.draft), button('撤销上次提交', () => { invalidate(); publish(session.undo()); error = '已恢复上一版，版本号继续递增。'; render(); }, !session.history.length));
    if (session.busy) controls.append(button('取消计算', () => { session.cancel(); error = '计算已取消，草稿保留。'; render(); }));
    if (failed) controls.append(button('重试草稿交通', () => { session.retry(); commit(); }), button('保留粗估/未知并提交', () => commit(true)));
    panel.append(controls);
    if (!route.days.some(d => d.id === editDayId)) editDayId=route.days[0].id;
    const dayLabel=el('label','编辑哪一天'), daySelect=el('select',''); daySelect.setAttribute('aria-label','编辑哪一天');
    for(const day of route.days) {const o=el('option',`第 ${day.index} 天 · ${day.date || '日期未定'} · ${day.stopIds.length} 个地点`);o.value=day.id;daySelect.append(o);}daySelect.value=editDayId;
    daySelect.addEventListener('change',()=>{editDayId=daySelect.value;targetId=null;render();});dayLabel.append(daySelect);
    panel.append(dayLabel,button('增加一天',()=>stage({type:'add-day'}),route.days.length>=14),button('删除当前空白天',()=>stage({type:'remove-day',dayId:editDayId}),route.days.length<=1 || route.stops.some(s=>s.dayId===editDayId)),renderDayEditor(route,editDayId,stage));
    const list = el('ol', '', 'edit-stop-list');
    route.stops.forEach((stop, index) => {
      if(stop.dayId!==editDayId) return;
      const row = el('li', '', 'edit-stop'); row.dataset.stopId = stop.id;
      row.append(el('strong', `${index + 1}. ${stop.name}${stop.locked ? ' · 必去已锁定' : ''}`));
      row.append(el('small', `${stop.city || route.city} · ${stop.address || '地址未提供'}`));
      const actions = el('div', '', 'editor-actions');
      actions.append(button(stop.locked ? '解锁必去' : '锁定必去', () => stage({type:'lock', stopId:stop.id})), button('上移', () => stage({type:'move', stopId:stop.id, offset:-1}), !index || route.stops[index-1].dayId !== stop.dayId), button('下移', () => stage({type:'move', stopId:stop.id, offset:1}), index === route.stops.length-1 || route.stops[index+1].dayId !== stop.dayId), button('换一个', () => openSearch(stop.id), stop.locked), button('删除', () => stage({type:'remove', stopId:stop.id}), stop.locked || route.stops.length <= 2));
      const currentIndex = session.current.stops.findIndex(s => s.id === stop.id);
      if (currentIndex >= 0) actions.append(button('在地图查看', () => selectStop(currentIndex)));
      row.append(actions);
      row.append(button('复制到当天末尾（返程/重复到访）',()=>stage({type:'repeat-stop',stopId:stop.id,dayId:stop.dayId}),route.stops.length>=50));
      const moveLabel=el('label','移到其他天'), moveDay=el('select','');moveDay.setAttribute('aria-label',`${stop.name} 所属日`);
      for(const day of route.days){const o=el('option',`第 ${day.index} 天`);o.value=day.id;moveDay.append(o);}moveDay.value=stop.dayId;
      moveDay.addEventListener('change',()=>stage({type:'assign-day',stopId:stop.id,dayId:moveDay.value}));moveLabel.append(moveDay);row.append(moveLabel);
      const label = el('label', '停留（分钟，留空暂按30）'), stay = el('input', ''); stay.type='number'; stay.min=0; stay.max=720; stay.step=1; stay.value=stop.visit?.stayMinutes ?? ''; stay.setAttribute('aria-label', `${stop.name} 草稿停留`);
      stay.addEventListener('input', () => {
        if (!stay.validity.valid) {
          panel.querySelector('.editor-status').textContent = '停留需为 0–720 分钟的整数';
          panel.querySelector('.editor-actions').children[0].disabled = true;
          return;
        }
        stage({type:'visit',stopId:stop.id,visit:{...stop.visit,stayMinutes: stay.value === '' ? undefined : Number(stay.value)}}, false);
      }); label.append(stay); row.append(label);
      const slot = route.proposal?.stops.find(s => s.id === stop.proposalCandidateId);
      for (const attempt of slot?.attempts || []) row.append(button(`${attempt.role === 'primary' ? '主选' : '备选'}：${attempt.name}（重新核对）`, () => { targetId = stop.id; render(); search(attempt.name, attempt.city); }, stop.locked));
      const leg = route.legs.find(l => l.fromStopId === stop.id);
      if (leg) {
        const label = el('label', `前往 ${route.stops.find(s => s.id === leg.toStopId)?.name}：`), select = el('select', ''); select.setAttribute('aria-label', `${stop.name} 出发路段方式`);
        for (const [mode, name] of Object.entries(modeLabels)) { const opt=el('option', name); opt.value=mode; select.append(opt); } select.value=leg.preferredMode;
        select.addEventListener('change', () => stage({type:'mode',legId:leg.id,mode:select.value})); label.append(select); row.append(label);
        row.append(bookingEditor(leg,stage));
      }
      list.append(row);
    });
    panel.append(list, button('检索加入地点', () => openSearch()));
    const target = route.stops.find(s => s.id === targetId);
    if (!target) targetId = null;
    const form = el('form', '', 'place-search');
    form.append(el('h4', target ? `替换：${target.name}` : `检索加入（追加到第 ${route.days.find(d=>d.id===editDayId).index} 天）`));
    for (const [name, label, value] of [['placeName','地点全名',''],['placeCity','所属城市',target?.city || route.stops[0].city || route.city],['addressHint','地址线索（选填）','']]) {
      const wrap=el('label',label), input=el('input',''); input.name=name; input.value=value; input.required=name!=='addressHint'; input.maxLength=200; wrap.append(input); form.append(wrap);
    }
    const submit=el('button','查询地点'); submit.type='submit'; form.append(submit);
    form.addEventListener('submit', event => { event.preventDefault(); search(form.elements.placeName.value, form.elements.placeCity.value, form.elements.addressHint.value); });
    const results=el('div', '', 'place-search-results');results.setAttribute('role','status');
    panel.append(form, results);
    restoreFocus();
  }
  async function search(name, city, addressHint = '') {
    const session = getSession(), target = targetId, token = ++searchToken;
    searchController?.abort(); const controller = searchController = new AbortController();
    const results = panel.querySelector('.place-search-results'); results.textContent = '正在核对地点…';
    const cancel=button('取消地点检索',()=>{searchToken++;controller.abort();results.textContent='地点检索已取消，当前行程和草稿未改变，可重新查询。';cancel.remove();panel.querySelector('.place-search button').focus();});
    results.before(cancel);
    const timer=setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch('/api/places/search', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,city,addressHint}),signal:controller.signal});
      const result = await response.json();
      if (token !== searchToken || getSession() !== session) return;
      if (!response.ok) throw new Error(result.error || '查询失败');
      results.replaceChildren(el('p', result.message));
      if (!result.candidates.length) results.append(el('p', `未能匹配（${result.status}）。请使用完整名称、城市或补充地址。`));
      if (result.status === 'ambiguous') results.append(el('p', '存在同名地点，请按地址核对后明确选择；无法分辨时请补充地址重新查询。'));
      for (const poi of result.candidates) {
        const item=el('div','', 'search-candidate');
        item.append(el('strong', poi.name), el('p', `${poi.city} · ${poi.address || '地址未提供'} · ${poi.location.lat}, ${poi.location.lng}`), el('small', `来源：${poi.provider} · 获取：${poi.retrievedAt || '演示/未知'} · 开放：${poi.openingHours?.text || '未知'}`));
        if (poi.detailUrl) { const a=el('a','查看来源'); a.href=poi.detailUrl; a.target='_blank'; a.rel='noopener noreferrer'; item.append(a); }
        item.append(button(target ? '选此地点替换' : '加入草稿', () => { if (token === searchToken && getSession() === session) stage({type:target?'replace':'add',stopId:target,dayId:editDayId,poi}); })); results.append(item);
      }
    } catch(e) { if (token === searchToken) results.textContent = e.name === 'AbortError' ? '查询超时，请重试；当前行程未改变。' : e.message; }
    finally {clearTimeout(timer);const focused=document.activeElement===cancel;cancel.remove();if(focused)panel.querySelector('.place-search button')?.focus();}
  }
  return { render, stage, commit, open: openSearch, reset: () => {searchController?.abort();searchToken++;targetId=null;error='';failed=false;} };
}
