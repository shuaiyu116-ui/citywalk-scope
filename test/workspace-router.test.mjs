import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceRouter } from '../public/workspace-router.mjs';

const views = ['explore', 'itinerary', 'roadbook', 'discover', 'library', 'settings'];
const attributeKey = name => name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

class Events {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, properties = {}) {
    const event = { type, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...properties };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

class Element extends Events {
  constructor(tag, attrs = {}) {
    super(); this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attributes = new Map();
    this.dataset = {}; this.children = []; this.parentElement = null; this.hidden = false; this.open = false; this.textContent = '';
    this.focusCalls = []; this.scrollCalls = []; this.classes = new Set(); this.tabIndex = -1;
    this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value), contains: value => this.classes.has(value), toggle: (value, force) => { const active = force ?? !this.classes.has(value); active ? this.classes.add(value) : this.classes.delete(value); return active; } };
    for (const [name, value] of Object.entries(attrs)) this.setAttribute(name, value);
  }
  get id() { return this.getAttribute('id') || ''; }
  get href() { const value = this.getAttribute('href'); return value == null ? '' : new URL(value, this.ownerDocument?.defaultView?.location.href || 'http://localhost/').href; }
  get parentNode() { return this.parentElement; }
  get isConnected() { return !!this.ownerDocument && this.ownerDocument.body.contains(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name.startsWith('data-')) this.dataset[attributeKey(name)] = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); if (name.startsWith('data-')) delete this.dataset[attributeKey(name)]; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; node.ownerDocument = this.ownerDocument; this.children.push(node); } }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const not = selector.match(/:not\(([^)]+)\)$/);
    if (not) return this.matches(selector.slice(0, not.index)) && !this.matches(not[1]);
    const parsed = selector.match(/^([\w-]+)?(?:\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\])?$/);
    if (!parsed) throw Error('Unsupported test selector: ' + selector);
    return (!parsed[1] || this.tagName.toLowerCase() === parsed[1]) && (!parsed[2] || (parsed[2] === 'open' ? this.open : this.hasAttribute(parsed[2])) && (parsed[3] == null || this.getAttribute(parsed[2]) === parsed[3]));
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus(options) { this.focusCalls.push(options); this.ownerDocument.activeElement = this; }
  scrollIntoView(options) { this.scrollCalls.push(options); }
}

function fixture(hash = '') {
  const document = new Events();
  document.body = new Element('body'); document.body.ownerDocument = document; document.activeElement = document.body;
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.querySelector = selector => document.body.querySelector(selector);
  document.getElementById = id => document.querySelector('#' + id);
  const window = new Events(), location = new URL('http://localhost/?keep=yes' + hash), historyCalls = [];
  window.location = location; window.requestAnimationFrame = callback => { callback(); return 1; }; window.scrollTo = () => {};
  const change = (method, state, _, url) => { historyCalls.push({ method, state, url }); location.href = new URL(url, location.href).href; };
  window.history = { pushState: (...args) => change('push', ...args), replaceState: (...args) => change('replace', ...args) };
  document.defaultView = window;
  const sections = {}, links = {}, titles = {};
  for (const name of views) {
    const section = new Element('section', { 'data-workspace-view': name, id: 'view-' + name });
    section.hidden = name !== 'explore';
    const title = new Element('h2', { 'data-view-title': '', id: 'title-' + name });
    title.textContent = name;
    const link = new Element('a', { 'data-workspace-link': name, href: '#' + name });
    document.body.append(section, link); section.append(title);
    sections[name] = section; links[name] = link; titles[name] = title;
  }
  return { document, window, sections, links, titles, historyCalls, create: options => createWorkspaceRouter({ document, window, ...options }) };
}

function assertVisible(f, expected) {
  for (const name of views) {
    assert.equal(f.sections[name].hidden, name !== expected, name + ' visibility');
    assert.equal(f.links[name].getAttribute('aria-current') === 'page', name === expected, name + ' navigation state');
  }
}

test('initial known view is selected while unknown and shared fragments remain intact', () => {
  for (const hash of ['#roadbook', '#unknown', '#cw', '#cw=compressed-share-packet', '']) {
    const f = fixture(hash), router = f.create();
    const expected = hash === '#roadbook' ? 'roadbook' : 'explore';
    assert.equal(router.current(), expected); assertVisible(f, expected);
    assert.equal(f.window.location.hash, hash);
    assert.equal(f.historyCalls.length, 0, 'initialization must not rewrite a share fragment');
    router.destroy();
  }
});

test('navigation preserves the document, draft controls and history query parameters', () => {
  const f = fixture(), draft = new Element('input', { id: 'draft-control' });
  draft.value = 'unsaved itinerary'; f.sections.itinerary.append(draft);
  const router = f.create(), originalSection = f.sections.itinerary;
  assert.notEqual(router.navigate('itinerary'), false); assertVisible(f, 'itinerary');
  assert.equal(router.current(), 'itinerary');
  assert.equal(f.document.activeElement, f.titles.itinerary);
  assert.equal(f.historyCalls.at(-1).method, 'push');
  assert.equal(f.window.location.search, '?keep=yes'); assert.equal(f.window.location.hash, '#itinerary');
  router.navigate('roadbook', { focus: false, history: 'replace' }); assertVisible(f, 'roadbook');
  assert.equal(f.historyCalls.at(-1).method, 'replace');
  assert.equal(f.document.activeElement, f.titles.itinerary, 'focus:false does not redirect focus');
  router.navigate('itinerary', { focus: false });
  assert.equal(f.document.querySelector('#view-itinerary'), originalSection);
  assert.equal(f.document.querySelector('#draft-control'), draft); assert.equal(draft.value, 'unsaved itinerary');
  router.destroy();
});

