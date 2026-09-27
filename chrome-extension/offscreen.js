const canvas = document.getElementById("capture");
const ctx = canvas.getContext("2d", { alpha: false });

const MAX_CANVAS_DIMENSION = 30000;
const MAX_CANVAS_PIXELS = 120_000_000;

let state = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;

  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error("Offscreen capture error:", error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "INIT_CAPTURE":
      return initCapture(message);
    case "ADD_CAPTURE":
      return addCapture(message);
    case "FINISH_CAPTURE":
      return finishCapture();
    default:
      throw new Error(`Unknown offscreen message: ${message.type}`);
  }
}

async function initCapture(message) {
  const image = await loadImage(message.dataUrl);
  const sourceScaleX = image.naturalWidth / message.viewportWidth;
  const sourceScaleY = image.naturalHeight / message.viewportHeight;

  const naturalWidth = image.naturalWidth;
  const naturalHeight = Math.ceil(message.totalHeight * sourceScaleY);

  const dimensionScale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / Math.max(naturalWidth, naturalHeight)
  );
  const pixelScale = Math.min(
    1,
    Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, naturalWidth * naturalHeight))
  );
  const outputScale = Math.min(dimensionScale, pixelScale);

  canvas.width = Math.max(1, Math.floor(naturalWidth * outputScale));
  canvas.height = Math.max(1, Math.floor(naturalHeight * outputScale));

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  state = {
    totalHeight: message.totalHeight,
    viewportHeight: message.viewportHeight,
    sourceScaleX,
    sourceScaleY,
    outputScale,
    coveredCssY: 0
  };

  drawCapture(image, message.scrollY, message.viewportHeight);
  return { width: canvas.width, height: canvas.height };
}

async function addCapture(message) {
  if (!state) throw new Error("Capture session has not been initialized.");
  const image = await loadImage(message.dataUrl);
  drawCapture(image, message.scrollY, message.viewportHeight);
  return {};
}

function drawCapture(image, scrollY, viewportHeight) {
  const topCss = Math.max(0, scrollY);
  const bottomCss = Math.min(state.totalHeight, scrollY + viewportHeight);
  const skipCss = Math.max(0, state.coveredCssY - topCss);
  const drawTopCss = topCss + skipCss;
  const drawHeightCss = Math.max(0, bottomCss - drawTopCss);

  if (drawHeightCss <= 0) return;

  const sx = 0;
  const sy = Math.round(skipCss * state.sourceScaleY);
  const sw = image.naturalWidth;
  const sh = Math.min(
    image.naturalHeight - sy,
    Math.round(drawHeightCss * state.sourceScaleY)
  );

  const dx = 0;
  const dy = Math.round(drawTopCss * state.sourceScaleY * state.outputScale);
  const dw = canvas.width;
  const dh = Math.round(sh * state.outputScale);

  ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  state.coveredCssY = Math.max(state.coveredCssY, bottomCss);
}

async function finishCapture() {
  if (!state) throw new Error("Capture session has not been initialized.");

  const blob = await canvasToBlob(canvas, "image/png");
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob })
  ]);

  const result = {
    width: canvas.width,
    height: canvas.height,
    bytes: blob.size
  };

  state = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 1;
  canvas.height = 1;

  return result;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode captured screenshot."));
    image.src = dataUrl;
  });
}

function canvasToBlob(targetCanvas, type) {
  return new Promise((resolve, reject) => {
    targetCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode the stitched screenshot."));
    }, type);
  });
}
