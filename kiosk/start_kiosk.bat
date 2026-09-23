@echo off
schtasks /Run /TN "TCW Map Kiosk" >nul 2>&1 || powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launch_kiosk.ps1"
