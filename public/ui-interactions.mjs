// Presentation helpers only: never mutate itinerary data or bypass transaction guards.
export function preserveFocus(root) {
  const active = document.activeElement;
  if (!root.contains(active)) return () => {};
  const scopeId = active.closest('[data-stop-id]')?.dataset.stopId;
  const key = node => [node.tagName, node.id, node.getAttribute('aria-label'), node.getAttribute('name'), node.tagName === 'BUTTON' ? node.textContent : ''].join('|');
  const identity = key(active);
  return () => {
    if (active.isConnected || (document.activeElement !== document.body && document.activeElement !== active)) return;
    const scope = scopeId ? [...root.querySelectorAll('[data-stop-id]')].find(n => n.dataset.stopId === scopeId) : root;
    const target = [...(scope?.querySelectorAll('button,input,select,summary,a[href]') || [])].find(n => key(n) === identity && !n.disabled)
      || root.querySelector('summary') || root.querySelector('[role=status]');
    if (target) { if (target.matches('[role=status]')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
  };
}

export function initWorkspaceUI(getState, { reveal } = {}) {
  const status = document.getElementById('workspaceStatus');
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[data-panel]');
    if (!link) return;
    const panel = document.getElementById(link.dataset.panel);
    if (!panel || panel.hidden) return;
    event.preventDefault();
    if (reveal) { reveal(panel); return; }
    if (panel.tagName === 'DETAILS') {
      for (const sibling of document.querySelectorAll('.route-tools > details')) sibling.open = sibling === panel;
      panel.open = true;
    }
    const target = panel.id === 'routeForm' ? document.getElementById('promptInput') : panel.querySelector('summary') || panel;
    if (!target.matches('input,textarea,button,a[href],select,summary')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
  const update = () => {
    const { route, busy, draft, editing } = getState();
    const agent = document.getElementById('agentReview');
    const pending = !agent.hidden && agent.querySelector('.agent-version');
    const parts = navigator.onLine ? [] : ['当前离线，可以阅读本机收藏'];
    if (busy) parts.push('DS 正在规划，可以返回探索页查看进度或取消');
    else if (editing) parts.push('正在更新行程安排…');
    else if (draft) parts.push('编辑还未保存，地图暂时保留原行程');
    else if (pending && !busy) parts.push('新行程已准备好，请先确认采用');
    if (route?.restoration?.status === 'unverified-local') parts.push('这是本机保存的行程，继续 AI 规划前请在收藏中重新核对地点');
    const message = parts.join(' · ');
    if (status.textContent !== message) status.textContent = message;
    status.hidden = !message;
    document.getElementById('reviewShortcut').hidden = !pending;
    document.getElementById('routeForm').setAttribute('aria-busy', String(busy));
    document.getElementById('itineraryEditor').setAttribute('aria-busy', String(!!editing));
    for(const control of document.querySelectorAll('.view-toggle button,#resetView,#quickPoi')) control.disabled=!route;
  };
  const observer = new MutationObserver(update);
  for (const id of ['itineraryEditor', 'agentReview', 'generationStatus', 'routeSource']) {
    observer.observe(document.getElementById(id), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
  return update;
}
