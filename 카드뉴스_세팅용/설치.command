#!/bin/bash
# 카드뉴스 자동화 설치 — 더블클릭하면 실행됩니다
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
echo "════════════════════════════════════════"
echo "  카드뉴스 자동화 설치"
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

# --- 4. 자동 실행 등록 ---
LABEL="com.mycardnews.daily"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs"
cat > "$PLIST" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key>
	<array><string>/bin/bash</string><string>$ROOT/scripts/run.sh</string></array>
	<key>RunAtLoad</key><false/>
	<key>StandardErrorPath</key><string>$ROOT/logs/launchd.err.log</string>
	<key>StandardOutPath</key><string>$ROOT/logs/launchd.out.log</string>
	<key>StartCalendarInterval</key>
	<dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>10</integer></dict>
	<key>WorkingDirectory</key><string>$ROOT</string>
</dict>
</plist>
PLISTEOF
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST" 2>/dev/null && echo "✅ 매일 오전 9시 10분 자동 실행 등록됨" || echo "⚠️  자동 실행 등록 실패 — 수동으로는 잘 됩니다"

echo
echo "════════════════════════════════════════"
echo "  설치 끝났어요. 이제 아래 3개만 하시면 돼요."
echo "════════════════════════════════════════"
echo "  1. config.json 열어서 블로그 아이디·색상 넣기"
echo "  2. slides-prompt.md 위쪽 두 줄 바꾸기"
echo "  3. assets/photos 폴더에 사진 6~10장 넣기"
echo
echo "  그다음 테스트:  bash scripts/run.sh --force"
echo
read -p "엔터를 누르면 창이 닫힙니다."
