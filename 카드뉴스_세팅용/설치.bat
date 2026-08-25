@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ROOT=%cd%"
set "PATH=%LOCALAPPDATA%\CardNews\runtime\node;%PATH%"

echo ========================================
echo   카드뉴스 자동화 설치
echo   폴더: %ROOT%
echo ========================================
echo.

REM --- 1. Node 확인 ---
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js가 없습니다.
  echo     https://nodejs.org 에서 LTS 버전을 설치하고 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [OK] Node.js  %%v

REM --- 2. Claude Code 확인 ---
where claude >nul 2>nul
if errorlevel 1 (
  echo [X] Claude Code가 없습니다.
  echo     설치 후 명령 프롬프트에서 'claude' 로 한 번 로그인해 주세요.
  echo.
  pause
  exit /b 1
)
echo [OK] Claude Code

REM --- 3. 패키지 설치 ---
echo.
echo 필요한 프로그램을 받는 중... (처음엔 5분쯤 걸려요)
call npm install --silent
if errorlevel 1 (
  echo [X] npm install 실패
  pause
  exit /b 1
)
call npx playwright install chromium >nul 2>nul
echo [OK] 설치 완료

REM --- 4. 자동 실행 등록 (매일 오전 9시10분, Windows 작업 스케줄러) ---
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
schtasks /Create /TN "MyCardNewsDaily" /TR "cmd /c cd /d \"%ROOT%\" && node scripts\run.mjs >> \"%ROOT%\logs\daily.log\" 2>&1" /SC DAILY /ST 09:10 /F >nul 2>nul
if errorlevel 1 (
  echo [!] 자동 실행 등록 실패 — 수동으로는 잘 됩니다. 관리자 권한으로 다시 실행해보세요.
) else (
  echo [OK] 매일 오전 9시 10분 자동 실행 등록됨
)

echo.
echo ========================================
echo   설치 끝났어요. 이제 아래 3개만 하시면 돼요.
echo ========================================
echo   1. config.json 열어서 블로그 아이디·색상 넣기
echo   2. slides-prompt.md 위쪽 두 줄 바꾸기
echo   3. assets\photos 폴더에 사진 6~10장 넣기
echo.
echo   그다음 테스트:  테스트.bat 더블클릭
echo.
pause
