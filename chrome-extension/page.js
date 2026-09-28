// Runs in the focused capture tab only to write the CDP PNG to the clipboard.
(() => {
  let clipboardChunks = [];
  function clipboardBegin() { clipboardChunks = []; }
  function clipboardChunk(base64) {
    const binary = atob(base64);
    clipboardChunks.push(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  }
  async function clipboardFinish() {
    if (!document.hasFocus()) throw new Error("Keep the captured page focused until the PNG is copied.");
    const blob = new Blob(clipboardChunks, { type: "image/png" });
    clipboardChunks = [];
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("PNG clipboard API is unavailable in this Chrome version.");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }
  function clipboardDiscard() { clipboardChunks = []; }
  globalThis.__aicClipboard = { clipboardBegin, clipboardChunk, clipboardFinish, clipboardDiscard };
})();
