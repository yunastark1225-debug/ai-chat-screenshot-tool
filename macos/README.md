# AI Chat Screenshot Tool - macOS

macOS implementation using Shortcuts + AppleScript.

## What it does

1. Captures a predefined display directly to the clipboard.
2. Activates Google Chrome.
3. Optionally clicks near the chat input area.
4. Pastes the screenshot with Cmd+V.

No screenshot image is saved to disk.

## Files

- `D1_Shot.applescript` — Display 1
- `D2_Shot.applescript` — Display 2
- `FullPage_Shot.applescript` — starts the dedicated Chrome full-page command
- `full_page_native_host.py` — receives a success notification from Chrome and
  pastes the finished PNG into the focused input
- `install_full_page_native_host.sh` — registers that host with Chrome

## Full Page: one Stream Deck button

The Full Page action is separate from D1/D2. It captures the current Chrome tab,
waits for the extension to copy a PNG, then pastes into the already focused AI
chat input. It never sends the message.

The completion path is:

```text
Stream Deck → FullPage_Shot Shortcut → Option+Shift+Y → Chrome extension
→ PNG clipboard write succeeds → Native Messaging acknowledgement → Cmd+V
```

The native host receives no image bytes. Chrome asks it to paste only after
`ClipboardItem(image/png)` succeeds. A failed, cancelled, resized, navigated or
timed-out capture never calls the host, so it cannot paste a stale image.

### First-time setup

1. Pull `feature/full-page-capture`, then load or reload `chrome-extension` in
   `chrome://extensions`. Its fixed unpacked ID must be
   `cmbkponfljoapkccbemoajlpljbmmgnl`; reload the extension if it differs.
2. In Terminal, from the repository root, run:

   ```sh
   ./macos/install_full_page_native_host.sh
   ```

   This writes Chrome's native-host manifest to
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. It uses
   the absolute path of this checkout, so rerun it after moving the repository.
   Python 3 is required. The host is limited to this extension ID.
3. Open `chrome://extensions/shortcuts` and assign **Capture full page and paste
   the PNG into the focused Chrome input** to **Option + Shift + Y**. Confirm it
   is not reported as conflicting. Do not replace the existing
   **Capture full page to clipboard** command on Option + Shift + P.
4. Create a macOS Shortcut named `FullPage_Shot`, add **Run AppleScript**, and
   paste the contents of `FullPage_Shot.applescript`.
5. In Stream Deck, create a button named **Full Page** using the **Shortcuts**
   action and select `FullPage_Shot`. Do not use a Hotkey action for this button.
6. Grant Accessibility permission to the app that runs the action (typically
   Shortcuts or Stream Deck) and to Google Chrome when macOS requests it. No
   Screen Recording permission is needed for Full Page; D1/D2 retain their
   existing Screen Recording requirement.

### Daily use

1. Keep the intended AI chat input focused in the frontmost Chrome window.
2. Press Stream Deck **Full Page** once.
3. Keep Chrome's window/tab, size and zoom unchanged until the extension badge
   becomes `✓`. The PNG is pasted into that focused input and is not submitted.

`…` means capture in progress. `!` means failure; no automatic paste is sent.
If the badge says that the native host failed, the PNG may still be in the
clipboard, but the workflow intentionally does not send Cmd+V.

## Shortcuts setup

Create two macOS Shortcuts:
- `D1_Shot`
- `D2_Shot`

Each shortcut needs one AppleScript action containing the corresponding script.

These shortcuts can be assigned to Stream Deck buttons.

Do not change the D1/D2 buttons when adding Full Page. They remain independent
screen capture workflows and do not use Native Messaging.

## Permissions

Depending on the launch method, grant Screen Recording and Accessibility permissions to Shortcuts and/or Stream Deck.

For Full Page, Accessibility is needed for the launcher and Chrome's native host
to issue the final Cmd+V. macOS may identify the requester as Google Chrome or
`osascript`; approve the prompt that appears while testing. Full Page does not
need Screen Recording permission.

## Adjustable values

```applescript
set SKIP_CLICK to true
set CLICK_X_RATIO to 0.7
set CLICK_FROM_BOTTOM_PX to 120
```

- `SKIP_CLICK`: When `true` (default), skips clicking and pastes into the currently focused Chrome input. Set it to `false` to use the click position below.
- `CLICK_X_RATIO`: Horizontal click position within the Chrome window when `SKIP_CLICK` is `false`.
- `CLICK_FROM_BOTTOM_PX`: Vertical click offset from the bottom of the Chrome window when `SKIP_CLICK` is `false`.

## Full Page test checklist

Run these after installing the native host and creating the Stream Deck action.

1. Focus an AI-chat text input, then test a short page and a long page. Confirm
   exactly one PNG is pasted, no message is sent, and the original scroll point
   returns.
2. Test a page with lazy images, sticky navigation and a Retina display. Verify
   the pasted PNG includes the bottom of the page and has no repeated fixed
   overlay.
3. During a capture, switch tab, navigate, resize Chrome, and test a page that
   exceeds the extension timeout. Each case must show `!` and must not paste.
4. Press the Full Page button twice rapidly. There should be one capture and at
   most one paste.
5. Run D1 and D2 once. Their display capture, Chrome activation and paste should
   behave as before.

See `chrome-extension/README.md` for capture-size and page-structure limits.
