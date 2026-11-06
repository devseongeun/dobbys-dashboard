#!/bin/sh
# 대시보드 화면의 ⬆ 업데이트 버튼과 같은 일을 터미널에서 한다. 서버가 죽어 있어도 쓸 수 있다.
# origin 을 받아 fast-forward 하고, launchd 에 등록돼 있으면 재시작한다.
set -eu
LABEL=com.dobbys-dashboard
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "커밋하지 않은 변경이 있다. 정리한 뒤 다시 실행한다." >&2
  exit 1
fi
before="$(git rev-parse --short HEAD)"
git pull --ff-only --quiet
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then
  echo "이미 최신이다: $after"
  exit 0
fi
echo "업데이트: $before → $after"
git log --format='  · %s' "$before..$after"
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  echo "launchd 로 다시 띄웠다."
else
  echo "launchd 등록이 없다. 서버를 직접 다시 띄운다: python3 serve.py"
fi
