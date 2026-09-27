(*)
AI Chat Screenshot Tool - macOS full-page workflow

This starts Chrome's dedicated full-page-and-paste command. It does not paste
itself: the native messaging host receives a success notification from the
extension and sends Cmd+V only after the PNG is on the clipboard.
*)

set appName to "Google Chrome"

tell application appName to activate

tell application "System Events"
	if not (exists process appName) then return
	tell process appName
		set frontmost to true
		keystroke "y" using {option down, shift down}
	end tell
end tell
