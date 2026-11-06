#!/bin/sh
# 빈 설정으로 대시보드를 띄워 최초 온보딩을 본다. 실제 설정·개인 상태·캐시는 건드리지 않는다.
# HOME 을 임시 폴더로 바꾸면 dashboard/paths.py 의 위치가 모두 그 아래로 옮겨진다. 끄면(Ctrl+C) 임시 폴더를 지운다.
# 키체인은 HOME 과 무관하게 실제 로그인 키체인을 쓴다. 샌드박스 탭 안에서 로그인하면 실제 값을 덮어쓴다.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8790}"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/dobbys-sandbox.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT INT TERM
echo "샌드박스: $SANDBOX  (설정·상태는 여기 쌓인다. 경로는 Finder 선택 창으로 실제 폴더를 고른다)"
cd "$REPO"
HOME="$SANDBOX" PORT="$PORT" python3 serve.py
