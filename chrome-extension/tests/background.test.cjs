const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, removeListener(fn) { this.listeners = this.listeners.filter(x => x !== fn); } });
function setup(options = {}) {
  const calls = [], badges = [], positions = [], nativeCalls = [];
  let activeId = 1, y = 0, now = 1000, height = 1700, captures = 0, stopped = false;
  const metrics = () => ({ totalHeight: height, viewportHeight: 800, screenshotHeight: 800, viewportWidth: 1200, contentWidth: 1200, dpr: 2, layoutVersion: 0, scrollX: 0, scrollY: y });
  const chrome = {
    commands: { onCommand: event() }, action: { onClicked: event(), setBadgeText: async ({text}) => badges.push(text), setTitle: async () => {} },
    windows: { onFocusChanged: event(), get: async () => ({focused:true}) },
    tabs: {
      onActivated: event(), onUpdated: event(), query: async () => [{id:activeId, windowId:10, url:'https://example.test'}],
      captureVisibleTab: async () => {
        calls.push(['capture', now]); captures++;
        if (options.failCapture) throw new Error('Capture failed');
        if (options.grow && captures === 1) height = 1900;
        if (options.switchTab && captures === 1) {
          activeId = 2;
          chrome.tabs.onActivated.listeners.forEach(fn => fn({tabId:2,windowId:10}));
        }
        return 'png';
      }
    },
    scripting: { executeScript: async (request) => {
      if (request.files) return [{documentId:'original-document'}];
      assert.deepEqual(Array.from(request.target.documentIds), ['original-document']);
      assert.equal(request.target.tabId, 1);
      assert.ok(request.args.every(value => value !== undefined), 'executeScript args must serialize');
      const [op, value] = request.args;
      calls.push([op, value]);
      if (op === 'clipboardFinish' && options.failClipboardWrite) return [{result:{ok:false,error:'Clipboard denied'}}];
      if (op === 'restore') { stopped = true; return [{result:{ok:true}}]; }
      if (op === 'scroll') { y = Math.max(0, Math.min(value, height - 800)); positions.push(y); }
      return [{result:{ok:true,value:metrics()}}];
    } },
    runtime: { id:'extension', onMessage:event(), getURL: s => s, getContexts: async () => [], sendNativeMessage: async (host, message) => {
      nativeCalls.push([host, message]);
      if (options.failNativePaste) throw new Error('Native host unavailable');
      return {ok:true};
    }, sendMessage: async (msg) => {
      calls.push([msg.type, msg.scrollY]);
      if (options.failClipboard && msg.type === 'FINISH_CAPTURE') return {ok:false,error:'Clipboard denied'};
      if (options.switchAfterClipboard && msg.type === 'FINISH_CAPTURE') {
        activeId = 2;
        chrome.tabs.onActivated.listeners.forEach(fn => fn({tabId:2,windowId:10}));
      }
      if (msg.type === 'CLIPBOARD_CHUNK') return {ok:true,data:'',next:1,total:1};
      if (msg.type === 'FINISH_CAPTURE') assert.ok(stopped, 'restore before copying');
      return {ok:true,width:2400,height:height*2};
    } },
    offscreen: { createDocument: async () => {}, closeDocument: async () => {calls.push(['close']);} }
  };
  const context = vm.createContext({ chrome, console: {error(){}}, Date: {now:()=>now}, crypto: {randomUUID:()=> 'token'}, clearTimeout() {}, setTimeout: (fn, ms) => {if(ms===30000)return; now += ms;fn();} });
  vm.runInContext(code,context);
  return {run:() => vm.runInContext('runCapture({pasteAfterCapture:false})',context), runPaste:() => vm.runInContext('runCapture({pasteAfterCapture:true})',context), calls,badges,positions,nativeCalls,chrome};
}
test('successful run uses overlapping last tile, restores, copies once and closes offscreen', async () => {
  const s = setup(); await s.run();
  assert.deepEqual(s.calls.filter(x => /^(INIT|ADD)_CAPTURE$/.test(x[0])).map(x=>x[1]), [0,800,900]);
  assert.equal(s.calls.filter(x=>x[0]==='FINISH_CAPTURE').length,1);
  assert.deepEqual(s.calls.filter(x=>x[0]==='clipboardBegin').length, 1);
  assert.deepEqual(s.calls.filter(x=>x[0]==='clipboardChunk').length, 1);
  assert.deepEqual(s.calls.filter(x=>x[0]==='clipboardFinish').length, 1);
  const times=s.calls.filter(x=>x[0]==='capture').map(x=>x[1]);
  assert.ok(times.slice(1).every((t,i)=>t-times[i]>=550));
  assert.equal(s.badges.at(-1),'✓');
  assert.equal(s.calls.at(-1)[0],'close');
});
test('double invocation is ignored', async () => {
  const s=setup(); await Promise.all([s.run(),s.run()]);
  assert.equal(s.calls.filter(x=>x[0]==='FINISH_CAPTURE').length,1);
});
test('the dedicated command requests one native paste only after PNG copy succeeds', async () => {
  const s = setup(); await s.runPaste();
  assert.equal(s.nativeCalls.length, 1);
  assert.equal(s.nativeCalls[0][0], 'com.ai_chat_screenshot.full_page_paste');
  assert.equal(s.nativeCalls[0][1].type, 'paste-full-page-png');
  assert.equal(s.nativeCalls[0][1].protocol, 1);
  assert.equal(s.badges.at(-1), '✓');
});
test('native paste failure does not retry or report success', async () => {
  const s = setup({failNativePaste:true}); await s.runPaste();
  assert.equal(s.nativeCalls.length, 1);
  assert.equal(s.badges.at(-1), '!');
});
test('a tab switch after PNG copy prevents the native paste', async () => {
  const s = setup({switchAfterClipboard:true}); await s.runPaste();
  assert.equal(s.nativeCalls.length, 0);
  assert.equal(s.badges.at(-1), '!');
});
for(const option of ['failCapture','failClipboard','failClipboardWrite','switchTab']) test(`${option}: restore original document and release lock/resources`,async()=>{
  const s=setup({[option]:true}); await s.run();
  assert.ok(s.calls.some(x=>x[0]==='restore'));
  assert.equal(s.calls.at(-1)[0],'close');
  assert.equal(s.badges.at(-1),'!');
  if(option==='failCapture' || option==='switchTab') assert.ok(!s.calls.some(x=>x[0]==='FINISH_CAPTURE'));
  assert.equal(s.chrome.tabs.onActivated.listeners.length,0);
});
test('late height change restarts instead of copying a truncated image',async()=>{
  const s=setup({grow:true}); await s.run();
  assert.equal(s.calls.filter(x=>x[0]==='RESET_CAPTURE').length,2);
  assert.equal(s.calls.filter(x=>x[0]==='FINISH_CAPTURE').length,1);
  assert.equal(s.badges.at(-1),'✓');
});
