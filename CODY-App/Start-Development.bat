@echo off
setlocal
cd /d "%~dp0"
set "CODY_ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%CODY_ELECTRON%" (
  echo The C.O.D.Y. Electron runtime is missing. Run npm install in CODY-HeyClicky-Rework.
  pause
  exit /b 1
)
start "C.O.D.Y." /d "%~dp0" "%CODY_ELECTRON%" "%~dp0frontend\original-cody"
