@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\build-working-copy.ps1
if errorlevel 1 exit /b %errorlevel%
node tools\prepare-standalone.cjs
if errorlevel 1 exit /b %errorlevel%
set "ELECTRON_BUILDER_COMPRESSION_LEVEL=3"
node "node_modules\electron-builder\cli.js" --config electron-builder.standalone.cjs --win nsis --x64 --arm64 --publish never
exit /b %errorlevel%
