# 도비의 대시보드 웹 버전(사내 서버용) 이미지. 두 서비스가 이 파일의 다른 target 을 쓴다(deploy/docker-compose.yml).
# - app:   web_serve.py(표준 라이브러리만). 정적 화면 web/ 과 /api/jira 프록시. 컨테이너 내부망에만 연다.
# - proxy: nginx. HTTPS 를 직접 연다(브라우저는 HTTPS·localhost 에서만 폴더 선택 창을 연다). 인증서가 없으면 첫 기동 때
#          자체 서명 인증서를 만든다.
# 사내망에서 Docker Hub 가 막히면 --build-arg 로 사내 이미지 저장소의 같은 이미지를 지정한다.

ARG PYTHON_IMAGE=python:3.12-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${PYTHON_IMAGE} AS app
# 사이드바 버전 줄. 이미지에는 .git 이 없어 빌드 때 굽는다(api/version.py).
ARG DOBBYS_COMMIT=""
ARG DOBBYS_COMMIT_DATE=""
ENV DOBBYS_COMMIT=${DOBBYS_COMMIT} \
    DOBBYS_COMMIT_DATE=${DOBBYS_COMMIT_DATE} \
    HOST=0.0.0.0 \
    PORT=8788 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
# 웹 버전이 실제로 여는 파일만 넣는다(web_serve.py 의 SHARED_FILES 포함). 로컬판 서버·키체인·설정 코드는 넣지 않는다.
COPY web_serve.py jira_client.py ./
COPY api ./api
COPY web ./web
COPY shell/route.js shell/order.js shell/onboarding_flow.js shell/shell.css ./shell/
COPY tabs/_common/vendor/marked.umd.js ./tabs/_common/vendor/
COPY tabs/plans/templates ./tabs/plans/templates
# CERT_HOST(쉼표 구분 주소 목록)·HTTPS_PORT 로 ALLOWED_ORIGINS 를 만들고 web_serve.py 를 띄운다.
COPY deploy/app-start.sh ./app-start.sh
RUN adduser -D -H -u 10001 dobbys
USER dobbys
EXPOSE 8788
CMD ["sh", "app-start.sh"]

FROM ${NGINX_IMAGE} AS proxy
RUN apk add --no-cache openssl
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/10-self-signed-cert.sh /docker-entrypoint.d/10-self-signed-cert.sh
RUN chmod +x /docker-entrypoint.d/10-self-signed-cert.sh && rm -f /etc/nginx/conf.d/default.conf
# HTTPS_PORT 는 바깥에 알리는 포트(HTTP→HTTPS 넘김 주소에만 쓴다). 컨테이너 안은 8080(HTTP), 8443(HTTPS).
ENV HTTPS_PORT=9443
EXPOSE 8080 8443
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
