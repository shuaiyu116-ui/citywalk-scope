import { preserveFocus } from './ui-interactions.mjs';
const text = (tag, value, className = '') => {
  const node = document.createElement(tag); node.textContent = value ?? ''; node.className = className; return node;
};

const progressMessages = {
  intent: '正在理解你的出行想法…', propose: '正在挑选适合你的地点…', proposal: '正在挑选适合你的地点…', places: '正在核对地点和位置…', identity: '正在确认名称不同的地点是否为同一处…',
  place: '正在核对地点和位置…', transport: '正在安排各站之间的交通…', schedule: '正在安排每天的游玩时间…',
  decide: 'AI 正在根据查询结果安排下一步…', edit: '正在调整行程安排…'
};

export function createAgentView({ root, adopt, discard = () => {} }) {
  let result = null, busy = false, adopting = false;
  const heading = text('h3', '为你规划');
  const status = text('p', ''); status.setAttribute('role', 'status'); status.tabIndex = -1;
  const review = text('div', '', 'agent-versions');
  root.replaceChildren(heading, status, review);

  function renderVersion(version, recommended) {
    const card = text('section', '', 'agent-version');
    const route = version.route;
    card.append(text('h4', recommended ? '推荐行程' : '另一种安排'));
    card.append(text('p', `${route?.days?.length || 0} 天 · ${route?.stops?.length || 0} 个地点`, 'agent-trip-summary'));
    const stopsByDay = (route?.days || []).map(day => {
      const names = (route.stops || []).filter(stop => stop.dayId === day.id).map(stop => stop.name);
      return `第 ${day.index} 天：${names.length ? names.join(' → ') : '尚未安排地点'}`;
    });
    const plan = text('div', '', 'agent-day-preview');
    for (const line of stopsByDay) plan.append(text('p', line));
    if (!stopsByDay.length) plan.append(text('p', (route?.stops || []).map(stop => stop.name).join(' → ')));
    card.append(plan);
    const incomplete = !version.metrics || version.metrics.conflicts !== 0 || version.metrics.unknowns !== 0;
    const accept = document.createElement('input'); accept.type = 'checkbox';
    if (incomplete) {
      const conflicts = version.metrics?.conflicts;
      card.append(text('p', conflicts > 0 ? `有 ${conflicts} 项时间或出行安排冲突，采用后请在“时间安排”中调整。` : '部分交通或营业时间尚待确认，出发前请再次核对。', 'agent-caution'));
      const label = text('label', '', 'agent-accept');
      label.append(accept, document.createTextNode('我已了解这些待确认事项')); card.append(label);
    }
    const button = text('button', recommended ? '使用这条行程' : '使用这个方案'); button.type = 'button';
    button.disabled = busy || adopting || (incomplete && !accept.checked);
    accept.addEventListener('change', () => { button.disabled = busy || adopting || !accept.checked; });
    button.addEventListener('click', async () => {
      if (busy || adopting) return;
      adopting = true; root.querySelectorAll('.agent-version button').forEach(control => { control.disabled = true; });
      try {
        await adopt(version, result);
        result = null; review.replaceChildren(); root.hidden = true;
        const title = document.getElementById('routeTitle');
        if (title && !title.closest('[data-workspace-view][hidden]')) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
      } catch (error) { status.textContent = error.message; }
      finally { adopting = false; if (result) renderReview(); }
    });
    card.append(button); return card;
  }
  function renderReview() {
    const restoreFocus = preserveFocus(root); review.replaceChildren();
    if (!result) return;
    if (result.warning) review.append(text('p', result.warning, 'agent-caution'));
    if (result.conversation?.changes?.length) {
      const changes = document.createElement('ul'); changes.className = 'agent-changes';
      for (const change of result.conversation.changes) changes.append(text('li', change));
      review.append(changes);
    }
    const agent = result.agent || {};
    const versions = agent.versions?.length ? agent.versions : [{ id: 'result', route: result.route, metrics: { unknowns: 1 } }];
    const recommended = versions.find(version => version.id === agent.selectedVersionId) || versions[0];
    review.append(renderVersion(recommended, true));
    const others = versions.filter(version => version !== recommended);
    if (others.length) {
      const alternatives = document.createElement('details'); alternatives.className = 'agent-alternatives';
      alternatives.append(text('summary', '比较其他安排'));
      for (const version of others) alternatives.append(renderVersion(version, false));
      review.append(alternatives);
    }
    const dismiss = text('button', '放弃这条方案'); dismiss.type = 'button'; dismiss.className = 'secondary-btn';
    dismiss.addEventListener('click', () => { if (adopting) return; result = null; review.replaceChildren(); root.hidden = true; discard(); });
    review.append(dismiss);
    review.append(text('small', '采用后更新地图和路书；需要恢复时，可在“行程编辑”中撤销。'));
    restoreFocus();
  }
  return {
    clear() { result = null; busy = false; root.hidden = true; review.replaceChildren(); },
    start() { busy = true; result = null; root.hidden = false; heading.textContent = '为你规划'; status.textContent = '正在理解你的出行想法…'; review.replaceChildren(); },
    progress(event) { status.textContent = progressMessages[event.tool] || '正在准备你的行程…'; },
    message() { return status.textContent; },
    complete(value) { busy = false; result = value; root.hidden = false; heading.textContent = '行程已准备好'; status.textContent = '看看每天的安排，确认后就可以在地图上预览。'; renderReview(); },
    fail(message) { busy = false; root.hidden = false; heading.textContent = '这次规划尚未完成'; status.textContent = message; },
    hasPending() { return !!result; },
    isAdopting() { return adopting; }
  };
}
