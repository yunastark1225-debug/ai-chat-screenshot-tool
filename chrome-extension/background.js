const OFFSCREEN_PATH = "offscreen.html";
// Chrome permits at most two captureVisibleTab calls per second.
const CAPTURE_INTERVAL_MS = 550;
const MAX_STEPS = 200;
const MAX_DURATION_MS = 240_000;
const NATIVE_PASTE_HOST = "com.ai_chat_screenshot.full_page_paste";
let running = false;
let lastCaptureAt = 0;

chrome.commands.onCommand.addListener((command) => {
  if (command === "capture-full-page") void runCapture({ pasteAfterCapture: false });
  if (command === "capture-full-page-and-paste") void runCapture({ pasteAfterCapture: true });
  if (command === "set-paste-target") void setPasteTarget();
});
chrome.action.onClicked.addListener(() => void runCapture({ pasteAfterCapture: false }));

async function runCapture({ pasteAfterCapture = false } = {}) {
  if (running) return;
  running = true;
  let tab, documentId, offscreen = false, cancelled = false;
  const deadline = Date.now() + MAX_DURATION_MS;
  const onActivated = (info) => {
    if (tab && info.windowId === tab.windowId && info.tabId !== tab.id) cancelled = true;
  };
  const onUpdated = (id, change) => {
    if (id === tab?.id && (change.status === "loading" || change.url)) cancelled = true;
  };
  const onFocus = (id) => {
    if (tab && id !== tab.windowId) cancelled = true;
  };
  const onBoundsChanged = (window) => {
    if (tab && window.id === tab.windowId) cancelled = true;
  };
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.windows.onFocusChanged.addListener(onFocus);
  chrome.windows.onBoundsChanged.addListener(onBoundsChanged);
  const checkActive = async () => {
    if (cancelled) throw new Error("Capture cancelled: tab, page or window changed. Retry in the target tab.");
    if (Date.now() > deadline) throw new Error("Page is too long or keeps changing (4 minute limit).");
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const window = await chrome.windows.get(tab.windowId);
    if (active?.id !== tab.id || !window.focused) throw new Error("Keep the target Chrome tab in the foreground during capture.");
  };
  const page = async (operation, value = null) => {
    const [response] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, documentIds: [documentId] },
      func: async (operation, value) => {
        try {
          if (!globalThis.__aicCapture) throw new Error("Capture page session was lost.");
          return { ok: true, value: await globalThis.__aicCapture[operation](value) };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }, args: [operation, value]
    });
    if (!response?.result?.ok) throw new Error(response?.result?.error || "Page capture step failed.");
    return response.result.value;
  };
  try {
    await setBadge("…", "Capturing full page… Keep this tab in the foreground.");
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null || !/^(https?:|file:)/.test(tab.url || "")) {
      throw new Error("This page cannot be captured. Open a normal web page.");
    }
    await checkActive();
    await ensureOffscreenDocument();
    offscreen = true;
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page.js"] });
    documentId = injection.documentId;

    // One bounded retry allows a late image/font/layout change to settle.
    for (let attempt = 0; attempt < 2; attempt++) {
      await sendOffscreen({ type: "RESET_CAPTURE" });
      let metrics = await page("scroll", 0);
      let bottomReached = false;
      // Warm lazy images and discover the final height before allocating a canvas.
      for (let step = 0; step < MAX_STEPS; step++) {
        await checkActive();
        if (metrics.scrollY + metrics.viewportHeight >= metrics.totalHeight - 1) {
          const settled = await page("scroll", metrics.scrollY);
          if (settled.totalHeight === metrics.totalHeight) { bottomReached = true; break; }
          metrics = settled;
        }
        const next = await page("scroll", Math.min(metrics.scrollY + metrics.viewportHeight, metrics.totalHeight - metrics.viewportHeight));
        if (next.scrollY <= metrics.scrollY && next.totalHeight === metrics.totalHeight) throw new Error("This page cannot be scrolled to its bottom.");
        metrics = next;
      }
      if (!bottomReached) throw new Error("Page exceeds 200 viewports or scrolls indefinitely.");
      const baseline = await page("scroll", 0);
      let covered = 0;
      try {
        for (let step = 0; covered < baseline.totalHeight; step++) {
          if (step >= MAX_STEPS) throw new Error("Page exceeds 200 viewports.");
          await checkActive();
          const position = Math.min(covered, Math.max(0, baseline.totalHeight - baseline.viewportHeight));
          const before = await page("scroll", position);
          assertGeometry(baseline, before);
          if (before.scrollY > covered || before.scrollY + before.viewportHeight <= covered) throw new Error("Page scrolling left a gap in the capture.");
          await sleep(Math.max(0, lastCaptureAt + CAPTURE_INTERVAL_MS - Date.now()));
          await checkActive();
          // Read again after the rate-limit wait, then verify after capture too.
          const ready = await page("metrics");
          assertGeometry(before, ready, true);
          lastCaptureAt = Date.now();
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
          await checkActive();
          const after = await page("metrics");
          assertGeometry(ready, after, true);
          await sendOffscreen({ type: covered === 0 ? "INIT_CAPTURE" : "ADD_CAPTURE", ...baseline, scrollY: ready.scrollY, dataUrl });
          covered = Math.min(baseline.totalHeight, ready.scrollY + ready.viewportHeight);
        }
        break;
      } catch (error) {
        if (error.message !== "Page layout changed during capture." || attempt === 1) throw error;
      }
    }
    await page("restore");
    await checkActive();
    const token = crypto.randomUUID();
    const result = await sendOffscreen({ type: "FINISH_CAPTURE", token, tabId: tab.id });
    await copyInPage(token, page, checkActive);
    if (pasteAfterCapture) {
      // A tab/window switch after the PNG write must never paste into the new target.
      await checkActive();
      await restorePasteTarget(tab);
      await requestNativePaste();
    }
    await setBadge("✓", `Copied ${result.width} × ${result.height} PNG to clipboard${result.downscaled ? " (large page downscaled)" : ""}`);
  } catch (error) {
    console.error("Full-page capture failed:", error);
    await setBadge("!", error?.message || "Capture failed");
  } finally {
    // Always address the original document, never whichever tab is now active.
    if (documentId) await page("restore").catch(() => {});
    if (offscreen) await chrome.offscreen.closeDocument().catch(() => {});
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.windows.onFocusChanged.removeListener(onFocus);
    chrome.windows.onBoundsChanged.removeListener(onBoundsChanged);
    running = false;
  }
}

