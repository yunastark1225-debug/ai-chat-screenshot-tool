(*
AI Chat Screenshot Tool - macOS
Display 2
*)

set DISPLAY_INDEX to 2
set AFTER_ACTIVATE_DELAY to 0.25
set CLICK_X_RATIO to 0.7
set CLICK_FROM_BOTTOM_PX to 120
set DO_DOUBLE_CLICK to false

do shell script "/usr/sbin/screencapture -D " & DISPLAY_INDEX & " -c -x"

set appName to "Google Chrome"
tell application appName to activate
delay AFTER_ACTIVATE_DELAY

tell application "System Events"
	if not (exists process appName) then return

	tell process appName
		set frontmost to true

		try
			set activeWindow to front window
			set {windowX, windowY} to position of activeWindow
			set {windowWidth, windowHeight} to size of activeWindow

			set clickX to windowX + (windowWidth * CLICK_X_RATIO)
			set clickY to (windowY + windowHeight) - CLICK_FROM_BOTTOM_PX

			if DO_DOUBLE_CLICK then
				click at {clickX, clickY}
				delay 0.03
				click at {clickX, clickY}
			else
				click at {clickX, clickY}
			end if
		end try
	end tell

	delay 0.05
	keystroke "v" using {command down}
end tell
