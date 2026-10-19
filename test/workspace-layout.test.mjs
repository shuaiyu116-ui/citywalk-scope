import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicDirectory = new URL('../public/', import.meta.url);
const readPublic = name => readFileSync(new URL(name, publicDirectory), 'utf8');

// Preserve ancestry when checking nested sections; section-closing regexes cannot
// distinguish a workspace view from one of its inner cards.
function parseHtml(source) {
  const root = { tag: '#document', attributes: {}, parent: null };
  const nodes = [];
  const stack = [root];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const markup = source.replace(/(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2\s*>)/gi, '$1$3');
  const tokens = markup.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g);

  for (const [token] of tokens) {
    if (token.startsWith('<!')) continue;
    const tag = /^<\/?([\w:-]+)/.exec(token)[1].toLowerCase();
    if (token.startsWith('</')) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const attributes = {};
    const attributeText = token.replace(/^<[\w:-]+/, '').replace(/\/?\s*>$/, '');
    for (const match of attributeText.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    const node = { tag, attributes, parent: stack.at(-1) };
    nodes.push(node);
    if (!voidTags.has(tag) && !/\/\s*>$/.test(token)) stack.push(node);
  }
  return nodes;
}

const nodes = parseHtml(readPublic('index.html'));
const has = (node, attribute) => Object.hasOwn(node.attributes, attribute);
const byId = id => nodes.find(node => node.attributes.id === id);
function ancestor(node, predicate) {
  for (let current = node; current; current = current.parent) {
    if (predicate(current)) return current;
  }
  return null;
}
const viewOf = node => ancestor(node, item => has(item, 'data-workspace-view'))?.attributes['data-workspace-view'];
const viewNames = ['explore', 'itinerary', 'roadbook', 'discover', 'library', 'settings'];

test('workspace views have unique IDs, accessible headings and navigation', () => {
  const ids = nodes.filter(node => has(node, 'id')).map(node => node.attributes.id);
  assert.equal(new Set(ids).size, ids.length, 'every HTML ID must be unique');
  const views = nodes.filter(node => has(node, 'data-workspace-view'));
  assert.deepEqual(views.map(node => node.attributes['data-workspace-view']), viewNames);
  const navigation = byId('workspaceNav');
  assert.ok(navigation, 'workspace navigation remains mounted');
  const links = nodes.filter(node => node.tag === 'a' && ancestor(node, item => item === navigation));
  assert.deepEqual(links.map(node => node.attributes['data-workspace-link']), viewNames);

  for (const view of views) {
    const name = view.attributes['data-workspace-view'];
    assert.equal(view.tag, 'section');
    assert.equal(has(view, 'hidden'), name !== 'explore', `${name} initial visibility`);
    const title = byId(view.attributes['aria-labelledby']);
    assert.ok(title, `${name} has an associated heading`);
    assert.equal(viewOf(title), name);
    assert.ok(has(title, 'data-view-title'));
    assert.equal(title.attributes.tabindex, '-1');
    assert.equal(links.find(link => link.attributes['data-workspace-link'] === name).attributes.href, `#${name}`);
  }
});

