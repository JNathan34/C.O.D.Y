@echo off
setlocal
call "%~dp0CODY-App\Build-Engine.bat"
exit /b %errorlevel%
