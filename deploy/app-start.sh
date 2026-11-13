#!/bin/sh
# app 컨테이너 시작. ALLOWED_ORIGINS 를 따로 주지 않으면 CERT_HOST(쉼표 구분 주소 목록)와 HTTPS_PORT 로 만든다:
#   https://<주소>:<HTTPS_PORT> 마다 하나 + https://localhost:<HTTPS_PORT> + http://127.0.0.1:8788(컨테이너 healthcheck)
set -eu
if [ -z "${ALLOWED_ORIGINS:-}" ]; then
  PORT_OUT="${HTTPS_PORT:-9443}"
  ORIGINS=""
  for NAME in $(printf '%s' "${CERT_HOST:-localhost}" | tr ',' ' ') localhost; do
    ORIGIN="https://$NAME:$PORT_OUT"
    case ",$ORIGINS," in *",$ORIGIN,"*) continue ;; esac
    ORIGINS="${ORIGINS:+$ORIGINS,}$ORIGIN"
  done
  ALLOWED_ORIGINS="$ORIGINS,http://127.0.0.1:${PORT:-8788}"
  export ALLOWED_ORIGINS
fi
# TROMBONE_BASE(기획서 주소, compose 가 .env 에서 넘김)는 그대로 web_serve.py 의 /api/trombone 이 읽는다. 비어 있으면 코멘트 탭이 '주소 미설정'
export TROMBONE_BASE="${TROMBONE_BASE:-}"
exec python3 web_serve.py
