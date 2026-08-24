#!/bin/bash
# run.sh — run.mjs 로 넘겨주는 껍데기입니다. 실제 내용은 scripts/run.mjs 에 있어요.
# (예전에 등록해둔 자동 실행이 이 파일을 부르고 있어서 남겨둡니다)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/Library/Application Support/CardNews/runtime/node/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
exec node "$ROOT/scripts/run.mjs" "$@"
