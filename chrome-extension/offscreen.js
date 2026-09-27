const canvas = document.getElementById("capture");
const ctx = canvas.getContext("2d", { alpha: false });
let state = null;
let clipboard = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen" || sender.id !== chrome.runtime.id) return;
  handleMessage(message, sender).then((result) => sendResponse({ ok: true, ...result })).catch((error) => {
    if (message.type !== "CLIPBOARD_CHUNK") resetCapture();
    sendResponse({ ok: false, error: error?.message || String(error) });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "RESET_CAPTURE": return resetCapture();
    case "INIT_CAPTURE": return initCapture(message);
    case "ADD_CAPTURE": return addCapture(message);
    case "FINISH_CAPTURE": return finishCapture(message);
    case "CLIPBOARD_CHUNK": return clipboardChunk(message, sender);
    default: throw new Error(`Unknown capture operation: ${message.type}`);
  }
}
function resetCapture() {
  state = null;
  clipboard = null;
  canvas.width = canvas.height = 1;
  return {};
}
async function initCapture(message) {
  resetCapture();
  const image = await loadImage(message.dataUrl);
  // Use actual capture pixels: DPR alone is insufficient at fractional zoom.
  const size = CaptureGeometry.outputSize(
    image.naturalWidth * message.contentWidth / message.viewportWidth,
    Math.ceil(message.totalHeight * image.naturalHeight / message.screenshotHeight)
  );
  canvas.width = size.width;
  canvas.height = size.height;
  if (!ctx || ctx.isContextLost()) throw new Error("Canvas allocation failed. Try a smaller page or lower zoom.");
  state = {
    ...size, totalHeight: message.totalHeight, viewportHeight: message.viewportHeight,
    screenshotHeight: message.screenshotHeight, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight,
    cropWidth: image.naturalWidth * message.contentWidth / message.viewportWidth,
    coveredCssY: 0
  };
  drawCapture(image, message.scrollY);
  return size;
}
async function addCapture(message) {
  if (!state) throw new Error("Capture session has not been initialized.");
  const image = await loadImage(message.dataUrl);
  if (image.naturalWidth !== state.sourceWidth || image.naturalHeight !== state.sourceHeight) {
    throw new Error("Screenshot size changed. Keep the window size and display unchanged.");
  }
  drawCapture(image, message.scrollY);
  return {};
}
function drawCapture(image, scrollY) {
  const rect = CaptureGeometry.tileRect(state, scrollY, state.viewportHeight, image.naturalHeight * state.viewportHeight / state.screenshotHeight, canvas.height);
  if (rect.dh > 0) ctx.drawImage(image, 0, rect.sy, state.cropWidth, rect.sh, 0, rect.dy, canvas.width, rect.dh);
  state.coveredCssY = rect.bottom;
}
async function finishCapture(message) {
  if (!state || state.coveredCssY < state.totalHeight) throw new Error("Capture is incomplete; clipboard was not changed.");
  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Failed to encode PNG. Try a smaller page.")), "image/png");
    });
    const result = { width: canvas.width, height: canvas.height, bytes: blob.size, downscaled: state.downscaled };
    // Offscreen documents cannot acquire focus for the Async Clipboard API.
    // Hold the PNG while the focused capture page pulls bounded chunks.
    clipboard = { blob, token: message.token, tabId: message.tabId };
    return result;
  } finally {
    state = null;
    canvas.width = canvas.height = 1;
  }
}
async function clipboardChunk(message, sender) {
  if (!clipboard || message.token !== clipboard.token || sender.id !== chrome.runtime.id) {
    throw new Error("Invalid clipboard session.");
  }
  const offset = message.offset;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= clipboard.blob.size) throw new Error("Invalid PNG offset.");
  const bytes = new Uint8Array(await clipboard.blob.slice(offset, offset + 262144).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { data: btoa(binary), next: offset + bytes.length, total: clipboard.blob.size };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode screenshot."));
    image.src = dataUrl;
  });
}
