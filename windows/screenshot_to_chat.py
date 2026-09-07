import ctypes

# Keep DPI awareness setup before screen/window-related imports.
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

import argparse
import sys
import time
from io import BytesIO
from pathlib import Path

import mss
import pyautogui
import pygetwindow as gw
import win32clipboard
from PIL import Image


LOG_FILE = Path(__file__).with_name("screenshot_tool.log")
LOG_OLD_FILE = LOG_FILE.with_suffix(".old")
MAX_LOG_BYTES = 1024 * 1024


def log(message: str) -> None:
    text = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}"
    print(text)
    try:
        if LOG_FILE.exists() and LOG_FILE.stat().st_size >= MAX_LOG_BYTES:
            LOG_FILE.replace(LOG_OLD_FILE)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(text + "\n")
    except Exception:
        pass


def send_to_clipboard(image: Image.Image) -> None:
    output = BytesIO()
    image.convert("RGB").save(output, "BMP")
    data = output.getvalue()[14:]
    output.close()

    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32clipboard.CF_DIB, data)
    finally:
        win32clipboard.CloseClipboard()


def find_chrome_window():
    # Prefer the currently active Chrome window.
    active = gw.getActiveWindow()
    if active and active.title and "chrome" in active.title.lower():
        return active

    # Fallback: find any Chrome window.
    for window in gw.getAllWindows():
        if window.title and "chrome" in window.title.lower():
            return window

    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--monitor", type=int, required=True)
    args = parser.parse_args()

    time.sleep(0.3)

    try:
        with mss.mss() as sct:
            log(f"Detected physical monitors: {len(sct.monitors) - 1}")

            if len(sct.monitors) <= args.monitor:
                log(f"Monitor {args.monitor} was not found.")
                return 1

            monitor = sct.monitors[args.monitor]
            log(
                f"Capturing monitor {args.monitor}: "
                f"{monitor['width']}x{monitor['height']} "
                f"at ({monitor['left']}, {monitor['top']})"
            )

            sct_img = sct.grab(monitor)
            img = Image.frombytes(
                "RGB",
                sct_img.size,
                sct_img.bgra,
                "raw",
                "BGRX",
            )
            send_to_clipboard(img)
            log(f"Monitor {args.monitor} screenshot copied to clipboard.")

        target_window = find_chrome_window()

        if not target_window:
            log("Chrome window was not found. Screenshot remains in clipboard.")
            return 1

        log("Chrome window found.")

        if target_window.isMinimized:
            target_window.restore()
            time.sleep(0.2)

        try:
            target_window.activate()
        except Exception as exc:
            log(
                "Chrome activation failed; retrying once: "
                f"{type(exc).__name__}: {exc}"
            )
            time.sleep(0.3)
            try:
                target_window.activate()
            except Exception as retry_exc:
                log(
                    "Chrome activation retry failed; continuing with paste: "
                    f"{type(retry_exc).__name__}: {retry_exc}"
                )
        time.sleep(0.5)
        pyautogui.hotkey("ctrl", "v")
        log("Ctrl+V sent to Chrome.")
        return 0

    except Exception as exc:
        log(f"ERROR: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
