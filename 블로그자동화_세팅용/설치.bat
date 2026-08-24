@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   블로그 자동화 설치
echo   폴더: %cd%
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

REM --- 4. .env 파일 준비 ---
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo [OK] 설정 파일(.env) 만들었어요
)

echo.
echo ========================================
echo   설치 끝났어요. 이제 아래 3개만 하시면 돼요.
echo ========================================
echo   1. 명령 프롬프트에서 claude setup-token 실행 후
echo      나온 토큰을 .env 파일의 CLAUDE_CODE_OAUTH_TOKEN= 뒤에 붙여넣기
echo   2. .env 파일에 PEXELS_API_KEY, NAVER_BLOG_ID 채우기
echo      (자세한 방법은 README.md 3단계 참고)
echo   3. 실행.bat 더블클릭
echo.
echo   ※ 이 도구는 카드뉴스와 달리 조용히 혼자 돌지 않아요.
echo     실행.bat으로 화면을 열고 버튼을 눌러야 글이 만들어져요.
echo.
pause
