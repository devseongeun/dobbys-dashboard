#!/bin/sh
# nginx 컨테이너가 뜰 때(docker-entrypoint.d) 자체 서명 인증서를 준비한다.
# - CERT_HOST: 접속 주소 목록(쉼표 구분, IP 또는 도메인). 예: 10.255.17.161,dobbys.okestro.com. 모두 인증서에 들어간다.
# - /etc/nginx/certs 를 서버 폴더(deploy/certs)에 연결해 두면 한 번 만든 인증서를 계속 쓴다.
# - 이 스크립트가 만든 인증서에는 표시 파일(.self-signed)을 남긴다. CERT_HOST 가 바뀌면 그때만 다시 만든다.
# - 사내 정식 인증서는 같은 자리에 server.crt, server.key 를 넣고 .self-signed 를 지운다. 표시 파일이 없으면 손대지 않는다.
set -eu
DIR=/etc/nginx/certs
MARK="$DIR/.self-signed"
mkdir -p "$DIR"

SAN=""
FIRST=""
for NAME in $(printf '%s' "${CERT_HOST:-localhost}" | tr ',' ' ') localhost 127.0.0.1; do
  case "$NAME" in
    *[!0-9.]*) ENTRY="DNS:$NAME" ;;
    *) ENTRY="IP:$NAME" ;;
  esac
  case ",$SAN," in *",$ENTRY,"*) continue ;; esac
  SAN="${SAN:+$SAN,}$ENTRY"
  [ -n "$FIRST" ] || FIRST="$NAME"
done

if [ -s "$DIR/server.crt" ] && [ -s "$DIR/server.key" ]; then
  if [ ! -f "$MARK" ]; then
    echo "dobbys-dashboard: 있는 인증서를 씁니다(자체 서명 표시가 없어 바꾸지 않습니다)"
    exit 0
  fi
  if [ "$(cat "$MARK")" = "$SAN" ]; then
    echo "dobbys-dashboard: 있는 자체 서명 인증서를 씁니다 ($SAN)"
    exit 0
  fi
  echo "dobbys-dashboard: CERT_HOST 가 바뀌어 자체 서명 인증서를 다시 만듭니다"
fi

openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout "$DIR/server.key" -out "$DIR/server.crt" \
  -subj "/CN=$FIRST/O=dobbys-dashboard" -addext "subjectAltName=$SAN" 2>/dev/null
chmod 600 "$DIR/server.key"
printf '%s' "$SAN" > "$MARK"
echo "dobbys-dashboard: 자체 서명 인증서를 만들었습니다 ($SAN)"
