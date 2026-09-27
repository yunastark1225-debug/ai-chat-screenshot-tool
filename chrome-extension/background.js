const OFFSCREEN_PATH = "offscreen.html";
const CAPTURE_DELAY_MS = 180;

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "capture-full-page") {
    await runCapture();
  }
});

chrome.action.onClicked.addListener(async () => {
  await runCapture();
});

async function runCapture() {
  try {
    await setBadge("…", "Capturing full page…");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.windowId) {
      throw new Error("No active tab found.");
    }

    if (!/^https?:|^file:/.test(tab.url || "")) {
      throw new Error("This page cannot be captured by the extension.");
    }

    await ensureOffscreenDocument();

    const metrics = await execInTab(tab.id, preparePage);
    const maxScrollY = Math.max(0, metrics.totalHeight - metrics.viewportHeight);
    const targets = buildScrollTargets(metrics.totalHeight, metrics.viewportHeight, maxScrollY);

    let first = true;
    for (const targetY of targets) {
      const actualY = await execInTab(tab.id, scrollPageTo, [targetY]);
      await sleep(CAPTURE_DELAY_MS);

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

      if (first) {
        await sendOffscreen({
          target: "offscreen",
          type: "INIT_CAPTURE",
          totalHeight: metrics.totalHeight,
          viewportWidth: metrics.viewportWidth,
          viewportHeight: metrics.viewportHeight,
          scrollY: actualY,
          dataUrl
        });
        first = false;

        await execInTab(tab.id, hideFloatingElements);
      } else {
        await sendOffscreen({
          target: "offscreen",
          type: "ADD_CAPTURE",
          viewportHeight: metrics.viewportHeight,
          scrollY: actualY,
          dataUrl
        });
      }
    }

    await sendOffscreen({ target: "offscreen", type: "FINISH_CAPTURE" });
    await execInTab(tab.id, restorePage);

    await setBadge("✓", "Copied full page to clipboard");
    setTimeout(() => setBadge("", "Capture full page to clipboard"), 1500);
  } catch (error) {
    console.error("Full-page capture failed:", error);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await execInTab(tab.id, restorePage);
      }
    } catch (_) {
      // Best-effort restore only.
    }

    await setBadge("!", error?.message || "Capture failed");
    setTimeout(() => setBadge("", "Capture full page to clipboard"), 2500);
  }
}

function buildScrollTargets(totalHeight, viewportHeight, maxScrollY) {
  if (totalHeight <= viewportHeight) {
    return [0];
  }

  const targets = [];
  for (let y = 0; y < totalHeight; y += viewportHeight) {
    targets.push(Math.min(y, maxScrollY));
  }

  if (targets[targets.length - 1] !== maxScrollY) {
    targets.push(maxScrollY);
  }

  return [...new Set(targets)];
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    if (contexts.length > 0) return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["CLIPBOARD"],
      justification: "Stitch page screenshots and copy the resulting PNG to the clipboard."
    });
  } catch (error) {
    if (!String(error?.message || error).includes("single offscreen document")) {
      throw error;
    }
  }
}

async function sendOffscreen(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Offscreen capture step failed.");
  }
  return response;
}

async function execInTab(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return result;
}

async function setBadge(text, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function preparePage() {
  const root = document.documentElement;
  const body = document.body;

  root.dataset.aicOriginalScrollBehavior = root.style.scrollBehavior || "";
  if (body) body.dataset.aicOriginalScrollBehavior = body.style.scrollBehavior || "";

  root.style.scrollBehavior = "auto";
  if (body) body.style.scrollBehavior = "auto";

  root.dataset.aicOriginalScrollX = String(window.scrollX);
  root.dataset.aicOriginalScrollY = String(window.scrollY);

  window.scrollTo(0, 0);

  const totalHeight = Math.max(
    root.scrollHeight,
    root.offsetHeight,
    root.clientHeight,
    body?.scrollHeight || 0,
    body?.offsetHeight || 0,
    body?.clientHeight || 0
  );

  return {
    totalHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };
}

function scrollPageTo(y) {
  window.scrollTo(0, y);
  return window.scrollY;
}

function hideFloatingElements() {
  const elements = document.querySelectorAll("body *");

  for (const el of elements) {
    const style = getComputedStyle(el);
    if (style.position !== "fixed" && style.position !== "sticky") continue;
    if (el.dataset.aicCaptureHidden === "1") continue;

    el.dataset.aicCaptureHidden = "1";
    el.dataset.aicOriginalVisibility = el.style.getPropertyValue("visibility") || "";
    el.dataset.aicOriginalVisibilityPriority = el.style.getPropertyPriority("visibility") || "";
    el.style.setProperty("visibility", "hidden", "important");
  }
}

function restorePage() {
  const root = document.documentElement;
  const body = document.body;

  document.querySelectorAll('[data-aic-capture-hidden="1"]').forEach((el) => {
    const value = el.dataset.aicOriginalVisibility || "";
    const priority = el.dataset.aicOriginalVisibilityPriority || "";

    if (value) {
      el.style.setProperty("visibility", value, priority);
    } else {
      el.style.removeProperty("visibility");
    }

    delete el.dataset.aicCaptureHidden;
    delete el.dataset.aicOriginalVisibility;
    delete el.dataset.aicOriginalVisibilityPriority;
  });

  root.style.scrollBehavior = root.dataset.aicOriginalScrollBehavior || "";
  if (body) body.style.scrollBehavior = body.dataset.aicOriginalScrollBehavior || "";

  const x = Number(root.dataset.aicOriginalScrollX || 0);
  const y = Number(root.dataset.aicOriginalScrollY || 0);
  window.scrollTo(x, y);

  delete root.dataset.aicOriginalScrollBehavior;
  delete root.dataset.aicOriginalScrollX;
  delete root.dataset.aicOriginalScrollY;
  if (body) delete body.dataset.aicOriginalScrollBehavior;
}
