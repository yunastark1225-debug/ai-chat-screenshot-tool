# Chrome Full Page Capture

Press **Alt + Shift + P** (Mac: **Option + Shift + P**) once to capture the
current page as one PNG and copy it to the clipboard. The toolbar button does
the same thing. It never opens a result tab, preview, or download; it never
changes tabs, finds an AI chat, pastes, or sends a message.

The existing `macos/` and `windows/` D1/D2 monitor screenshot workflows are
independent and unchanged.

## Install and Stream Deck

1. On `feature/full-page-capture`, open `chrome://extensions`, enable
   **Developer mode**, choose **Load unpacked**, and select this
   `chrome-extension` directory. Reload the extension after pulling updates.
2. In `chrome://extensions/shortcuts`, assign **Capture full page to clipboard**
   to **Alt + Shift + P** (Option on Mac). Chrome **116+** is required.
3. In Stream Deck, add one **Hotkey** action that sends **Option + Shift + P**.
   It must target the Chrome extension command, not macOS Screenshot.
4. Bring the page to capture to the foreground, press Full Page once, and wait
   for the badge. `…` means working, `✓` means the PNG is in the clipboard, and
   `!` means the capture failed without replacing the clipboard. After `✓`, move
   to any AI chat yourself and press **Cmd+V** (or **Ctrl+V** on Windows).

## Capture behavior

- Captures the leftmost current viewport width and full document height. Original
  horizontal and vertical scroll positions are restored, including on failure.
- Pre-scrolls to warm lazy images, waits for visible images/fonts and stable
  geometry, then captures at most twice per second. A late layout change retries
  once; persistent changes fail instead of producing a truncated PNG.
- Sticky elements stay in normal document flow. Fixed overlays, including fixed
  headers, footers, and floating chat buttons, are omitted so they cannot repeat
  or cover content. Styles and CSS priorities are restored afterwards.
- Actual screenshot dimensions determine pixel scale for Retina displays and
  zoom. Adjacent tiles overlap by 4 CSS pixels; actual measured scroll positions
  crop that overlap, and shared edges are rounded consistently. Scrollbar
  gutters are excluded from output.
- Large output is proportionally downscaled to at most **16,384 px per side**
  and **32 million pixels**. PNG encoding and clipboard failures are reported.
- An offscreen document stitches the PNG. It returns bounded PNG chunks to the
  focused capture page, which writes a real `image/png` `ClipboardItem`; no
  image is uploaded and there is no HTML-only copy fallback.
- Concurrent shortcut presses are ignored. Switching tabs/windows, navigating,
  or resizing during capture cancels it. Recovery addresses the original
  document only and never scrolls a newly active tab.

## Limits

- Keep the source tab in the foreground and do not scroll, resize, change zoom,
  or move the window between displays until `✓`. Clipboard focus is required at
  the final write.
- Chrome internal pages, Chrome Web Store, and other injection-restricted pages
  cannot be captured. `file://` requires **Allow access to file URLs** in
  extension details. No broad host permissions are requested.
- Infinite scroll, virtualized lists, independently scrolling panels/iframes,
  closed shadow roots, video, canvas animations, and continually changing pages
  cannot be guaranteed. Horizontal overflow outside the viewport is excluded.
  Very slow lazy images may remain unloaded.
- Limit: **200 viewports per pass / 4 minutes overall**. Oversized or endlessly
  growing pages fail rather than silently truncate. Downscaling very long pages
  reduces text legibility.

## Automated tests

Run the regression tests with Node 18 or later:

```sh
node --test chrome-extension/tests/*.test.cjs
```

They cover DPR 1/1.25/1.5/2/3, exact and partial final viewports, downscaling,
tile bounds, capture throttling, double invocation, tab switching, resize and
clipboard failures, cleanup, and a late height-change retry.

## macOS real-device checklist

Serve the fixture from the repository root:

```sh
python3 -m http.server 8765 --directory chrome-extension/tests
```

1. Open `http://localhost:8765/fixture.html`, scroll to the middle, press
   **Option + Shift + P** once, and wait for `✓`.
2. Confirm the original scroll position returns. Paste manually into Preview
   (**File → New from Clipboard**) and an AI chat input without submitting.
   Confirm the TOP header appears once, sections 1–7 and the navy lazy image
   appear, the red BOTTOM footer is present, and the magenta fixed overlay is
   absent.
3. Repeat at Chrome zoom **80%, 100%, 125%** on a Retina display and an external
   display. Check sharpness, width, tile boundaries, and the final row.
4. Test a short page, an exactly two-viewport page, and a long finite page. Test
   a real page with lazy images and sticky navigation.
5. Press the shortcut rapidly twice: expect one capture. During another capture,
   switch tabs, navigate, or resize Chrome: expect `!`, restored source scroll,
   and no clipboard overwrite.
6. Run D1 and D2 once to confirm their independent capture-and-paste workflow is
   unchanged.
