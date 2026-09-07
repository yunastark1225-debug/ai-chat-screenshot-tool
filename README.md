# AI Chat Screenshot Tool

A cross-platform screenshot input helper for AI chat workflows.

The tool captures a selected display directly to the clipboard, brings Google Chrome to the foreground, and pastes the screenshot into the chat input area.

No screenshot image is saved to disk.

## Features

- One-button capture for a predefined display
- No display selection required for each capture
- Clipboard-only workflow — screenshots are not saved to disk
- Automatic paste into Google Chrome
- Dedicated D1 / D2 workflow for multi-display setups
- Stream Deck integration
- Windows and macOS support
- Custom Stream Deck icons included

## Supported platforms

| Platform | Implementation | Launchers |
| --- | --- | --- |
| Windows | Python + batch files | Monitor 1 / Monitor 2 |
| macOS | Shortcuts + AppleScript | D1 / D2 |

## Repository structure

```text
windows/   Windows implementation and setup instructions
macos/     macOS implementation and setup instructions
assets/    Custom Stream Deck icons
```

See the platform-specific documentation for installation and configuration:

- [Windows setup](windows/README.md)
- [macOS setup](macos/README.md)

## How it works

1. Run the launcher for the target display.
2. Capture the display directly to the clipboard.
3. Bring Google Chrome to the foreground.
4. Paste the screenshot with `Ctrl+V` on Windows or `Cmd+V` on macOS. By default, the macOS version pastes into the currently focused input without clicking.

## Stream Deck workflow

Both implementations are used with Stream Deck in daily operation.

- On Windows, the batch files can be assigned directly to Stream Deck buttons.
- On macOS, each AppleScript is run through a macOS Shortcut, and the corresponding shortcut is assigned to a Stream Deck D1 or D2 button.

Custom D1 and D2 icons for Stream Deck are included in the `assets/` directory.

## Platform notes

### Windows

The Windows version uses Python to capture the selected monitor and place the image on the clipboard. The chat input should already be focused in Google Chrome.

### macOS

The macOS version uses the built-in `screencapture` command through AppleScript. By default, it activates Google Chrome and pastes the image with `Cmd+V` into the currently focused input without clicking. Set `SKIP_CLICK` to `false` to enable the configurable click-position mode before pasting.

Screen Recording and Accessibility permissions may be required for Shortcuts and/or Stream Deck.

## Limitations

- On Windows, if the currently active window is not Chrome, the tool may fall back to another open Chrome window.
- On macOS, paste targeting depends on the configured click position and the current Chrome window layout only when `SKIP_CLICK` is `false`.
- Confirm the intended chat input is targeted before sending or submitting a pasted screenshot, especially when sensitive information may be visible on the captured display.

## Status

Windows and macOS versions have both been tested in their respective environments.
