#!/bin/bash
# 더블클릭하면 카드 글씨 편집기가 브라우저에 열립니다. (창은 그대로 두세요. 끝나면 이 창에서 Ctrl+C)
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")" || exit 1
node scripts/editor.js
