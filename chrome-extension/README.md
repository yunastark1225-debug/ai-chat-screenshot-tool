# Chrome Full Page Capture

Press **Alt + Shift + P** (Mac: **Option + Shift + P**) once to capture the
current page as one PNG and copy it to the clipboard. The toolbar button does
the same thing. It never opens a result tab, preview, or download; it never
changes tabs, pastes, or sends a message.

The existing `macos/` and `windows/` D1/D2 monitor screenshot workflows are
independent and unchanged.

## How capture works

The extension temporarily attaches Chrome DevTools Protocol (CDP) to the active
tab and asks Chrome for exactly one `Page.captureScreenshot` PNG with
`fromSurface` and `captureBeyondViewport`. It deliberately does not provide a
`clip`, matching DevTools' full-size screenshot behavior. The returned PNG IHDR
supplies the displayed dimensions, and the PNG is written as an `image/png`
`ClipboardItem` in the focused page.

No page scrolling, tile capture, stitching, lazy-load scrolling, scroll
restoration, or layout-shift tile checks are used. Immediately before CDP
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
- Chrome imposes image-size and memory limits. Very long pages may fail in
  `Page.captureScreenshot` rather than silently producing a truncated image.
- Fixed overlays are omitted and sticky elements are returned to normal flow for
  the one screenshot, preventing Chrome's full-page renderer from repeating
  them. The live page is restored immediately afterwards.

## Automated tests

Run with Node 18 or later:

```sh
node --test chrome-extension/tests/*.test.cjs
```

The tests cover short and long pages, DPR/zoom metrics, chunked PNG clipboard
copy, debugger attach and screenshot failures, tab changes, duplicate shortcut
presses, and debugger detachment.

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
