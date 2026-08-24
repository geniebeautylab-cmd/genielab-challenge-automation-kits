#!/bin/bash
# 블로그 자동화 실행 — 더블클릭하면 대시보드가 열립니다
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

if [ ! -f "$ROOT/.env" ]; then
  echo "❌ 아직 설치가 안 됐어요. 먼저 설치.command를 더블클릭해 주세요."
  echo; read -p "엔터를 누르면 창이 닫힙니다."; exit 1
fi

echo "════════════════════════════════════════"
echo "  블로그 자동화 실행 중…"
echo "════════════════════════════════════════"
echo

# --- 이전(유령/중복) 프로세스가 포트 3000을 잡고 있으면 정리 ---
STALE=$(/usr/sbin/lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null)
if [ -n "$STALE" ]; then
  echo "[준비] 포트 3000 정리 중…"
  kill -9 $STALE 2>/dev/null
  sleep 1
fi

# --- 몇 초 뒤 브라우저 자동으로 열기 ---
(sleep 2 && open "http://localhost:3000") &

echo "브라우저가 곧 자동으로 열립니다. (안 열리면 http://localhost:3000 으로 직접 접속하세요)"
echo "이 창을 닫으면 프로그램이 멈춰요. 사용 중엔 그냥 두세요."
echo

# caffeinate 로 감싸서 이 창이 켜져 있는 동안 맥이 잠들지 않게 함
# (시스템 전원 설정을 영구히 바꾸지 않음 — 이 창을 닫으면 원래대로 돌아감)
exec caffeinate -ism node server.js
