// View changes only affect presentation. Controllers and itinerary drafts stay mounted.
export function createWorkspaceRouter({ document = globalThis.document, window = globalThis.window, onChange = () => {} } = {}) {
  const views = [...document.querySelectorAll('[data-workspace-view]')];
  const names = new Set(views.map(view => view.dataset.workspaceView));
  const links = [...document.querySelectorAll('[data-workspace-link]')];
  const scrollPositions = new Map();
  let currentView = null;
  const fromHash = () => window.location.hash.slice(1);
  const show = (name, { focus = true, initial = false } = {}) => {
    if (!names.has(name)) return false;
    const previous = currentView;
    if (previous && previous !== name) scrollPositions.set(previous, { top: window.scrollY || 0, left: window.scrollX || 0 });
    currentView = name;
    for (const view of views) view.hidden = view.dataset.workspaceView !== name;
    for (const link of links) {
      const active = link.dataset.workspaceLink === name;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const activeView = views.find(view => view.dataset.workspaceView === name);
    if (previous && previous !== name) window.scrollTo?.({ ...(scrollPositions.get(name) || { top: 0, left: 0 }), behavior: 'instant' });
    const title = activeView.querySelector('[data-view-title]');
    if (title) {
      document.title = `${title.textContent.trim()} · 先行 Citywalk Scope`;
      if (focus) title.focus({ preventScroll: true });
    }
    if (previous !== name || initial) onChange({ view: name, previous, initial });
    return true;
  };
  const navigate = (name, { focus = true, history = 'push' } = {}) => {
    if (!names.has(name)) return false;
    if (fromHash() !== name && history !== 'none') {
      const url = new URL(window.location.href);
      url.hash = name;
      window.history[history === 'replace' ? 'replaceState' : 'pushState'](null, '', url.href);
    }
    return show(name, { focus });
  };
  const reveal = (target, { focus = true } = {}) => {
    const panel = typeof target === 'string' ? document.getElementById(target) : target;
    if (!panel || panel.hidden) return false;
    const view = panel.closest('[data-workspace-view]');
    if (view) navigate(view.dataset.workspaceView, { focus: false });
    for (let node = panel; node && node !== view; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
    }
    if (focus) {
      const node = panel.id === 'routeForm' ? document.getElementById('promptInput') : panel.querySelector('summary') || panel;
      if (!node.matches('input,textarea,button,a[href],select,summary')) node.tabIndex = -1;
      node.focus({ preventScroll: true });
    }
    panel.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    return true;
  };
  const click = event => {
    if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('[data-workspace-link]');
    if (!link || !names.has(link.dataset.workspaceLink)) return;
    event.preventDefault();
    navigate(link.dataset.workspaceLink);
  };
  const historyChange = () => {
    const name = fromHash();
    // Sharing fragments (#cw...) belong to the share controller.
    if (names.has(name)) show(name);
    else if (!name) show('explore');
  };
  document.addEventListener('click', click);
  window.addEventListener('hashchange', historyChange);
  window.addEventListener('popstate', historyChange);
  show(names.has(fromHash()) ? fromHash() : 'explore', { focus: false, initial: true });
  return {
    current: () => currentView, navigate, reveal,
    destroy() {
      document.removeEventListener('click', click);
      window.removeEventListener('hashchange', historyChange);
      window.removeEventListener('popstate', historyChange);
    }
  };
}
