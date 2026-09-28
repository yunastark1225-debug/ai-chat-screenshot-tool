const CDP_VERSION = "1.3";
const BAND_SAFETY_MARGIN_CSS_PX = 2;
const BAND_GUARD_CSS_PX = 32;
const MAX_BANDS = 400;
const MAX_DURATION_MS = 240_000;
const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 32_000_000;
const BLOB_CHUNK_BYTES = 256 * 1024;
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
          if (!globalThis.__aicClipboard) throw new Error("Capture page session was lost.");
          return { ok: true, value: await globalThis.__aicClipboard[operation](value) };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
      args: [operation, value]
    });
    if (!response?.result?.ok) throw new Error(response?.result?.error || "Page capture step failed.");
    return response.result.value;
  };
  try {
    await setBadge("…", "Capturing full page in Chrome DevTools bands…");
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null || !/^(https?:|file:)/.test(tab.url || "")) {
      throw new Error("This page cannot be captured. Open a normal web page.");
    }
    await checkActive();
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page.js"] });
    documentId = injection.documentId;
    normalized = true;
    await page("prepare");

    let result;
    try {
      await chrome.debugger.attach({ tabId: tab.id }, CDP_VERSION);
      attached = true;
      const metrics = await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.getLayoutMetrics");
      const content = metrics.cssContentSize;
      const viewport = await page("viewport");
      result = await captureBands(tab.id, content, viewport, checkActive);
    } finally {
      try {
        if (normalized) {
          await page("restore");
          normalized = false;
        }
      } finally {
        if (attached) await chrome.debugger.detach({ tabId: tab.id });
        attached = false;
      }
    }

    await checkActive();
    await copyBlobInPage(result.blob, page, checkActive);
    await setBadge("✓", `Copied ${result.width} × ${result.height} PNG to clipboard${result.downscaled ? " (large page downscaled)" : ""}`);
  } catch (error) {
    console.error("Full-page capture failed:", error);
    await setBadge("!", error?.message || "Capture failed");
  } finally {
    if (normalized) await page("restore").catch(() => {});
    if (attached && tab?.id != null) await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    running = false;
  }
}

async function captureBands(tabId, content, viewport, checkActive) {
  if (!content || ![content.width, content.height, viewport?.width, viewport?.height].every(Number.isFinite) ||
      content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("Chrome did not return valid page dimensions.");
  }
  const maxCaptureHeight = Math.max(1, Math.floor(viewport.height) - BAND_SAFETY_MARGIN_CSS_PX);
  const normalCoreHeight = maxCaptureHeight - BAND_GUARD_CSS_PX * 2;
  if (normalCoreHeight <= 0) throw new Error("Viewport is too short for guarded full-page capture.");
  const bands = [];
  for (let y = 0; y < content.height;) {
    const guardTop = y === 0 ? 0 : BAND_GUARD_CSS_PX;
    const remaining = content.height - y;
    // The final band needs no bottom guard, so it can use all remaining viewport space.
    const coreCapacity = remaining <= maxCaptureHeight - guardTop
      ? maxCaptureHeight - guardTop
      : normalCoreHeight;
    const height = Math.min(coreCapacity, remaining);
    const guardBottom = height === remaining ? 0 : BAND_GUARD_CSS_PX;
    const captureY = y - guardTop;
    const captureHeight = guardTop + height + guardBottom;
    if (captureHeight > viewport.height || captureHeight > maxCaptureHeight) {
      throw new Error("Guarded band exceeds the viewport capture limit.");
    }
    bands.push({ y, height, captureY, captureHeight, guardTop, guardBottom });
    y += height;
  }
  if (bands.length > MAX_BANDS) throw new Error("Page exceeds the 400-band capture limit.");

  let canvas;
  let context;
  let sourceScaleX;
  let sourceScaleY;
  let previousData;
  let output;
  for (const [index, band] of bands.entries()) {
    await checkActive();
    const screenshot = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: band.captureY, width: content.width, height: band.captureHeight, scale: 1 }
    });
    if (!screenshot?.data) throw new Error(`Chrome did not return PNG data for band ${index + 1}.`);
    if (screenshot.data === previousData) throw new Error(`Band ${index + 1} repeats the previous viewport; capture cancelled.`);
    previousData = screenshot.data;
    const dimensions = pngDimensions(screenshot.data);
    const dprWidth = Math.round(content.width * viewport.dpr);
    const dprHeight = Math.round(band.captureHeight * viewport.dpr);
    if (Math.abs(dimensions.width - dprWidth) > 2 || Math.abs(dimensions.height - dprHeight) > 2) {
      throw new Error(`Band ${index + 1} does not match its requested document region; capture cancelled.`);
    }
    if (!canvas) {
      sourceScaleX = dimensions.width / content.width;
      sourceScaleY = dimensions.height / band.captureHeight;
      if (!Number.isFinite(sourceScaleX) || !Number.isFinite(sourceScaleY) || sourceScaleX <= 0 || sourceScaleY <= 0) {
        throw new Error("Chrome returned invalid band pixel dimensions.");
      }
      output = outputSize(Math.round(content.width * sourceScaleX), Math.round(content.height * sourceScaleY));
      canvas = new OffscreenCanvas(output.width, output.height);
      context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas is unavailable for PNG stitching.");
    } else {
      const expectedWidth = Math.round(content.width * sourceScaleX);
      const expectedHeight = Math.round(band.captureHeight * sourceScaleY);
      if (Math.abs(dimensions.width - expectedWidth) > 2 || Math.abs(dimensions.height - expectedHeight) > 2) {
        throw new Error(`Band ${index + 1} has an unexpected PNG size; capture cancelled.`);
      }
    }
    const image = await createImageBitmap(base64ToBlob(screenshot.data));
    const sourceTop = Math.round((band.y - band.captureY) * dimensions.height / band.captureHeight);
    const sourceBottom = Math.round((band.y - band.captureY + band.height) * dimensions.height / band.captureHeight);
    const top = Math.round(band.y * output.height / content.height);
    const bottom = Math.round((band.y + band.height) * output.height / content.height);
    context.drawImage(image, 0, sourceTop, dimensions.width, sourceBottom - sourceTop, 0, top, output.width, bottom - top);
    image.close?.();
  }
  return { ...output, bands: bands.length, blob: await canvas.convertToBlob({ type: "image/png" }) };
}

function outputSize(width, height) {
  const scale = Math.min(1, MAX_DIMENSION / width, MAX_DIMENSION / height, Math.sqrt(MAX_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), downscaled: scale < 1 };
}

function pngDimensions(base64) {
  const bytes = Uint8Array.from(atob(base64.slice(0, 32)), (char) => char.charCodeAt(0));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value) ||
      String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") throw new Error("Chrome returned an invalid PNG.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) throw new Error("Chrome returned an invalid PNG size.");
  return { width, height };
}

function base64ToBlob(base64) {
  const binary = atob(base64);
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: "image/png" });
}

async function copyBlobInPage(blob, page, checkActive) {
  try {
    await checkActive();
    await page("clipboardBegin");
    for (let offset = 0; offset < blob.size; offset += BLOB_CHUNK_BYTES) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + BLOB_CHUNK_BYTES).arrayBuffer());
      await page("clipboardChunk", bytesToBase64(bytes));
    }
    await checkActive();
    await page("clipboardFinish");
  } finally {
    await page("clipboardDiscard").catch(() => {});
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

async function setBadge(text, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
}