test('invalid navigation has no effect on view or browser history', () => {
  const f = fixture('#library'), router = f.create();
  for (const name of ['unknown', '', 'cw', 'toString', null]) assert.equal(router.navigate(name), false);
  assert.equal(router.current(), 'library'); assertVisible(f, 'library');
  assert.equal(f.historyCalls.length, 0); assert.equal(f.window.location.hash, '#library');
  router.destroy();
});

test('browser hash and history changes restore known views without writing new entries', () => {
  const f = fixture(), router = f.create();
  f.window.location.hash = '#discover'; f.window.emit('hashchange');
  assert.equal(router.current(), 'discover'); assertVisible(f, 'discover');
  f.window.location.hash = '#settings'; f.window.emit('popstate');
  assert.equal(router.current(), 'settings'); assertVisible(f, 'settings');
  f.window.location.hash = '#cw=shared-data'; f.window.emit('hashchange');
  assert.equal(router.current(), 'settings'); assert.equal(f.window.location.hash, '#cw=shared-data');
  assert.equal(f.historyCalls.length, 0); router.destroy();
});

test('revealing a nested target opens its details ancestors and activates its view', () => {
  const f = fixture(), outer = new Element('details', { id: 'outer' }), inner = new Element('details', { id: 'inner' }), control = new Element('button', { id: 'editPlace' });
  f.sections.itinerary.append(outer); outer.append(inner); inner.append(control);
  const router = f.create(); router.reveal(control);
  assert.equal(router.current(), 'itinerary'); assertVisible(f, 'itinerary');
  assert.equal(outer.open, true); assert.equal(inner.open, true);
  assert.equal(f.document.activeElement, control); assert.ok(control.scrollCalls.length, 'target should be brought into view');
  inner.open = false; router.navigate('explore', { focus: false });
  router.reveal(inner, { focus: false });
  assert.equal(inner.open, true, 'a details target itself also opens'); assert.equal(router.current(), 'itinerary');
  assert.equal(f.document.activeElement, control, 'focus:false does not change focus'); router.destroy();
});

test('plain navigation link clicks route internally; modified clicks remain browser actions', () => {
  const f = fixture(), router = f.create(), child = new Element('span'); f.links.roadbook.append(child);
  const event = f.document.emit('click', { target: child });
  assert.equal(event.defaultPrevented, true); assert.equal(router.current(), 'roadbook'); assertVisible(f, 'roadbook');
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const modified = f.document.emit('click', { target: f.links.settings, ...modifier });
    assert.equal(modified.defaultPrevented, false); assert.equal(router.current(), 'roadbook');
  }
  router.destroy();
});

test('leaving and returning restores each view scroll without jumping on repeated selection', () => {
  const f = fixture('#explore'), scrollCalls = [];
  f.window.scrollX = 12; f.window.scrollY = 240;
  f.window.scrollTo = options => {
    scrollCalls.push(options);
    f.window.scrollX = options.left; f.window.scrollY = options.top;
  };
  const router = f.create();
  assert.deepEqual(scrollCalls, [], 'initialization preserves the browser scroll position');

  router.navigate('roadbook');
  assert.deepEqual(scrollCalls.at(-1), { top: 0, left: 0, behavior: 'instant' }, 'a new view starts at its beginning');
  f.window.scrollX = 4; f.window.scrollY = 960;
  router.navigate('itinerary');
  f.window.scrollX = 2; f.window.scrollY = 510;
  router.navigate('roadbook');
  assert.deepEqual(scrollCalls.at(-1), { top: 960, left: 4, behavior: 'instant' });

  f.window.scrollX = 6; f.window.scrollY = 1200;
  const callsBeforeRepeat = scrollCalls.length;
  router.navigate('roadbook');
  assert.equal(scrollCalls.length, callsBeforeRepeat, 'selecting the current view does not reset scrolling');
  assert.equal(f.window.scrollY, 1200); assert.equal(f.window.scrollX, 6);

  f.window.location.hash = '#explore'; f.window.emit('popstate');
  assert.deepEqual(scrollCalls.at(-1), { top: 240, left: 12, behavior: 'instant' }, 'browser history restores the earlier exploration position');
  router.navigate('roadbook');
  assert.deepEqual(scrollCalls.at(-1), { top: 1200, left: 6, behavior: 'instant' }, 'the latest position replaces the earlier saved position');
  router.navigate('itinerary');
  assert.deepEqual(scrollCalls.at(-1), { top: 510, left: 2, behavior: 'instant' }, 'another view keeps its independent position');
  router.destroy();
});

test('destroy detaches history and click listeners', () => {
  const f = fixture(), router = f.create(); router.destroy();
  f.window.location.hash = '#settings'; f.window.emit('hashchange'); f.window.emit('popstate');
  const event = f.document.emit('click', { target: f.links.library });
  assert.equal(router.current(), 'explore'); assert.equal(event.defaultPrevented, false); assertVisible(f, 'explore');
});
