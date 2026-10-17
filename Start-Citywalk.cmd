@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 LTS, then run this file again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<18)process.exit(1)"
if errorlevel 1 (
  echo Node.js 18 or later is required. Node.js 22 LTS is recommended.
  pause
  exit /b 1
)
echo Open the localhost URL printed below. Press Ctrl+C to stop.
node server.js
pause
