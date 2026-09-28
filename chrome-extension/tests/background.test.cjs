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
  let y = 0;
  let now = 1000;
  let height = options.height || 1700;
  let captures = 0;
  let resized = false;
  const metrics = () => ({
    totalHeight: height,
    viewportHeight: 800,
    screenshotHeight: 800,
    viewportWidth: resized ? 1300 : 1200,
    contentWidth: resized ? 1300 : 1200,
    dpr: 2,
    layoutVersion: 0,
    scrollX: 0,
    scrollY: y
  });
  const chrome = {
    commands: { onCommand: event() },
    action: {
      onClicked: event(),
      setBadgeText: async ({ text }) => badges.push(text),
      setTitle: async () => {}
    },
    windows: {
      onFocusChanged: event(),
      onBoundsChanged: event(),
      get: async (id) => ({ id, focused: id === 10 })
    },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      query: async () => [{ id: activeId, windowId: 10, url: 'https://example.test' }],
      captureVisibleTab: async () => {
        calls.push(['capture', now]);
        captures += 1;
        if (options.failCapture) throw new Error('Capture failed');
        if (options.grow && captures === 1) height = 1900;
        if (options.switchTab && captures === 1) {
          activeId = 2;
          chrome.tabs.onActivated.listeners.forEach((fn) => fn({ tabId: 2, windowId: 10 }));
        }
        if (options.resizeDuringCapture && captures === 1) {
          resized = true;
          chrome.windows.onBoundsChanged.listeners.forEach((fn) => fn({ id: 10 }));
        }
        return 'png';
      }
    },
    scripting: {
      executeScript: async (request) => {
        if (request.files) return [{ documentId: 'original-document' }];
        assert.deepEqual(Array.from(request.target.documentIds), ['original-document']);
        assert.equal(request.target.tabId, 1);
        assert.ok(request.args.every((value) => value !== undefined));
        const [operation, value] = request.args;
        calls.push([operation, value]);
        if (operation === 'clipboardFinish' && options.failClipboardWrite) {
          return [{ result: { ok: false, error: 'Clipboard denied' } }];
        }
        if (operation === 'scroll') {
          const overshoot = options.slightScrollOvershoot && value > 0 ? 2 : 0;
          y = Math.max(0, Math.min(value + overshoot, height - 800));
        }
        return [{ result: { ok: true, value: metrics() } }];
      }
    },
    runtime: {
      id: 'extension',
      onMessage: event(),
      getURL: (path) => path,
      getContexts: async () => [],
      sendMessage: async (message) => {
        calls.push([message.type, message.scrollY]);
        if (message.type === 'FINISH_CAPTURE' && options.failClipboard) {
          return { ok: false, error: 'Clipboard denied' };
        }
        if (message.type === 'CLIPBOARD_CHUNK') return { ok: true, data: '', next: 1, total: 1 };
        return { ok: true, width: 2400, height: height * 2 };
      }
    },
    offscreen: {
      createDocument: async () => {},
      closeDocument: async () => calls.push(['close'])
    }
  };
  const context = vm.createContext({
    chrome,
    console: { error() {} },
    Date: { now: () => now },
    crypto: { randomUUID: () => 'token' },
    clearTimeout() {},
    setTimeout: (fn, ms) => {
      if (ms === 30000) return;
      now += ms;
      fn();
    }
  });
  vm.runInContext(code, context);
  return { run: () => vm.runInContext('runCapture()', context), calls, badges, chrome };
}

test('successful run stitches overlapping final tiles, restores, and copies once', async () => {
  const state = setup();
  await state.run();
  assert.deepEqual(state.calls.filter(([name]) => /^(INIT|ADD)_CAPTURE$/.test(name)).map(([, y]) => y), [0, 796, 900]);
  assert.equal(state.calls.filter(([name]) => name === 'FINISH_CAPTURE').length, 1);
  assert.equal(state.calls.filter(([name]) => name === 'clipboardBegin').length, 1);
  assert.equal(state.calls.filter(([name]) => name === 'clipboardChunk').length, 1);
  assert.equal(state.calls.filter(([name]) => name === 'clipboardFinish').length, 1);
  const times = state.calls.filter(([name]) => name === 'capture').map(([, time]) => time);
  assert.ok(times.slice(1).every((time, index) => time - times[index] >= 550));
  assert.equal(state.badges.at(-1), '✓');
  assert.equal(state.calls.at(-1)[0], 'close');
});

test('a long article tolerates a small scroll overshoot within the overlap', async () => {
  const state = setup({ height: 12573, slightScrollOvershoot: true });
  await state.run();
  const tiles = state.calls.filter(([name]) => /^(INIT|ADD)_CAPTURE$/.test(name)).map(([, y]) => y);
  assert.ok(tiles.length > 10, 'uses continuous tiles for a long article');
  assert.equal(tiles[0], 0);
  for (let index = 1; index < tiles.length; index++) {
    assert.ok(tiles[index] <= tiles[index - 1] + 800, `tile ${index} has no gap from tile ${index - 1}`);
  }
  assert.equal(state.calls.filter(([name]) => name === 'FINISH_CAPTURE').length, 1);
  assert.equal(state.badges.at(-1), '✓');
});

test('double invocation produces one clipboard image', async () => {
  const state = setup();
  await Promise.all([state.run(), state.run()]);
  assert.equal(state.calls.filter(([name]) => name === 'FINISH_CAPTURE').length, 1);
  assert.equal(state.badges.at(-1), '✓');
});

for (const option of ['failCapture', 'failClipboard', 'failClipboardWrite', 'switchTab', 'resizeDuringCapture']) {
  test(`${option} restores the source and never reports a copied PNG`, async () => {
    const state = setup({ [option]: true });
    await state.run();
    assert.ok(state.calls.some(([name]) => name === 'restore'));
    assert.equal(state.calls.at(-1)[0], 'close');
    assert.equal(state.badges.at(-1), '!');
    assert.equal(state.chrome.tabs.onActivated.listeners.length, 0);
    if (option === 'failCapture' || option === 'switchTab' || option === 'resizeDuringCapture') {
      assert.equal(state.calls.some(([name]) => name === 'FINISH_CAPTURE'), false);
    }
  });
}

test('a late document height change restarts before it copies', async () => {
  const state = setup({ grow: true });
  await state.run();
  assert.equal(state.calls.filter(([name]) => name === 'RESET_CAPTURE').length, 2);
  assert.equal(state.calls.filter(([name]) => name === 'FINISH_CAPTURE').length, 1);
  assert.equal(state.badges.at(-1), '✓');
});
