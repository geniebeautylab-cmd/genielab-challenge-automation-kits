#!/bin/bash
# 인스타 로그인 — 더블클릭하면 크롬 창이 열립니다
cd "$(dirname "$0")" || exit 1
xattr -dr com.apple.quarantine . 2>/dev/null
export PATH="$HOME/Library/Application Support/CardNews/runtime/node/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
node scripts/insta-login.mjs
echo
read -p "엔터를 누르면 창이 닫힙니다."
