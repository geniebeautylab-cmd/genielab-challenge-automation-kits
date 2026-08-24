@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\CardNews\runtime\node;%PATH%"
node scripts\insta-login.mjs
echo.
pause
