# AI Chat Screenshot Tool - macOS

macOS uses Shortcuts and AppleScript for the existing display-capture workflows.
Full Page capture is a Chrome extension command and is intentionally copy-only.

## D1 / D2

`D1_Shot.applescript` and `D2_Shot.applescript` keep their existing behavior:
they capture a predefined display to the clipboard, activate Google Chrome, and
paste with Cmd+V without sending the chat message.

Create `D1_Shot` and `D2_Shot` macOS Shortcuts, each with a **Run AppleScript**
action containing the matching file. Assign those Shortcuts to their existing
Stream Deck buttons.

Screen Recording and Accessibility permission may be required for Shortcuts
and/or Stream Deck. The adjustable `SKIP_CLICK`, `CLICK_X_RATIO`, and
`CLICK_FROM_BOTTOM_PX` values remain documented in the two AppleScript files.

## Full Page

Full Page uses Chrome DevTools Protocol to capture the active Chrome tab as one
PNG without scrolling, then copies it to the clipboard. It does not change tabs,
look for an AI chat, paste, or send a message.

### Setup

1. Load or reload `chrome-extension` in `chrome://extensions`.
2. In `chrome://extensions/shortcuts`, assign **Capture full page to clipboard**
   to **Option + Shift + P**.
3. Approve Chrome's debugger-access prompt when it appears.
4. In Stream Deck, create a **Hotkey** action that sends **Option + Shift + P**.
   This invokes the Chrome extension command, not the macOS screenshot tool.

No native host, Python setup, Screen Recording permission, or Accessibility
permission is needed for Full Page itself.

### Daily use

1. Bring the Chrome page to capture to the foreground.
2. Press the Stream Deck **Full Page** button once.
3. Keep the tab, window size, and zoom unchanged until the extension badge is
   `✓`.
4. Move to any AI chat manually and press **Cmd+V** to paste the PNG. The tool
   never submits the message.

`…` means capture in progress. `✓` means a PNG is in the clipboard. `!` means
capture failed and the clipboard was not replaced.

## Full Page test checklist

1. Test short and long pages, then paste the result manually into an
   image-capable app. Confirm no new tab, preview, download, or automatic paste
   appears.
2. Test fixed/sticky content and a Retina display. Confirm fixed overlays are
   absent from the PNG, sticky content is not repeated, and page styles restore.
3. Confirm the source page never scrolls during capture.
4. During capture, switch tabs. It must show `!` and not change the clipboard.
5. Press Full Page twice rapidly. There should be one capture.
6. Run D1 and D2 once to confirm their capture-and-paste behavior is unchanged.

See `chrome-extension/README.md` for capture limits and extension-specific
testing detail.
