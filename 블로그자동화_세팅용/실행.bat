@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env" (
  echo [X] 아직 설치가 안 됐어요. 먼저 설치.bat을 더블클릭해 주세요.
  echo.
  pause
  exit /b 1
)

echo ========================================
echo   블로그 자동화 실행 중...
echo ========================================
echo.

REM --- 포트 3000을 잡고 있는 이전 프로세스 정리 ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
  echo [준비] 포트 3000 정리 중...
  taskkill /F /PID %%p >nul 2>nul
)

REM --- 몇 초 뒤 브라우저 자동으로 열기 ---
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"

echo 브라우저가 곧 자동으로 열립니다. (안 열리면 http://localhost:3000 으로 직접 접속하세요)
echo 이 창을 닫으면 프로그램이 멈춰요. 사용 중엔 그냥 두세요.
echo.

node server.js
