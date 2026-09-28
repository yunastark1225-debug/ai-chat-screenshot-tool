const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Style {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getPropertyValue(property) { return this.values.get(property)?.[0] || ''; }
  getPropertyPriority(property) { return this.values.get(property)?.[1] || ''; }
  setProperty(property, value, priority = '') { this.values.set(property, [value, priority]); }
  removeProperty(property) { this.values.delete(property); }
}

function element(position, values) {
  return { style: new Style(values), position, shadowRoot: null };
}

test('normalizes fixed and sticky elements, then restores inline values and priorities', async () => {
  const fixed = element('fixed', { opacity: ['0.75', 'important'] });
  const sticky = element('sticky', { position: ['sticky', ''], top: ['12px', 'important'] });
  const documentElement = { append(node) { node.parent = this; } };
  const document = {
    documentElement,
    querySelectorAll() { return [fixed, sticky]; },
    createElement() { return { remove() { this.removed = true; } }; }
  };
  const context = vm.createContext({
    document,
    getComputedStyle: (item) => ({ position: item.position }),
    requestAnimationFrame: (callback) => callback(),
    atob: () => '',
    Uint8Array,
    Blob,
    navigator: {},
    ClipboardItem: undefined
  });
  vm.runInContext(fs.readFileSync(require.resolve('../page.js'), 'utf8'), context);
  await vm.runInContext('globalThis.__aicClipboard.prepare()', context);
  assert.deepEqual([...fixed.style.values.get('opacity')], ['0', 'important']);
  assert.deepEqual([...sticky.style.values.get('position')], ['relative', 'important']);
  assert.deepEqual([...sticky.style.values.get('top')], ['auto', 'important']);
  await vm.runInContext('globalThis.__aicClipboard.restore()', context);
  assert.deepEqual([...fixed.style.values.get('opacity')], ['0.75', 'important']);
  assert.deepEqual([...sticky.style.values.get('position')], ['sticky', '']);
  assert.deepEqual([...sticky.style.values.get('top')], ['12px', 'important']);
  for (const edge of ['right', 'bottom', 'left']) assert.equal(sticky.style.getPropertyValue(edge), '');
});
