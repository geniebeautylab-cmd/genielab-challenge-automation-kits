#!/bin/bash
# 블로그 자동화 설치 — 더블클릭하면 실행됩니다
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null
echo "════════════════════════════════════════"
echo "  블로그 자동화 설치"
echo "  폴더: $ROOT"
echo "════════════════════════════════════════"
echo

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

# --- 1. Node 확인 ---
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js가 없습니다."
  echo "   https://nodejs.org 에서 LTS 버전을 설치하고 다시 실행해 주세요."
  echo; read -p "엔터를 누르면 창이 닫힙니다."; exit 1
fi
echo "✅ Node.js  $(node -v)"

# --- 2. Claude Code 확인 ---
if ! command -v claude >/dev/null 2>&1; then
  echo "❌ Claude Code가 없습니다."
  echo "   설치 후 터미널에서 'claude' 로 한 번 로그인해 주세요."
  echo; read -p "엔터를 누르면 창이 닫힙니다."; exit 1
fi
echo "✅ Claude Code"

# --- 3. 패키지 설치 ---
echo; echo "📦 필요한 프로그램을 받는 중… (처음엔 5분쯤 걸려요)"
npm install --silent || { echo "❌ npm install 실패"; read -p "엔터"; exit 1; }
npx playwright install chromium >/dev/null 2>&1
echo "✅ 설치 완료"

# --- 4. .env 파일 준비 ---
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "✅ 설정 파일(.env) 만들었어요"
fi

echo
echo "════════════════════════════════════════"
echo "  설치 끝났어요. 이제 아래 3개만 하시면 돼요."
echo "════════════════════════════════════════"
echo "  1. 터미널에서 claude setup-token 실행 → 나온 토큰을"
echo "     .env 파일의 CLAUDE_CODE_OAUTH_TOKEN= 뒤에 붙여넣기"
echo "  2. .env 파일에 PEXELS_API_KEY, NAVER_BLOG_ID 채우기"
echo "     (자세한 방법은 README.md 3단계 참고)"
echo "  3. 실행.command 더블클릭"
echo
echo "  ※ 이 도구는 카드뉴스와 달리 조용히 혼자 돌지 않아요."
echo "    실행.command로 화면을 열고 버튼을 눌러야 글이 만들어져요."
echo
read -p "엔터를 누르면 창이 닫힙니다."
