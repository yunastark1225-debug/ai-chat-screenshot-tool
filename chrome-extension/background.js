const CDP_VERSION = "1.3";
const CLIPBOARD_BASE64_CHUNK_SIZE = 256 * 1024;
const MAX_DURATION_MS = 240_000;
let running = false;

chrome.commands.onCommand.addListener((command) => {
  if (command === "capture-full-page") void runCapture();
});
chrome.action.onClicked.addListener(() => void runCapture());

async function runCapture() {
  if (running) return;
  running = true;
  let tab;
  let documentId;
  let attached = false;
  let normalized = false;
  const deadline = Date.now() + MAX_DURATION_MS;
  const checkActive = async () => {
    if (Date.now() > deadline) throw new Error("Full-page capture timed out.");
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id !== tab?.id) throw new Error("Capture cancelled: the active tab changed.");
  };
  const page = async (operation, value = null) => {
    const [response] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, documentIds: [documentId] },
      func: async (operation, value) => {
        try {
          if (!globalThis.__aicClipboard) throw new Error("Clipboard session was lost.");
          return { ok: true, value: await globalThis.__aicClipboard[operation](value) };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
      args: [operation, value]
    });
    if (!response?.result?.ok) throw new Error(response?.result?.error || "Clipboard step failed.");
    return response.result.value;
  };
  try {
    await setBadge("…", "Capturing full page with Chrome DevTools Protocol…");
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null || !/^(https?:|file:)/.test(tab.url || "")) {
      throw new Error("This page cannot be captured. Open a normal web page.");
    }
    await checkActive();
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page.js"] });
    documentId = injection.documentId;
    normalized = true;
    await page("prepare");

    await chrome.debugger.attach({ tabId: tab.id }, CDP_VERSION);
    attached = true;
    const metrics = await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.getLayoutMetrics");
    const size = metrics.cssContentSize;
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
      throw new Error("Chrome did not return a valid page size.");
    }
    const screenshot = await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 }
    });
    if (!screenshot?.data) throw new Error("Chrome did not return a PNG.");
    await page("restore");
    normalized = false;
    await chrome.debugger.detach({ tabId: tab.id });
    attached = false;

    await checkActive();
    await copyBase64PngInPage(screenshot.data, page, checkActive);
    await setBadge("✓", `Copied ${Math.round(size.width)} × ${Math.round(size.height)} PNG to clipboard`);
  } catch (error) {
    console.error("Full-page capture failed:", error);
    await setBadge("!", error?.message || "Capture failed");
  } finally {
    if (normalized) await page("restore").catch(() => {});
    if (attached && tab?.id != null) await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    running = false;
  }
}

async function copyBase64PngInPage(base64, page, checkActive) {
  try {
    await checkActive();
    await page("clipboardBegin");
    for (let offset = 0; offset < base64.length; offset += CLIPBOARD_BASE64_CHUNK_SIZE) {
      await page("clipboardChunk", base64.slice(offset, offset + CLIPBOARD_BASE64_CHUNK_SIZE));
    }
    await checkActive();
    await page("clipboardFinish");
  } finally {
    await page("clipboardDiscard").catch(() => {});
  }
}

async function setBadge(text, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
}