async function setPasteTarget() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null || tab.windowId == null) {
      throw new Error("No active Chrome tab is available to save as the paste target.");
    }
    await chrome.storage.local.set({
      pasteTarget: { windowId: tab.windowId, tabId: tab.id }
    });
    await setBadge("T", "Full Page paste target tab saved");
  } catch (error) {
    await setBadge("!", error?.message || "Could not save paste target");
  }
}

async function restorePasteTarget(sourceTab) {
  const { pasteTarget: target } = await chrome.storage.local.get("pasteTarget");
  if (!target?.tabId || !target?.windowId) {
    throw new Error("PNG was copied, but no paste target tab is set. Open ChatGPT and press Option+Shift+T once.");
  }
  if (target.tabId === sourceTab.id) {
    throw new Error("PNG was copied, but the paste target is the capture tab. Choose a different AI chat tab with Option+Shift+T.");
  }
  let targetTab;
  try {
    targetTab = await chrome.tabs.get(target.tabId);
  } catch (_) {
    throw new Error("PNG was copied, but the saved paste target tab no longer exists. Set it again with Option+Shift+T.");
  }
  if (targetTab.windowId !== target.windowId) {
    throw new Error("PNG was copied, but the saved paste target window no longer exists. Set the target again with Option+Shift+T.");
  }
  try {
    await chrome.windows.update(target.windowId, { focused: true });
    await chrome.tabs.update(target.tabId, { active: true });
    const [active] = await chrome.tabs.query({ active: true, windowId: target.windowId });
    if (active?.id !== target.tabId) throw new Error("Chrome did not activate the saved paste target.");
  } catch (error) {
    throw new Error(`PNG was copied, but automatic paste was cancelled: ${error.message}`);
  }
  return target;
}

async function requestNativePaste() {
  let response;
  try {
    response = await chrome.runtime.sendNativeMessage(NATIVE_PASTE_HOST, {
      type: "paste-full-page-png",
      protocol: 1
    });
  } catch (error) {
    throw new Error(`PNG was copied, but automatic paste failed: ${error.message}`);
  }
  if (!response?.ok) {
    throw new Error(`PNG was copied, but automatic paste failed: ${response?.error || "native host rejected the request"}`);
  }
}


function assertGeometry(expected, actual, position = false) {
  const keys = ["totalHeight", "viewportWidth", "viewportHeight", "screenshotHeight", "contentWidth", "dpr", "layoutVersion"];
  if (keys.some((key) => expected[key] !== actual[key]) || (position && expected.scrollY !== actual.scrollY) || actual.scrollX !== 0) {
    throw new Error("Page layout changed during capture.");
  }
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)] });
  if (!contexts.length) await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH, reasons: ["CLIPBOARD"],
    justification: "Stitch page screenshots and copy the resulting PNG to the clipboard."
  });
}
async function sendOffscreen(message) {
  const response = await chrome.runtime.sendMessage({ target: "offscreen", ...message });
  if (!response?.ok) throw new Error(response?.error || "Offscreen capture step failed.");
  return response;
}
async function setBadge(text, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function copyInPage(token, page, checkActive) {
  try {
    await checkActive();
    await page("clipboardBegin");
    let offset = 0;
    let total = 0;
    do {
      const chunk = await sendOffscreen({ type: "CLIPBOARD_CHUNK", token, offset });
      offset = chunk.next;
      total = chunk.total;
      await page("clipboardChunk", chunk.data);
    } while (offset < total);
    await checkActive();
    await page("clipboardFinish");
  } finally {
    await page("clipboardDiscard").catch(() => {});
  }
}
