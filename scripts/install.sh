#!/bin/sh
# 한 줄 설치: curl -fsSL https://raw.githubusercontent.com/devseongeun/dobbys-dashboard/main/scripts/install.sh | sh
# 받아 두고 다시 실행해도 된다. 이미 설치돼 있으면 최신으로 받고 같은 질문을 한다.
#   DOBBYS_DIR=<경로>     설치 위치(기본 ~/workspace/dobbys-dashboard)
#   DOBBYS_ALWAYS=y|n     "항상 실행" 질문의 답을 미리 정한다(터미널이 없을 때 쓴다)
#   PORT=<번호>           포트(기본 8787)
#   PYTHON=<경로>         쓸 Python 3.11 이상
set -eu

REPO_URL=https://github.com/devseongeun/dobbys-dashboard.git
DIR="${DOBBYS_DIR:-$HOME/workspace/dobbys-dashboard}"
PORT="${PORT:-8787}"
export PORT
URL="http://127.0.0.1:$PORT/"

say() { printf '%s\n' "$*"; }
die() { printf '설치 중단: %s\n' "$*" >&2; exit 1; }

# 3.11 이상인 python3 를 찾는다. macOS 기본 /usr/bin/python3 는 3.9 라 건너뛴다.
find_python() {
  for p in "${PYTHON:-}" python3 python3.14 python3.13 python3.12 python3.11 \
    /opt/homebrew/bin/python3 /usr/local/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    [ -n "$p" ] || continue
    c="$(command -v "$p" 2>/dev/null)" || continue
    "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null || continue
    printf '%s\n' "$c"
    return 0
  done
  return 1
}

# curl | sh 로 받으면 표준입력이 파이프라서 질문은 /dev/tty 로 묻는다.
ask_always() {
  case "${DOBBYS_ALWAYS:-}" in
    [yY]*) return 0 ;;
    [nN]*) return 1 ;;
  esac
  if ! { : </dev/tty; } 2>/dev/null; then
    say "터미널이 없어 항상 실행은 건너뛴다(DOBBYS_ALWAYS=y 로 다시 실행하면 등록한다)."
    return 1
  fi
  printf '\n대시보드를 항상 실행할까요? 로그인할 때 자동으로 켜지고, 꺼지면 다시 켜집니다. [Y/n] ' >/dev/tty
  read -r answer </dev/tty || answer=
  case "$answer" in
    [nN]*) return 1 ;;
    *) return 0 ;;
  esac
}

wait_for_server() {
  i=0
  while [ "$i" -lt 20 ]; do
    curl -fs -o /dev/null "$URL" 2>/dev/null && return 0
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

main() {
  [ "$(uname -s)" = Darwin ] || die "macOS 에서만 설치할 수 있다."

  if ! git --version >/dev/null 2>&1; then
    xcode-select --install >/dev/null 2>&1 || true
    die "git 이 없다. 열린 창에서 '설치'(Command Line Tools)를 누르고, 끝나면 이 명령을 다시 실행한다."
  fi

  PY="$(find_python)" || die "Python 3.11 이상이 없다. 'brew install python' 또는 https://www.python.org/downloads/macos/ 에서 설치한 뒤 이 명령을 다시 실행한다."
  say "Python: $PY ($("$PY" -c 'import platform; print(platform.python_version())'))"

  if [ -d "$DIR/.git" ]; then
    origin="$(git -C "$DIR" remote get-url origin 2>/dev/null || true)"
    case "$origin" in
      *dobbys-dashboard*) ;;
      *) die "$DIR 에 다른 저장소가 있다($origin). DOBBYS_DIR=<다른 경로> 로 다시 실행한다." ;;
    esac
    say "이미 설치돼 있다: $DIR — 최신으로 받는다."
    git -C "$DIR" pull --ff-only --quiet || say "최신으로 받지 못했다(로컬 변경이 있으면 정리한 뒤 대시보드의 ⬆ 업데이트를 누른다). 설치는 계속한다."
  elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    die "$DIR 가 비어 있지 않다. DOBBYS_DIR=<다른 경로> 로 다시 실행한다."
  else
    say "받는 중: $REPO_URL → $DIR"
    mkdir -p "$(dirname "$DIR")"
    git clone --quiet "$REPO_URL" "$DIR"
  fi

  if ask_always; then
    PYTHON="$PY" sh "$DIR/scripts/install-launchd.sh"
    say "설정할 WBS 엑셀·폴더는 ~/Downloads·~/Desktop 밖(예: Obsidian Vault 안)에 둔다. 상주 실행은 그 두 폴더를 읽지 못한다."
    say "끄기: launchctl bootout gui/\$(id -u)/com.dobbys-dashboard"
    if wait_for_server; then
      open "$URL"
    else
      say "서버가 아직 응답하지 않는다. 잠시 뒤 $URL 을 연다(로그: ~/Library/Logs/dobbys-dashboard/)."
    fi
  else
    say ""
    say "항상 실행하지 않는다. 나중에 등록하려면: sh \"$DIR/scripts/install-launchd.sh\""
    say "다음에 직접 켜려면: cd \"$DIR\" && $PY serve.py"
    if { : </dev/tty; } 2>/dev/null; then
      say "지금 띄운다: $URL (끄려면 Ctrl+C)"
      cd "$DIR"
      (wait_for_server && open "$URL") &
      exec "$PY" serve.py </dev/tty
    fi
  fi
}

main "$@"
