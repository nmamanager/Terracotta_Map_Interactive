@echo off
REM Usage: start_touch_test.bat [screen 1-3]
where node >nul 2>&1 || (echo Node.js is required: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
set SCREEN=%~1
if "%SCREEN%"=="" set SCREEN=1
set "PAGE=%~dp0app\touch\index.html"
set "PAGE=%PAGE:\=/%"
set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
start "" "%CHROME%" --user-data-dir="%TEMP%\tcw-touch-test" --no-first-run --start-fullscreen --disable-pinch --overscroll-history-navigation=0 "file:///%PAGE%?screen=%SCREEN%&preview&hub=localhost:8080"
node "%~dp0server\hub.mjs"
