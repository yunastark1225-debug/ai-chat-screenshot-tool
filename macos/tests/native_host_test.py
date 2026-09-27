import importlib.util
import pathlib
import unittest
from unittest.mock import patch


HOST = pathlib.Path(__file__).parents[1] / "full_page_native_host.py"
SPEC = importlib.util.spec_from_file_location("full_page_native_host", HOST)
native_host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native_host)


class NativeHostTests(unittest.TestCase):
    def test_paste_uses_system_events_and_never_submits(self):
        with patch.object(native_host.subprocess, "run") as run:
            native_host.paste_into_frontmost_chrome()

        command = run.call_args.args[0]
        self.assertEqual(command[:2], ["/usr/bin/osascript", "-e"])
        self.assertIn('process "Google Chrome"', command[2])
        self.assertIn('keystroke "v" using {command down}', command[2])
        self.assertNotIn("keystroke return", command[2])

    def test_only_the_expected_success_message_is_accepted(self):
        with patch.object(native_host, "read_message", return_value={"type": "wrong"}), \
             patch.object(native_host, "paste_into_frontmost_chrome") as paste, \
             patch.object(native_host, "write_message") as write:
            native_host.main()

        paste.assert_not_called()
        self.assertFalse(write.call_args.args[0]["ok"])

    def test_expected_message_pastes_and_acknowledges(self):
        message = {"type": native_host.MESSAGE_TYPE, "protocol": native_host.PROTOCOL}
        with patch.object(native_host, "read_message", return_value=message), \
             patch.object(native_host, "paste_into_frontmost_chrome") as paste, \
             patch.object(native_host, "write_message") as write:
            native_host.main()

        paste.assert_called_once_with()
        self.assertEqual(write.call_args.args[0], {"ok": True})


if __name__ == "__main__":
    unittest.main()
