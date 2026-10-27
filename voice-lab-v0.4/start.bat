@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed. Install the LTS version from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\electron" (
  echo Installing Electron locally...
  call npm install
  if errorlevel 1 (
    echo Electron installation failed.
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 pause
