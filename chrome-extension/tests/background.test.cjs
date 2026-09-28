const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const code = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const event = () => ({
  listeners: [],
  addListener(fn) { this.listeners.push(fn); },
  removeListener(fn) { this.listeners = this.listeners.filter((item) => item !== fn); }
});

function setup(options = {}) {
  const calls = [];
  const badges = [];
  let activeId = 1;
  const size = options.size || { width: 1250, height: 12573 };
  const base64 = options.base64 || 'aGVsbG8=';
  const chrome = {
    commands: { onCommand: event() },
    action: {
      onClicked: event(),
      setBadgeText: async ({ text }) => badges.push(text),
      setTitle: async () => {}
    },
    tabs: {
      query: async () => [{ id: activeId, windowId: 10, url: 'https://example.test/article' }]
    },
    scripting: {
      executeScript: async (request) => {
        if (request.files) return [{ documentId: 'original-document' }];
        assert.equal(request.target.tabId, 1);
        assert.deepEqual(Array.from(request.target.documentIds), ['original-document']);
        const [operation, value] = request.args;
        calls.push(['page', operation, value]);
        if (operation === 'prepare' && options.failPrepare) {
          return [{ result: { ok: false, error: 'Normalization failed' } }];
        }
        if (operation === 'clipboardFinish' && options.failClipboard) {
          return [{ result: { ok: false, error: 'Clipboard denied' } }];
        }
        return [{ result: { ok: true } }];
      }
    },
    debugger: {
      attach: async (target, version) => {
        calls.push(['attach', target, version]);
        if (options.failAttach) throw new Error('Debugger already attached');
      },
      sendCommand: async (target, command, parameters) => {
        calls.push(['command', target, command, parameters]);
        if (command === 'Page.getLayoutMetrics') return { cssContentSize: size };
        if (options.failScreenshot) throw new Error('Screenshot failed');
        if (options.switchTabDuringCapture) activeId = 2;
        return { data: base64 };
      },
      detach: async (target) => calls.push(['detach', target])
    }
  };
  const context = vm.createContext({
    chrome,
    console: { error() {} },
    Date: { now: () => 1000 }
  });
  vm.runInContext(code, context);
  return { run: () => vm.runInContext('runCapture()', context), calls, badges };
}

test('captures a long DPR/zoom page with one CDP screenshot and copies its PNG', async () => {
  const state = setup({ size: { width: 1250.5, height: 12573.25 }, base64: 'a'.repeat(300000) });
  await state.run();
  const commands = state.calls.filter(([name]) => name === 'command');
  assert.deepEqual(commands.map(([, , command]) => command), ['Page.getLayoutMetrics', 'Page.captureScreenshot']);
  assert.deepEqual(JSON.parse(JSON.stringify(commands[1][3])), {
    format: 'png', fromSurface: true, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1250.5, height: 12573.25, scale: 1 }
  });
  assert.equal(state.calls.filter(([name]) => name === 'attach').length, 1);
  assert.equal(state.calls.filter(([name]) => name === 'detach').length, 1);
  const restore = state.calls.findIndex(([name, operation]) => name === 'page' && operation === 'restore');
  const detach = state.calls.findIndex(([name]) => name === 'detach');
  assert.ok(restore >= 0 && restore < detach, 'restores page CSS before detaching CDP');
  assert.equal(state.calls.filter(([name, operation]) => name === 'page' && operation === 'clipboardBegin').length, 1);
  assert.equal(state.calls.filter(([name, operation]) => name === 'page' && operation === 'clipboardChunk').length, 2);
  assert.equal(state.calls.filter(([name, operation]) => name === 'page' && operation === 'clipboardFinish').length, 1);
  assert.equal(state.badges.at(-1), '✓');
});

test('captures a short page with one full-page CDP request', async () => {
  const state = setup({ size: { width: 800, height: 600 } });
  await state.run();
  const screenshot = state.calls.find(([name, , command]) => name === 'command' && command === 'Page.captureScreenshot');
  assert.deepEqual(JSON.parse(JSON.stringify(screenshot[3].clip)), { x: 0, y: 0, width: 800, height: 600, scale: 1 });
  assert.equal(state.badges.at(-1), '✓');
});

test('does not capture twice when the shortcut is pressed twice', async () => {
  const state = setup();
  await Promise.all([state.run(), state.run()]);
  assert.equal(state.calls.filter(([name]) => name === 'attach').length, 1);
  assert.equal(state.calls.filter(([name, operation]) => name === 'page' && operation === 'clipboardFinish').length, 1);
});

test('attach failure restores normalized CSS and never starts a clipboard session', async () => {
  const state = setup({ failAttach: true });
  await state.run();
  assert.equal(state.calls.filter(([name]) => name === 'detach').length, 0);
  assert.equal(state.calls.filter(([name, operation]) => name === 'page' && operation === 'prepare').length, 1);
  assert.equal(state.calls.filter(([name, operation]) => name === 'page' && operation === 'restore').length, 1);
  assert.equal(state.calls.some(([name, operation]) => name === 'page' && operation === 'clipboardBegin'), false);
  assert.equal(state.badges.at(-1), '!');
});

test('normalization failure still requests CSS restoration', async () => {
  const state = setup({ failPrepare: true });
  await state.run();
  assert.equal(state.calls.filter(([name]) => name === 'attach').length, 0);
  assert.equal(state.calls.filter(([name, operation]) => name === 'page' && operation === 'restore').length, 1);
  assert.equal(state.badges.at(-1), '!');
});

for (const [name, options] of [
  ['captureScreenshot failure', { failScreenshot: true }],
  ['very long screenshot failure', { size: { width: 1200, height: 500000 }, failScreenshot: true }],
  ['clipboard failure', { failClipboard: true }],
  ['tab switch after capture', { switchTabDuringCapture: true }]
]) {
  test(`${name} reports failure and detaches the debugger`, async () => {
    const state = setup(options);
    await state.run();
    assert.equal(state.calls.filter(([call]) => call === 'detach').length, 1);
    assert.equal(state.calls.filter(([call, operation]) => call === 'page' && operation === 'restore').length, 1);
    assert.equal(state.badges.at(-1), '!');
  });
}
