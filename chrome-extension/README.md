# Chrome Full Page Capture

Press **Alt + Shift + P** (Mac: **Option + Shift + P**) once to capture the
current page as one PNG and copy it to the clipboard. The toolbar button does
the same thing. It never opens a result tab, preview, or download; it never
changes tabs, pastes, or sends a message.

The existing `macos/` and `windows/` D1/D2 monitor screenshot workflows are
independent and unchanged.

## How capture works

The extension temporarily attaches Chrome DevTools Protocol (CDP) to the active
tab, reads `Page.getLayoutMetrics.cssContentSize`, and divides that CSS document
into non-overlapping bands. Each band is at most `window.innerHeight - 2` CSS
pixels high and is captured with `Page.captureScreenshot` using an absolute
document-coordinate `clip`, `fromSurface`, and `captureBeyondViewport`.

The page never scrolls. Each PNG IHDR is checked against its requested band;
repeated consecutive PNG data and unexpected band dimensions fail the capture.
The service worker uses `OffscreenCanvas` to stitch the measured PNG bands,
downscaling only when the final canvas would exceed 16,384 pixels on a side or
32 million pixels. The finished PNG is written as an `image/png` `ClipboardItem`
in the focused page.

No page scrolling, `captureVisibleTab`, lazy-load scrolling, scroll restoration,
or layout-shift tile checks are used. Immediately before CDP
capture, sticky elements are temporarily returned to normal flow and fixed
elements are hidden with `opacity: 0`; animations and transitions are paused.
Their inline values and priorities are restored before the debugger detaches,
on both success and failure.

## Install and Stream Deck

1. On `feature/full-page-capture`, open `chrome://extensions`, enable
   **Developer mode**, choose **Load unpacked**, and select this
   `chrome-extension` directory. Reload the extension after pulling updates.
2. Approve Chrome's debugger-access prompt when it appears. Chrome **116+** is
   required.
3. In `chrome://extensions/shortcuts`, assign **Capture full page to clipboard**
   to **Alt + Shift + P** (Option on Mac).
4. In Stream Deck, add one **Hotkey** action that sends **Option + Shift + P**.
5. Bring the page to capture to the foreground, press Full Page once, and wait
   for the badge. `…` means working, `✓` means the PNG is in the clipboard, and
   `!` means capture failed without replacing the clipboard. After `✓`, move to
   any AI chat yourself and press **Cmd+V** (or **Ctrl+V** on Windows).

## Limits

- Keep the source tab focused until `✓`, because the final Clipboard API write
  requires page focus. Switching tabs before that point cancels clipboard copy.
- Chrome internal pages, Chrome Web Store, and other debugging-restricted pages
  cannot be captured. `file://` requires **Allow access to file URLs** in
  extension details.
- Chrome imposes image-size and memory limits. Very long pages may fail if they
  exceed 400 bands; otherwise the final PNG is proportionally downscaled when
  needed rather than silently truncated.
- Fixed overlays are omitted and sticky elements are returned to normal flow for
  the one screenshot, preventing Chrome's full-page renderer from repeating
  them. The live page is restored immediately afterwards.

## Automated tests

Run with Node 18 or later:

```sh
node --test chrome-extension/tests/*.test.cjs
```

The tests cover short and long pages, DPR 1/1.25/1.5/2/3, band coordinate
continuity, repeated-band and invalid-dimension guards, chunked PNG clipboard
copy, debugger failures, tab changes, duplicate shortcut presses, and detach.

## macOS real-device checklist

1. Load the extension and approve debugger access. Open a short page and a long
   article, then run **Option + Shift + P**. Confirm `✓` and manually paste the
   PNG into Preview (**File → New from Clipboard**).
2. Repeat at Chrome zoom **80%, 100%, 125%** on a Retina display. Confirm the
   image covers the entire page and remains sharp enough for the chosen zoom.
3. Test a page with fixed and sticky elements. Confirm no repeated viewport
   content appears in the PNG, fixed overlays are absent, and the live page's
   original styles return after capture.
4. Test a very long page. A Chrome screenshot-size failure must show `!`; it
   must not leave the debugger attached or overwrite the clipboard.
5. Trigger a capture while another debugger is attached, then test tab switching
   during capture. Each must show `!` and leave the page unchanged.
6. Run D1 and D2 once to confirm their independent capture-and-paste workflow is
   unchanged.
