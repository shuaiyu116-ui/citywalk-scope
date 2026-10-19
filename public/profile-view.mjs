const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
const button = text => { const node = el('button', text); node.type = 'button'; return node; };
const formatTime = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
};

export function createProfileView({ root, store }) {
  const details = el('details', '', 'device-profile'); details.id = 'userProfile';
  details.open = true;
  const summary = el('summary', '用户画像'), count = el('span', '', 'profile-count'); summary.append(count);
  details.append(summary, el('p', 'DS 会在每次规划或修改完成后整理你主动提供的信息，后续规划会参考长期偏好。你可以随时核对、修改或删除。', 'profile-intro'));
  const storageStatus = el('p', '', 'profile-storage'), status = el('p', '', 'profile-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const retry = button('重试更新'); retry.onclick = () => { void store.retry(); };
  const list = el('div', '', 'profile-list');
  const add = button('补充一条画像');
  const addRoot = el('div', '', 'profile-add'); addRoot.hidden = true;
  const clear = button('清空画像'), confirmation = el('div', '', 'profile-confirm'); confirmation.hidden = true;
  confirmation.append(el('p', '清空后将从新的对话重新积累。确定清空当前设备的画像吗？'));
  const yes = button('确定清空'), no = button('取消'); confirmation.append(yes, no);
  clear.onclick = () => { confirmation.hidden = false; yes.focus(); };
  no.onclick = () => { confirmation.hidden = true; clear.focus(); };
  yes.onclick = () => { editingId = null; confirmation.hidden = true; store.clear(); clear.focus(); };
  const actions = el('div', '', 'profile-actions'); actions.append(add, clear);
  details.append(storageStatus, status, retry, list, actions, addRoot, confirmation); root.append(details);
  let editingId = null, lastProfile = '';

  function editor(item = {}, onSave, onCancel) {
    const form = el('form', '', 'profile-edit');
    const field = (label, value, maxLength, multiline = false) => {
      const wrap = el('label', label), input = el(multiline ? 'textarea' : 'input');
      input.value = value || ''; input.maxLength = maxLength; input.required = true;
      if (multiline) input.rows = 3;
      wrap.append(input); form.append(wrap); return input;
    };
    const category = field('分类（可自行命名）', item.category || '其他', 40);
    const label = field('条目名称', item.label, 60), value = field('内容', item.value, 320, true);
    const scopeLabel = el('label', '适用范围'), scope = el('select');
    for (const [key, title] of [['long-term', '长期偏好'], ['trip', '本次旅行']]) {
      const option = el('option', title); option.value = key; scope.append(option);
    }
    scope.value = item.scope || 'long-term'; scopeLabel.append(scope); form.append(scopeLabel);
    const save = el('button', '保存'), cancel = button('取消'); save.type = 'submit';
    const message = el('p', '', 'profile-edit-status'); message.setAttribute('role', 'status');
    form.append(save, cancel, message);
    form.onsubmit = event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (![category.value, label.value, value.value].every(text => text.trim())) { message.textContent = '请填写分类、名称和内容。'; return; }
      if (onSave({ ...item, category: category.value.trim(), label: label.value.trim(), value: value.value.trim(), scope: scope.value, evidence: '用户在设置中填写或修正' }) === false) message.textContent = '画像最多保留 40 条，请先删除或合并已有条目。';
    };
    cancel.onclick = onCancel;
    return { form, focus: () => label.focus() };
  }
  function renderList(profile) {
    lastProfile = JSON.stringify(profile); list.replaceChildren();
    if (!profile.items.length) { list.append(el('p', '画像还是空的。完成一次规划后，DS 会在后台整理；也可以先补充自己的习惯。', 'profile-empty')); return; }
    const groups = new Map();
    for (const item of profile.items) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(item);
    }
    for (const [category, items] of groups) {
      const section = el('section', '', 'profile-category'); section.append(el('h3', category));
      for (const item of items) {
        const card = el('article', '', 'profile-item'); card.dataset.profileId = item.id;
        card.append(el('h4', item.label), el('p', item.value, 'profile-value'));
        card.append(el('p', `${item.scope === 'trip' ? '本次旅行 · 新行程不沿用' : '长期偏好'} · ${item.source === 'user' ? '你填写或修正' : 'DS 整理'}${formatTime(item.updatedAt) ? ` · ${formatTime(item.updatedAt)}` : ''}`, 'profile-meta'));
        if (item.evidence) {
          const evidence = el('details', '', 'profile-evidence');
          evidence.append(el('summary', '记录依据'), el('p', item.evidence)); card.append(evidence);
        }
        const edit = button('修改'), remove = button('删除');
        edit.setAttribute('aria-label', `修改${item.label}`); remove.setAttribute('aria-label', `删除${item.label}`);
        const itemActions = el('div', '', 'profile-item-actions'); itemActions.append(edit, remove); card.append(itemActions);
        remove.onclick = () => { editingId = null; store.deleteItem(item.id); };
        edit.onclick = () => {
          editingId = item.id;
          const editing = editor(item, updated => {
            editingId = null;
            if (!store.saveItem(updated)) { editingId = item.id; return false; }
            render(store.getSnapshot());
            return true;
          }, () => { editingId = null; renderList(store.getSnapshot().profile); });
          card.replaceChildren(editing.form); editing.focus();
        };
        section.append(card);
      }
      list.append(section);
    }
  }
  const adding = editor({}, item => {
    if (!store.saveItem(item)) return false;
    addRoot.hidden = true; adding.form.reset(); add.focus();
    return true;
  }, () => { addRoot.hidden = true; add.focus(); });
  addRoot.append(adding.form);
  add.onclick = () => { addRoot.hidden = !addRoot.hidden; if (!addRoot.hidden) adding.focus(); };

  function render(snapshot) {
    count.textContent = ` · ${snapshot.profile.items.length} 条`;
    storageStatus.textContent = snapshot.persistent ? '保存在此设备的此浏览器中；同一浏览器的多个标签页共用。更换浏览器或清除网站数据后会重新开始。' : '此浏览器暂时无法保存数据，画像仅在当前页面保留。';
    storageStatus.classList.toggle('profile-storage-unavailable', !snapshot.persistent);
    const messages = { idle: '完成规划后会自动更新画像。', updating: 'DS 正在后台整理画像，行程可以继续使用。', saved: snapshot.persistent ? '画像已保存到当前设备。' : '画像已更新，当前仅在本页保留。', error: snapshot.error };
    status.textContent = messages[snapshot.status] || messages.idle;
    retry.hidden = snapshot.status !== 'error';
    clear.disabled = snapshot.profile.items.length === 0;
    if (!editingId && lastProfile !== JSON.stringify(snapshot.profile)) renderList(snapshot.profile);
  }
  const unsubscribe = store.subscribe(render); render(store.getSnapshot());
  return {
    open() { details.open = true; summary.focus(); },
    render() { render(store.getSnapshot()); },
    destroy() { unsubscribe(); details.remove(); }
  };
}
