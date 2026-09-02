@echo off
cd /d "%~dp0"
python "%~dp0screenshot_to_chat.py" --monitor 1
if errorlevel 1 (
    echo.
    echo An error occurred. Check screenshot_tool.log in this folder.
    timeout /t 5 >nul
)
