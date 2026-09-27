# Chrome Full Page Capture

Press **Alt + Shift + P** (Mac: **Option + Shift + P**) once to copy the current
page as a single PNG. The toolbar button does the same thing. No result tab,
preview, download, or automatic paste. The existing `macos/` and `windows/`
monitor screenshot tools are independent and unchanged.

## Commands

- **Option + Shift + P** — capture the page and copy the PNG. This is the
  standalone extension command and toolbar-button behavior.
- **Option + Shift + Y** — macOS Full Page workflow. After a successful PNG
  clipboard write, it restores the separately saved AI-chat tab and marked input,
  then asks the installed native host to paste once. It never submits the input.
- **Option + Shift + T** — save the currently focused textarea, text input, or
  contenteditable AI-chat composer as the Full Page paste target. This does not
  capture or paste anything.

## Install / Stream Deck

1. Use `feature/full-page-capture`, open `chrome://extensions/`, enable **Developer
   mode**, choose **Load unpacked**, and select this `chrome-extension` directory.
   After pulling updates, click the extension's reload button.
2. In `chrome://extensions/shortcuts`, assign **Capture full page to clipboard**
   to **Alt + Shift + P** (Option on Mac). Chrome **116+** is required.
3. For the one-button macOS Stream Deck action, follow
   [`macos/README.md`](../macos/README.md#full-page-one-stream-deck-button).
   It installs a Native Messaging host and runs the `FullPage_Shot` Shortcut;
   do not use a Hotkey action for that workflow.
4. `…` = working, `T` = paste target saved, `✓` = PNG copied (and, for
   Option+Shift+Y, target focus plus native paste were acknowledged), `!` =
   failed. A `!` state never requests automatic paste.

## Capture behavior

- Captures the leftmost current viewport width and full document height. Original
  horizontal and vertical scroll positions are restored, including on failure.
- Pre-scrolls to warm lazy images, waits a bounded time for visible images/fonts
  and stable geometry, then captures at most twice per second. A late layout
  change retries the capture once. Persistent changes fail instead of reporting
  an incomplete PNG as success.
- Sticky elements stay in normal document flow and appear at their original
  positions. **Fixed overlays are omitted entirely**, including fixed headers,
  footers and floating chat buttons, so they cannot cover the page content.
  Styles and CSS priorities are restored afterwards; open shadow roots are
  included in floating-element handling.
- Actual screenshot dimensions determine the pixel scale (Retina and zoom).
  Overlapping final tiles are cropped and shared pixel edges are rounded
  consistently. Scrollbar gutters are excluded from the output.
- Large output is proportionally downscaled to at most **16,384 px per side** and
  **32 million pixels**. This is a practical memory budget, not a guarantee of
  allocation on every GPU/device. PNG encoding/clipboard failures are reported.
- An offscreen document stitches the PNG. Chrome does not allow an offscreen
  document to write image data to the system clipboard because it cannot receive
  focus, so bounded PNG chunks are passed back to the already focused extension
  script in the current tab. That script writes a real `image/png` ClipboardItem;
  no image is uploaded and there is no HTML-only `execCommand('copy')` fallback.
- Concurrent shortcut presses are ignored. Switching tabs/windows or navigating
  during capture cancels it. Recovery addresses the original document ID; it
  never scrolls a newly active tab. A page watchdog restores styles if the worker
  disappears. The badge persists until the next invocation.

## Limits

- Keep the tab in the foreground and do not scroll, resize, change zoom, or move
  the window between displays until `✓`. Clipboard focus is also required during
  the final write.
- Chrome internal pages, Chrome Web Store and other injection-restricted pages
  cannot be captured. `file://` needs **Allow access to file URLs** in extension
  details. No broad host permissions are requested.
- Infinite scroll, virtualized lists, independently scrolling panels/iframes,
  closed shadow roots, video, canvas animations, and layout changes without
  observable geometry/layout shifts cannot be guaranteed. This captures the top
  document, not a snapshot of arbitrary application state. Horizontal overflow
  outside the viewport is not captured. Very slow lazy images may remain unloaded.
- Limit: **200 viewports per pass / 4 minutes overall**. Oversized/endlessly
  growing pages fail; they are not silently truncated. Clipboard transfer has a
  separate 30-second timeout. Downscaling very long pages reduces text legibility.
- Automatic paste is currently the macOS Native Messaging workflow. Windows
  retains its existing D1/D2 workflow; the standalone Option+Shift+P command
  remains copy-only on every platform.
- The saved target is intentionally exact: it requires the same Chrome tab,
  window, URL, and marked input element. After Chrome restart, target navigation,
  or a chat UI replacing its composer, press Option+Shift+T in the desired input
  again. The extension copies the PNG but refuses to paste anywhere else.

## Automated tests

No dependencies are needed for the geometry and worker regression tests (Node 18+):

```sh
node --test chrome-extension/tests/*.test.cjs
```

They cover DPR 1/1.25/1.5/2/3, exact/partial last viewports, downscaling, output
bounds, missing/repeated tiles, capture throttling, double invocation, tab
switching, failure cleanup and a late height-change retry. Worker tests mock
Chrome APIs; the checklist below is still required for OS integration.

## Mac real-device checklist (also run on Windows)

Serve the included fixture from the repository root:

```sh
python3 -m http.server 8765 --directory chrome-extension/tests
```

1. Open `http://localhost:8765/fixture.html`, scroll to the middle, then press
   **Option + Shift + P** once. Repeat using the toolbar button. For the
   macOS Stream Deck paste flow, use the dedicated `FullPage_Shot` Shortcut.
2. Wait for `✓`. Confirm the original scroll position, sticky behavior and magenta
   fixed overlay return. No tabs, preview windows, or downloaded files should appear.
3. Paste into Preview with **File → New from Clipboard** and into the intended
   AI chat input (do not submit). Confirm the TOP header appears once, sections
   1–7 and the navy lazy image appear, and the entire red BOTTOM footer is present.
   The magenta fixed overlay should not be in the PNG.
4. Repeat at Chrome zoom **80%, 100%, 125%** on the Retina display, then on an
   external display. Check sharpness, width, tile boundaries and the final row.
5. Test a page shorter than one viewport, a page exactly two viewports tall, and
   a longer finite page. Test horizontal overflow with its scrollbar visible.
   For downscaling, in fixture DevTools run
   `document.querySelector('footer').style.height = '30000px'`, close DevTools,
   and capture. Confirm the hover title reports downscaling and the bottom exists.
6. Press the shortcut rapidly twice: expect one capture. During another run switch
   tabs: expect `!`, restored original page, and no clipboard overwrite. Retry
   without switching. Also test navigation and window resize during capture.
7. Test a real page with lazy images and sticky navigation. Continuously changing
   or infinite pages should fail with an explanatory hover title, without leaving
   hidden elements or opening fallback UI.
8. Run the existing D1/D2 monitor capture once to verify the independent workflow.

References: [captureVisibleTab rate limit](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND),
[offscreen document restrictions](https://developer.chrome.com/docs/extensions/reference/api/offscreen),
[Async Clipboard focus requirement](https://developer.chrome.com/docs/web-platform/unsanitized-html-async-clipboard).
