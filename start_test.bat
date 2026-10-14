@echo off
where node >nul 2>&1 || (echo Node.js is required: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
start "" http://localhost:8080/dev/
node "%~dp0server\hub.mjs"
