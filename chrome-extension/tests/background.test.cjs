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

function pngBase64(width, height, marker = 0) {
  const bytes = Buffer.alloc(25);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = marker;
  return bytes.toString('base64');
}

function setup(options = {}) {
  const calls = [];
  const badges = [];
  const draws = [];
  const content = options.content || { width: 1000, height: 12573 };
  const viewport = options.viewport || { width: 1000, height: 700, dpr: 2 };
  let activeId = 1;
  let captureIndex = 0;
  class FakeCanvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { drawImage: (...args) => draws.push(args) }; }
    async convertToBlob() { return new Blob(['stitched-png'], { type: 'image/png' }); }
  }
  const chrome = {
    commands: { onCommand: event() },
    action: {
      onClicked: event(),
      setBadgeText: async ({ text }) => badges.push(text),
      setTitle: async () => {}
    },
    tabs: { query: async () => [{ id: activeId, windowId: 10, url: 'https://example.test/article' }] },
    scripting: {
      executeScript: async (request) => {
        if (request.files) return [{ documentId: 'original-document' }];
        assert.equal(request.target.tabId, 1);
        assert.deepEqual(Array.from(request.target.documentIds), ['original-document']);
        const [operation, value] = request.args;
        calls.push(['page', operation, value]);
        if (operation === 'prepare' && options.failPrepare) return [{ result: { ok: false, error: 'Normalization failed' } }];
        if (operation === 'clipboardFinish' && options.failClipboard) return [{ result: { ok: false, error: 'Clipboard denied' } }];
        if (operation === 'viewport') return [{ result: { ok: true, value: viewport } }];
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
        if (command === 'Page.getLayoutMetrics') return { cssContentSize: content };
        if (options.failScreenshot) throw new Error('Screenshot failed');
        if (options.switchTabDuringCapture) activeId = 2;
        const index = captureIndex++;
        const marker = options.repeatBands ? 1 : index + 1;
        const width = Math.round(content.width * viewport.dpr);
        const height = options.invalidBandSize && index === 1
          ? 1
          : Math.round(parameters.clip.height * viewport.dpr);
        return { data: pngBase64(width, height, marker) };
      },
      detach: async (target) => calls.push(['detach', target])
    }
  };
  const context = vm.createContext({
    chrome,
    console: { error() {} },
    Date: { now: () => 1000 },
    atob,
    btoa,
    Blob,
    Uint8Array,
    DataView,
    OffscreenCanvas: FakeCanvas,
    createImageBitmap: async () => ({ close() {} })
  });
  vm.runInContext(code, context);
  return { run: () => vm.runInContext('runCapture()', context), calls, badges, draws };
}

test('captures a long DPR 2 page as distinct document-coordinate bands without scrolling', async () => {
  const state = setup();
  await state.run();
  const captures = state.calls.filter(([name, , command]) => name === 'command' && command === 'Page.captureScreenshot');
  assert.equal(captures.length, 19);
  assert.deepEqual(captures.map(([, , , parameters]) => parameters.clip.y), Array.from({ length: 19 }, (_, index) => index * 698));
  assert.ok(captures.every(([, , , parameters]) => parameters.captureBeyondViewport && parameters.fromSurface));
  assert.ok(captures.every(([, , , parameters]) => parameters.clip.height <= 700));
  assert.equal(state.draws.length, 19);
  assert.equal(state.calls.some(([name, operation]) => name === 'page' && operation === 'scroll'), false);
  assert.equal(state.badges.at(-1), '✓');
});

for (const dpr of [1, 1.25, 1.5, 2, 3]) {
  test(`stitches a 6000+ CSS px page at DPR ${dpr}`, async () => {
    const state = setup({ content: { width: 800, height: 6001 }, viewport: { width: 800, height: 700, dpr } });
    await state.run();
    assert.equal(state.calls.filter(([name, , command]) => name === 'command' && command === 'Page.captureScreenshot').length, 9);
    assert.equal(state.badges.at(-1), '✓');
  });
}

test('rejects repeated viewport bands instead of silently stitching them', async () => {
  const state = setup({ repeatBands: true });
  await state.run();
  assert.equal(state.badges.at(-1), '!');
  assert.equal(state.calls.some(([name, operation]) => name === 'page' && operation === 'clipboardBegin'), false);
});

test('rejects a band whose PNG dimensions do not match its requested clip', async () => {
  const state = setup({ invalidBandSize: true });
  await state.run();
  assert.equal(state.badges.at(-1), '!');
});

test('does not capture twice when the shortcut is pressed twice', async () => {
  const state = setup({ content: { width: 800, height: 600 } });
  await Promise.all([state.run(), state.run()]);
  assert.equal(state.calls.filter(([name]) => name === 'attach').length, 1);
  assert.equal(state.calls.filter(([name, operation]) => name === 'page' && operation === 'clipboardFinish').length, 1);
});

test('attach failure restores normalized CSS and never starts a clipboard session', async () => {
  const state = setup({ failAttach: true });
  await state.run();
  assert.equal(state.calls.filter(([name]) => name === 'detach').length, 0);
  assert.equal(state.calls.filter(([name, operation]) => name === 'page' && operation === 'restore').length, 1);
  assert.equal(state.calls.some(([name, operation]) => name === 'page' && operation === 'clipboardBegin'), false);
  assert.equal(state.badges.at(-1), '!');
});

for (const [name, options] of [
  ['screenshot failure', { failScreenshot: true }],
  ['clipboard failure', { content: { width: 800, height: 600 }, failClipboard: true }],
  ['tab switch during capture', { switchTabDuringCapture: true }]
]) {
  test(`${name} restores CSS and detaches the debugger`, async () => {
    const state = setup(options);
    await state.run();
    assert.equal(state.calls.filter(([call]) => call === 'detach').length, 1);
    assert.equal(state.calls.filter(([call, operation]) => call === 'page' && operation === 'restore').length, 1);
    assert.equal(state.badges.at(-1), '!');
  });
}
