# AI Chat Screenshot Tool - macOS

macOS implementation using Shortcuts + AppleScript.

## What it does

1. Captures a predefined display directly to the clipboard.
2. Activates Google Chrome.
3. Clicks near the chat input area.
4. Pastes the screenshot with Cmd+V.

No screenshot image is saved to disk.

## Files

- `D1_Shot.applescript` — Display 1
- `D2_Shot.applescript` — Display 2

## Shortcuts setup

Create two macOS Shortcuts:
- `D1_Shot`
- `D2_Shot`

Each shortcut needs one AppleScript action containing the corresponding script.

These shortcuts can be assigned to Stream Deck buttons.

## Permissions

Depending on the launch method, grant Screen Recording and Accessibility permissions to Shortcuts and/or Stream Deck.

## Adjustable values

```applescript
set CLICK_X_RATIO to 0.7
set CLICK_FROM_BOTTOM_PX to 120
```
