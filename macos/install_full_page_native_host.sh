#!/bin/sh
# Registers this checkout's native host for the stable unpacked extension ID.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
host_path="$script_dir/full_page_native_host.py"
manifest_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
manifest_path="$manifest_dir/com.ai_chat_screenshot.full_page_paste.json"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to run the full-page native host." >&2
  exit 1
fi

if [ ! -f "$host_path" ]; then
  echo "Native host not found: $host_path" >&2
  exit 1
fi

mkdir -p "$manifest_dir"
chmod 700 "$host_path"

HOST_PATH="$host_path" MANIFEST_PATH="$manifest_path" python3 - <<'PY'
import json
import os

manifest = {
    "name": "com.ai_chat_screenshot.full_page_paste",
    "description": "Pastes a completed AI Chat full-page PNG into focused Google Chrome.",
    "path": os.environ["HOST_PATH"],
    "type": "stdio",
    "allowed_origins": ["chrome-extension://cmbkponfljoapkccbemoajlpljbmmgnl/"],
}
with open(os.environ["MANIFEST_PATH"], "w", encoding="utf-8") as file:
    json.dump(manifest, file, indent=2)
    file.write("\n")
PY

echo "Installed native host: $manifest_path"
echo "Reload the Chrome extension, then assign Option+Shift+Y to the dedicated command."
