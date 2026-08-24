@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\CardNews\runtime\node;%PATH%"
echo ========================================
echo   카드 만들기 테스트
echo   1~2분 걸려요. 창을 닫지 마세요.
echo ========================================
echo.
node scripts\run.mjs --force
echo.
pause
