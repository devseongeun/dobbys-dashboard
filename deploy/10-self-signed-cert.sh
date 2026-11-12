#!/bin/sh
# nginx 컨테이너가 뜰 때(docker-entrypoint.d) 인증서가 없으면 자체 서명 인증서를 만든다.
# /etc/nginx/certs 를 서버 폴더(deploy/certs)에 연결해 두면 한 번 만든 인증서를 계속 쓴다.
# 사내 정식 인증서가 생기면 같은 자리에 server.crt, server.key 를 넣고 컨테이너를 다시 시작한다.
set -eu
DIR=/etc/nginx/certs
mkdir -p "$DIR"
if [ -s "$DIR/server.crt" ] && [ -s "$DIR/server.key" ]; then
  echo "dobbys-dashboard: 있는 인증서를 씁니다"
  exit 0
fi
NAME="${CERT_HOST:-localhost}"
case "$NAME" in
  localhost) SAN="DNS:localhost,IP:127.0.0.1" ;;
  *[!0-9.]*) SAN="DNS:$NAME,DNS:localhost,IP:127.0.0.1" ;;
  *) SAN="IP:$NAME,DNS:localhost,IP:127.0.0.1" ;;
esac
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout "$DIR/server.key" -out "$DIR/server.crt" \
  -subj "/CN=$NAME/O=dobbys-dashboard" -addext "subjectAltName=$SAN" 2>/dev/null
chmod 600 "$DIR/server.key"
echo "dobbys-dashboard: 자체 서명 인증서를 만들었습니다 ($SAN)"
