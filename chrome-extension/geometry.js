// Pure geometry shared by the offscreen document and Node tests.
(function (root) {
  const MAX_DIMENSION = 16384;
  const MAX_PIXELS = 32_000_000;
  function outputSize(width, height) {
    if (![width, height].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Invalid capture dimensions.");
    const scale = Math.min(1, MAX_DIMENSION / width, MAX_DIMENSION / height, Math.sqrt(MAX_PIXELS / (width * height)));
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), downscaled: scale < 1 };
  }
  function tileRect(state, scrollY, viewportHeight, imageHeight, outputHeight) {
    const top = state.coveredCssY;
    const bottom = Math.min(state.totalHeight, scrollY + viewportHeight);
    if (scrollY < 0 || scrollY > top || bottom <= top) throw new Error("Capture tiles have a gap or do not advance.");
    const sy = (top - scrollY) * imageHeight / viewportHeight;
    const sh = (bottom - top) * imageHeight / viewportHeight;
    // Round shared edges, not independent heights, to prevent one-pixel seams.
    const dy = Math.round(top * outputHeight / state.totalHeight);
    const dh = Math.round(bottom * outputHeight / state.totalHeight) - dy;
    return { sy, sh, dy, dh, bottom };
  }
  root.CaptureGeometry = { outputSize, tileRect };
})(globalThis);
