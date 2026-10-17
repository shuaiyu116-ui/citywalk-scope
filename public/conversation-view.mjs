import { interestOptions, paceOptions, normalizePreferences, cleanText } from './conversation-state.mjs';

// The transcript is presentation state; only explicit planning state is sent to the server.
export function createConversationView({ root, preferencesRoot, memory, getRoute, onMode }) {
  const el = (tag, value = '', className = '') => {
    const node = document.createElement(tag); node.textContent = value; node.className = className; return node;
  };
  const controls = el('div', '', 'conversation-controls');
  const next = el('button', '修改当前行程'), fresh = el('button', '新行程');
  next.type = fresh.type = 'button'; controls.append(next, fresh);
  const status = el('p', '', 'conversation-mode');
  const prefs = el('details', '', 'conversation-preferences');
  prefs.append(el('summary', '我的游玩偏好'), el('p', '偏好仅在本页保留。你在对话中提出的新要求优先。'));
  const interests = el('fieldset'); interests.append(el('legend', '兴趣'));
  const inputs = interestOptions.map(value => {
    const label = el('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.value = value;
    label.append(input, document.createTextNode(value)); interests.append(label); return input;
  });
  const select = (label, options) => {
    const wrap = el('label', label), node = document.createElement('select');
    for (const [value, title] of options) { const option = el('option', title); option.value = value; node.append(option); }
    wrap.append(node); prefs.append(wrap); return node;
  };
  prefs.append(interests);
  const pace = select('游玩节奏', [['', '未指定'], ...paceOptions.map(value => [value, value])]); pace.id = 'preferencePace';
  const mode = select('默认交通', [['', '未指定'], ['walking', '步行'], ['cycling', '骑行'], ['driving', '自驾'], ['taxi', '打车'], ['transit', '公共交通'], ['mixed', '混合']]); mode.id = 'preferenceMode';
  const budgetLabel = el('label', '每天最多步行（km）'), budget = document.createElement('input');
  budget.type = 'number'; budget.min = 0; budget.max = 50; budget.step = 0.1; budget.id = 'preferenceWalk'; budgetLabel.append(budget); prefs.append(budgetLabel);
  const save = el('button', '保存偏好'), forget = el('button', '清除偏好'), saved = el('p', '', 'preference-status');
  save.type = forget.type = 'button'; saved.setAttribute('role', 'status'); prefs.append(save, forget, saved);
  save.onclick = () => {
    if (!budget.reportValidity()) return;
    memory.preferences = normalizePreferences({ interests: inputs.filter(input => input.checked).map(input => input.value), pace: pace.value, transportMode: mode.value, maxWalkKm: budget.value });
    saved.textContent = '已保存，接下来的规划会参考这些偏好。'; render();
  };
  forget.onclick = () => {
    memory.preferences = normalizePreferences(); inputs.forEach(input => { input.checked = false; }); pace.value = mode.value = budget.value = '';
    saved.textContent = '偏好已清除。'; render();
  };
  next.onclick = () => { if (getRoute()) onMode('edit'); };
  fresh.onclick = () => onMode('new');
  const messages = el('div', '', 'conversation-messages');
  messages.setAttribute('role', 'log'); messages.setAttribute('aria-label', '行程规划对话'); messages.setAttribute('aria-live', 'polite');
  let lastQuestion = '';
  const addMessage = (role, value) => {
    const message = cleanText(value, 600); if (!message) return;
    memory.messages=[...(memory.messages||[]),{role:role==='user'?'user':'assistant',content:message}].slice(-10);
    const bubble = el('div', '', `conversation-message conversation-message-${role}`);
    bubble.append(el('span', role === 'user' ? '你' : 'DS · 先行', 'conversation-speaker'), el('p', message));
    messages.append(bubble);
    while (messages.children.length > 10) messages.firstElementChild.remove();
    messages.scrollTop = messages.scrollHeight;
  };
  function resetMessages() {
    messages.replaceChildren(); memory.messages=[]; lastQuestion = ''; root.classList.remove('awaiting-answer');
    addMessage('assistant', '想去哪里，玩多久？告诉我你的想法，我们一起安排。');
  }
  root.append(controls, status, messages);
  (preferencesRoot || root).append(prefs);
  if (preferencesRoot) prefs.open = true;
  function render() {
    status.textContent = memory.mode === 'edit' ? '正在聊当前行程，可以直接说想改哪里。' : '规划新行程';
    next.setAttribute('aria-pressed', String(memory.mode === 'edit'));
    fresh.setAttribute('aria-pressed', String(memory.mode === 'new'));
    next.hidden = !getRoute();
  }
  resetMessages(); render();
  return {
    render,
    submitted(prompt) { addMessage('user', prompt); root.classList.remove('awaiting-answer'); lastQuestion = ''; },
    reply(message) { addMessage('assistant', message); },
    resetMessages,
    clarify(value) {
      memory.pending = { ...value.pending, request: cleanText(value.pending?.request, 500), question: cleanText(value.question, 240) };
      if (value.question !== lastQuestion) addMessage('assistant', value.question);
      lastQuestion = value.question; root.classList.add('awaiting-answer'); render();
    },
    clearQuestion() { lastQuestion = ''; root.classList.remove('awaiting-answer'); },
    busy(value) { [next, fresh, save, forget].forEach(button => { button.disabled = value; }); messages.setAttribute('aria-busy', String(value)); }
  };
}
