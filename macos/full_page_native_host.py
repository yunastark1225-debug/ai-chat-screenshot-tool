#!/usr/bin/env python3
"""Chrome Native Messaging host for the macOS full-page Stream Deck action."""

import json
import struct
import subprocess
import sys

MESSAGE_TYPE = "paste-full-page-png"
PROTOCOL = 1


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        raise ValueError("native message header is incomplete")
    size = struct.unpack("<I", header)[0]
    if not 0 < size <= 1024 * 1024:
        raise ValueError("native message length is invalid")
    payload = sys.stdin.buffer.read(size)
    if len(payload) != size:
        raise ValueError("native message body is incomplete")
    return json.loads(payload.decode("utf-8"))


def write_message(payload):
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)) + encoded)
    sys.stdout.buffer.flush()


def paste_into_frontmost_chrome():
    script = '''
tell application "System Events"
  if not (exists process "Google Chrome") then error "Google Chrome is not running"
  tell process "Google Chrome"
    if not frontmost then error "Google Chrome is no longer frontmost"
  end tell
end tell
tell application "System Events"
  tell process "Google Chrome"
    keystroke "v" using {command down}
  end tell
end tell
'''
    subprocess.run(["/usr/bin/osascript", "-e", script], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)


def main():
    try:
        message = read_message()
        if message != {"type": MESSAGE_TYPE, "protocol": PROTOCOL}:
            raise ValueError("unexpected native message")
        paste_into_frontmost_chrome()
        write_message({"ok": True})
    except Exception as error:  # Chrome must receive a response instead of pasting blindly.
        write_message({"ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
