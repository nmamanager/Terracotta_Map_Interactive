@echo off
for %%I in ("%~dp0..") do set "TCW_ROOT=%%~fI"
schtasks /End /TN "TCW Map Kiosk" >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$r = $env:TCW_ROOT; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.Contains('launch_kiosk.ps1') -or $_.CommandLine.Contains(\"$r\server\hub.mjs\") -or $_.CommandLine.Contains(\"$r\chrome-profile\")) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Exhibit stopped. Run kiosk\start_kiosk.bat or reboot to start it again.
