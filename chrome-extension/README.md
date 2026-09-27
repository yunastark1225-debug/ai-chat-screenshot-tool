# Chrome Full Page Capture

Experimental Chrome/Chromium extension for the AI Chat Screenshot Tool.

It captures the current web page from top to bottom, stitches the visible viewports into one PNG, and writes the PNG directly to the clipboard.

- No result tab
- No image file saved to disk
- Trigger from the extension button or a keyboard shortcut
- Designed for Stream Deck workflows

## Install for testing

1. Open `chrome://extensions/`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `chrome-extension` folder from this repository.
5. Open `chrome://extensions/shortcuts` and confirm **Capture full page to clipboard** is assigned to the desired shortcut.

The default suggested shortcut is:

```text
Alt + Shift + P
```

## Test

1. Open a normal `http://` or `https://` page with vertical scrolling.
2. Press `Alt + Shift + P`.
3. Wait for the extension badge to change from `…` to `✓`.
4. Paste into an image-capable destination such as an AI chat input.

The page should return to the scroll position it had before capture.

## Current behavior

- Captures the current viewport width and the full vertical document height.
- Fixed/sticky elements are kept in the first viewport and hidden during later viewport captures to reduce duplication.
- Very large pages are automatically downscaled to stay within practical canvas limits.
- Chrome internal pages such as `chrome://settings` cannot be captured.

## Status

This is an MVP and should be tested on macOS and Windows before merging into `main`.
