// Runs in the focused capture tab only. Page styles are normalized for one CDP capture.
(() => {
  globalThis.__aicClipboard?.restore?.();
  let clipboardChunks = [];
  let saved = new Map();
  let animationStyle = null;

  function saveAndSet(element, property, value) {
    if (!saved.has(element)) saved.set(element, new Map());
    const properties = saved.get(element);
    if (!properties.has(property)) {
      properties.set(property, [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
    }
    element.style.setProperty(property, value, "important");
  }

  function normalize(root = document) {
    for (const element of root.querySelectorAll("*")) {
      const position = getComputedStyle(element).position;
      if (position === "fixed") {
        // Hiding fixed overlays avoids CDP repeating them for each rendered viewport.
        // Absolute positioning would reflow the page and can create a different capture.
        saveAndSet(element, "opacity", "0");
      } else if (position === "sticky") {
        saveAndSet(element, "position", "relative");
        for (const edge of ["top", "right", "bottom", "left"]) saveAndSet(element, edge, "auto");
      }
      if (element.shadowRoot) normalize(element.shadowRoot);
    }
  }

  async function prepare() {
    restore();
    animationStyle = document.createElement("style");
    animationStyle.textContent = "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }";
    document.documentElement.append(animationStyle);
    normalize();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function restore() {
    for (const [element, properties] of saved) {
      for (const [property, [value, priority]] of properties) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    }
    saved.clear();
    animationStyle?.remove();
    animationStyle = null;
  }

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
  globalThis.__aicClipboard = { prepare, restore, clipboardBegin, clipboardChunk, clipboardFinish, clipboardDiscard };
})();
