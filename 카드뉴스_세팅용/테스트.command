#!/bin/bash
# 테스트 — 새 글이 없어도 최신글로 카드를 한 번 만들어봅니다
cd "$(dirname "$0")" || exit 1
xattr -dr com.apple.quarantine . 2>/dev/null
export PATH="$HOME/Library/Application Support/CardNews/runtime/node/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
echo "════════════════════════════════════════"
echo "  카드 만들기 테스트"
echo "  1~2분 걸려요. 창을 닫지 마세요."
echo "════════════════════════════════════════"
echo
node scripts/run.mjs --force
echo
read -p "엔터를 누르면 창이 닫힙니다."
