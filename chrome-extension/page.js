// Runs only in the top frame's isolated world. No page-owned data attributes.
(() => {
  globalThis.__aicCapture?.restore();
  const original = { x: scrollX, y: scrollY };
  const saved = new Map();
  let watchdog, restored = false, layoutVersion = 0;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const observer = new PerformanceObserver((list) => {
    if (list.getEntries().some((entry) => entry.value > 0)) layoutVersion++;
  });
  observer.observe({ type: "layout-shift", buffered: false });
  const style = document.createElement("style");
  style.textContent = "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }";
  document.documentElement.append(style);

  function set(el, property, value) {
    if (!saved.has(el)) saved.set(el, new Map());
    const properties = saved.get(el);
    if (!properties.has(property)) properties.set(property, [el.style.getPropertyValue(property), el.style.getPropertyPriority(property)]);
    el.style.setProperty(property, value, "important");
  }
  function normalize(root = document) {
    for (const el of root.querySelectorAll("*")) {
      const position = getComputedStyle(el).position;
      // Opacity hides the entire fixed subtree, even visibility:visible children.
      // Omit fixed overlays in ALL tiles so bottom overlays cannot cover content.
      if (position === "fixed") set(el, "opacity", "0");
      if (position === "sticky") {
        set(el, "position", "relative");
        for (const edge of ["top", "bottom", "left", "right"]) set(el, edge, "auto");
      }
      if (el.shadowRoot) normalize(el.shadowRoot);
    }
  }
  for (const el of [document.documentElement, document.body].filter(Boolean)) {
    set(el, "scroll-behavior", "auto");
    set(el, "scroll-snap-type", "none");
    set(el, "overflow-anchor", "none");
  }
  function touch() {
    clearTimeout(watchdog);
    // Restore even if the worker is terminated or the extension is reloaded.
    watchdog = setTimeout(restore, 15_000);
  }
  function metrics() {
    if (restored) throw new Error("Page capture timed out. Retry.");
    touch();
    const root = document.documentElement;
    return {
      totalHeight: Math.max(root.scrollHeight, document.body?.scrollHeight || 0, innerHeight),
      viewportWidth: innerWidth, viewportHeight: document.compatMode === "CSS1Compat" ? root.clientHeight : document.body.clientHeight,
      screenshotHeight: innerHeight,
      contentWidth: root.clientWidth, scrollX, scrollY, dpr: devicePixelRatio, layoutVersion
    };
  }
  async function scroll(y) {
    touch();
    normalize();
    window.scrollTo({ left: 0, top: y, behavior: "instant" });
    // Permit scroll handlers / IntersectionObserver to queue image loads.
    await delay(120);
    const images = [...document.images].filter((img) => {
      const rect = img.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight && !img.complete;
    });
    await Promise.race([
      Promise.allSettled(images.map((img) => img.decode())), delay(1500)
    ]);
    await Promise.race([document.fonts.ready, delay(1000)]);
    let previous = "", stable = 0;
    for (let i = 0; i < 10; i++) {
      normalize();
      await delay(80);
      const current = JSON.stringify(metrics());
      stable = current === previous ? stable + 1 : 0;
      if (stable >= 2) return metrics();
      previous = current;
    }
    throw new Error("Page does not settle after scrolling.");
  }
  function restore() {
    if (restored) return;
    restored = true;
    clearTimeout(watchdog);
    observer.disconnect();
    // Restore while instant scrolling and snap suppression are still in effect.
    window.scrollTo({ left: original.x, top: original.y, behavior: "instant" });
    for (const [el, properties] of saved) {
      for (const [property, [value, priority]] of properties) {
        if (value) el.style.setProperty(property, value, priority);
        else el.style.removeProperty(property);
      }
    }
    saved.clear();
    style.remove();
  }
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
  globalThis.__aicCapture = { scroll, metrics, restore, clipboardBegin, clipboardChunk, clipboardFinish, clipboardDiscard };
  touch();
})();
