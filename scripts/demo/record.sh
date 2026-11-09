#!/bin/sh
# README 시연 GIF 를 목업 데이터로 다시 찍는다. 실제 설정·개인 상태·Vault 는 건드리지 않는다.
# 영상 하나를 찍어 탭별 장면 구간(record.mjs 가 남긴 scenes.txt)으로 잘라 탭마다 GIF 하나씩 만든다.
#   sh scripts/demo/record.sh            # → docs/demo/<탭 id>.gif
#   WIDTH=1000 FPS=8 sh scripts/demo/record.sh out-dir   # 기본 WIDTH=1200, FPS=10
# 필요: python3, node(npm), ffmpeg. playwright 는 임시 폴더에 깔고 끝나면 지운다(브라우저는 ~/Library/Caches/ms-playwright 에 남는다).
# 서버는 scripts/demo/serve_demo.py 로 띄운다. 키체인은 메모리, Jira 는 목업 응답이라 실제 키체인·Jira 에 닿지 않는다.
set -eu
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$REPO/docs/demo}"
# 고정 포트는 이미 떠 있는 실제 대시보드와 겹칠 수 있다. 비어 있는 포트를 받는다.
PORT="${PORT:-$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')}"
WIDTH="${WIDTH:-1200}"
FPS="${FPS:-10}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/dobbys-demo.XXXXXX")"
SERVER=""
cleanup() {
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

mkdir -p "$WORK/home" "$WORK/pw" "$WORK/video"
python3 "$REPO/scripts/demo/mock_data.py" "$WORK/home"
(cd "$REPO" && HOME="$WORK/home" PORT="$PORT" exec python3 scripts/demo/serve_demo.py >"$WORK/server.log" 2>&1) &
SERVER=$!

echo "playwright 설치: $WORK/pw"
(cd "$WORK/pw" && npm init -y >/dev/null && npm install --silent playwright@1 && npx playwright install chromium >/dev/null)
cp "$REPO/scripts/demo/record.mjs" "$WORK/pw/"

for _ in $(seq 50); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.2
done
# 그 포트에 다른 대시보드가 떠 있으면 실제 데이터를 찍게 된다. 목업 프로젝트인지 확인한 뒤에만 녹화한다.
if ! kill -0 "$SERVER" 2>/dev/null || ! curl -sf "http://127.0.0.1:$PORT/_dashboard/config" | grep -q '"project": "DEMO 1.0.0"'; then
  echo "목업 서버가 $PORT 에 뜨지 않았다(다른 서버가 쓰는 중일 수 있다):" >&2
  cat "$WORK/server.log" >&2
  exit 1
fi

echo "녹화 중 (약 1분)"
BASE="http://127.0.0.1:$PORT" VIDEO_DIR="$WORK/video" DEMO_HOME="$WORK/home" node "$WORK/pw/record.mjs"
VIDEO="$(ls "$WORK"/video/*.webm)"

mkdir -p "$OUT"
while read -r ID START LENGTH; do
  # -nostdin: ffmpeg 가 루프의 입력(scenes.txt)을 읽어 버리지 않게 한다.
  ffmpeg -nostdin -loglevel error -y -ss "$START" -t "$LENGTH" -i "$VIDEO" \
    -vf "fps=$FPS,scale=$WIDTH:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
    "$OUT/$ID.gif"
  echo "완성: $OUT/$ID.gif ($(du -h "$OUT/$ID.gif" | cut -f1), ${LENGTH}s)"
done <"$WORK/video/scenes.txt"