test('app selectors still resolve after controls move between views', () => {
  const source = readPublic('app.js');
  const references = new Set();
  for (const match of source.matchAll(/(?:\$|\bquerySelector(?:All)?)\(\s*(['"])([^'"]*)\1\s*\)/g)) {
    for (const [, id] of match[2].matchAll(/#([A-Za-z][\w:-]*)/g)) references.add(id);
  }
  for (const match of source.matchAll(/\bgetElementById\(\s*(['"])([^'"]+)\1\s*\)/g)) references.add(match[2]);
  assert.ok(references.size > 30, 'check actual app selectors, not an empty extraction');
  const dynamicallyCreated = new Set(['dayEmpty']);
  const missing = [...references].filter(id => !byId(id) && !dynamicallyCreated.has(id));
  assert.deepEqual(missing, [], `static app controls must exist: ${missing.join(', ')}`);

  for (const match of source.matchAll(/\$\(\s*(['"])#([\w:-]+)\1\s*\)\.(?:showModal|close)\s*\(/g)) {
    assert.equal(byId(match[2])?.tag, 'dialog', `${match[2]} must remain a dialog when modal methods are called`);
  }
});

test('conversation and map stay on explore while task controls belong to dedicated views', () => {
  const responsibilities = {
    explore: ['conversationPanel', 'routeForm', 'promptInput', 'generateButton', 'agentReview', 'dayNavigation', 'mapCanvas', 'scene3d', 'resetView', 'activeName'],
    itinerary: ['routeDistance', 'routeDuration', 'tripContextSummary', 'stopsSummary', 'stopList', 'itineraryEditor'],
    roadbook: ['libraryButton', 'shareButton', 'roadbookButton', 'roadbookDayNavigation', 'scheduleDetails', 'prevStop', 'playWalk', 'nextStop', 'walkCounter'],
    discover: ['syncButton', 'navigationDetails'],
    library: ['libraryDialog', 'libraryRoot', 'offlineStatus'],
    settings: ['settingsDialog', 'settingsForm', 'deepseekKey', 'saveSettings', 'tripOptions', 'tripFields', 'preferencesRoot', 'profileRoot'],
  };
  for (const [name, ids] of Object.entries(responsibilities)) {
    for (const id of ids) {
      assert.ok(byId(id), `${id} exists`);
      assert.equal(viewOf(byId(id)), name, `${id} belongs to ${name}`);
    }
  }

  for (const [name, ids] of Object.entries(responsibilities)) {
    if (name === 'explore') continue;
    for (const id of ids) assert.notEqual(viewOf(byId(id)), 'explore', `${id} does not clutter the conversation/map view`);
  }
  assert.equal(viewOf(byId('storyboard')), undefined, 'legacy storyboard stays mounted outside the visible views');
  assert.ok(has(byId('storyboard'), 'hidden'));
  assert.equal(byId('libraryDialog').tag, 'section', 'the collection is a persistent page');
  assert.equal(byId('settingsDialog').tag, 'section', 'settings are a persistent page');
  for (const id of ['poiDialog', 'roadbookDialog', 'shareDialog']) assert.equal(byId(id)?.tag, 'dialog', `${id} remains a focused modal action`);
});

test('trip conditions remain associated with routeForm outside its DOM subtree', () => {
  const fields = byId('tripFields');
  const routeForm = byId('routeForm');
  assert.equal(routeForm?.tag, 'form');
  assert.equal(viewOf(fields), 'settings');
  assert.equal(ancestor(fields, node => node === routeForm), null);
  const controls = nodes.filter(node => ['input', 'select', 'textarea'].includes(node.tag) && ancestor(node, item => item === fields));
  assert.ok(controls.length >= 11, 'all date, time, transport, walking and companion controls remain available');
  for (const control of controls) assert.equal(control.attributes.form, 'routeForm', `${control.attributes.id || control.attributes.name} retains its route form association`);
});

test('standalone library and share pages load existing local styles and scripts', () => {
  for (const page of ['library.html', 'share.html']) {
    const pageNodes = parseHtml(readPublic(page));
    const ids = pageNodes.filter(node => has(node, 'id')).map(node => node.attributes.id);
    assert.equal(new Set(ids).size, ids.length, `${page} has unique IDs`);
    assert.ok(pageNodes.some(node => node.tag === 'link' && node.attributes.href === '/standalone.css'), `${page} uses the shared standalone design`);
    for (const node of pageNodes) {
      const path = node.tag === 'link' ? node.attributes.href : ['script', 'img', 'source'].includes(node.tag) ? node.attributes.src : null;
      if (!path?.startsWith('/') || path.startsWith('//')) continue;
      const resource = new URL(path.slice(1).split(/[?#]/, 1)[0], publicDirectory);
      assert.ok(existsSync(fileURLToPath(resource)), `${page} local resource exists: ${path}`);
    }
  }
});
