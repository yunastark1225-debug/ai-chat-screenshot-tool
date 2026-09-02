# AI Chat Screenshot Tool - Windows

Press a dedicated launcher for Monitor 1 or Monitor 2.

The tool:
1. captures that monitor,
2. copies the screenshot to the Windows clipboard,
3. activates Google Chrome,
4. sends Ctrl+V.

If an AI chat input is already focused in Chrome, the screenshot is pasted directly into it.

No screenshot image is saved to disk.

## Install

```bat
pip install -r requirements.txt
```

## Launch

- `run_monitor1.bat`
- `run_monitor2.bat`

These BAT files can be assigned directly to Stream Deck buttons.

## Troubleshooting

If a run fails, open `screenshot_tool.log` in this folder.
