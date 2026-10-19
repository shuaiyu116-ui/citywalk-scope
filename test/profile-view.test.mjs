import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceProfileStore } from '../public/device-profile.mjs';
import { createProfileView } from '../public/profile-view.mjs';

class Element {
  children = []; attributes = {}; dataset = {}; hidden = false; value = ''; textContent = '';
  constructor(tag) { this.tagName = tag.toUpperCase(); this.classList = { toggle() {} }; }
  set innerHTML(_) { throw Error('Profile rendering must use text nodes'); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  focus() { this.focused = true; }
  reportValidity() { return true; }
  reset() { for (const child of descendants(this)) if (['INPUT', 'TEXTAREA'].includes(child.tagName)) child.value = ''; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}
const descendants = root => root.children.flatMap(child => [child, ...descendants(child)]);
const find = (root, predicate) => descendants(root).find(predicate);
const byText = (root, text) => find(root, node => node.textContent === text);

test('settings profile displays source and scope safely, lets the user correct content, and clears only after inline confirmation', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  const root = new Element('div'), store = createDeviceProfileStore({ storage: null, eventTarget: null });
  try {
    store.saveItem({ id: 'interest', category: '兴趣', label: '喜欢的活动', value: '<img src=x onerror=alert(1)>安静看展', evidence: '<script>用户原话</script>', scope: 'trip' });
    const view = createProfileView({ root, store });
    assert.ok(byText(root, '用户画像'));
    assert.ok(byText(root, '<img src=x onerror=alert(1)>安静看展'));
    assert.ok(byText(root, '<script>用户原话</script>'));
    assert.ok(find(root, node => node.textContent.includes('本次旅行 · 新行程不沿用')));
    assert.ok(find(root, node => node.textContent.includes('此浏览器暂时无法保存数据')));
    byText(root, '修改').onclick();
    const form = find(root, node => node.className === 'profile-edit' && node.parentElement.className === 'profile-item');
    const textarea = find(form, node => node.tagName === 'TEXTAREA'); textarea.value = '平时喜欢安静看展';
    find(form, node => node.tagName === 'SELECT').value = 'long-term';
    form.onsubmit({ preventDefault() {} });
    assert.equal(store.getProfile().items[0].value, '平时喜欢安静看展');
    assert.equal(store.getProfile().items[0].scope, 'long-term');
    assert.equal(store.getProfile().items[0].source, 'user');
    byText(root, '清空画像').onclick();
    assert.equal(store.getProfile().items.length, 1);
    assert.equal(find(root, node => node.className === 'profile-confirm').hidden, false);
    byText(root, '确定清空').onclick(); assert.equal(store.getProfile().items.length, 0);
    view.destroy(); assert.equal(root.children.length, 0);
  } finally { store.dispose(); globalThis.document = previous; }
});
