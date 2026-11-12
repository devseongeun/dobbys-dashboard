# 웹 버전 Docker 배포 (HTTPS, 자체 서명 인증서)

웹 버전(`web_serve.py`)을 nginx 뒤에 두고 컨테이너가 HTTPS 를 직접 연다. 비밀값·DB 는 없다.

```
브라우저 ─▶ http://서버:8091 ─(넘김)─▶ https://서버:9443 ─▶ proxy(nginx, TLS) ─▶ app(web_serve.py :8788, 내부망)
```

| 서비스 | 이미지(`Dockerfile` target) | 하는 일 |
|---|---|---|
| `app` | `app` (python:3.12-alpine) | 정적 화면 `web/`, `/api/jira`·`/api/trombone` 프록시. Host·Origin 검사와 보안 머리말(CSP 등). 바깥에 포트를 열지 않는다 |
| `proxy` | `proxy` (nginx:1.27-alpine) | 8080 → HTTPS 넘김·`/healthz`, 8443 HTTPS → `app`. 인증서가 없으면 첫 기동 때 자체 서명 인증서를 만든다 |

## 왜 HTTPS 인가

브라우저(Chrome·Edge)는 폴더·파일 선택 창(File System Access API)을 **보안 출처(HTTPS·localhost)** 에서만 연다. `http://IP:포트` 로 열면 폴더 선택이 동작하지 않는다.
근거: [MDN showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker), [MDN Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

- 자체 서명 인증서라 처음 들어갈 때 "연결이 비공개로 설정되어 있지 않습니다" 경고가 뜬다. `고급` > `계속` 을 한 번 누른다.
- 인증서는 `deploy/certs/` 에 남아 다시 띄워도 같은 것을 쓴다. `CERT_HOST` 를 바꾸면 다음 기동 때 자체 서명 인증서를 알아서 다시 만든다(`certs/.self-signed` 표시가 있는 것만).
- 사내 정식 인증서가 생기면 `certs/server.crt`·`server.key` 를 바꾸고 **`certs/.self-signed` 를 지운 뒤** `docker compose restart`. 표시가 없으면 스크립트가 인증서를 건드리지 않는다.
- 경고 없이 쓰려면 정식 인증서(접속 주소가 인증서에 들어 있고, 팀원 PC 가 그 CA 를 믿어야 한다)를 받거나, 이 자체 서명 인증서를 팀원 PC 키체인에 "신뢰"로 등록한다.

## 띄우기

필요한 것: Docker, Docker Compose. 서버에 Python 이 없어도 된다.

```bash
cd deploy
cp .env.example .env     # 포트, 접속 주소(CERT_HOST)를 확인한다. 서버면 CERT_HOST=10.255.17.161,dobbys.okestro.com
DOBBYS_COMMIT=$(git log -1 --format=%h) DOBBYS_COMMIT_DATE=$(git log -1 --format=%cs) \
IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build
docker compose ps        # app·proxy 가 healthy 면 끝
```

접속: `CERT_HOST` 의 주소마다 `https://<주소>:9443` (또는 `http://<주소>:8091`, 자동으로 넘어간다). 내 PC 면 `https://localhost:9443`.

- `CERT_HOST` 는 쉼표로 여러 주소를 받는다(예: `10.255.17.161,dobbys.okestro.com`). 모두 자체 서명 인증서에 들어가고, `app` 의 허용 주소(`ALLOWED_ORIGINS`)도 주소마다 `https://<주소>:<HTTPS_PORT>` 로 만들어진다(`deploy/app-start.sh`). 목록에 없는 주소로 열면 421 이다.
- DNS 등록 전에는 IP 주소로 바로 쓴다. 도메인으로 쓰려면 PC 의 hosts 파일(macOS `/etc/hosts`, Windows `C:\Windows\System32\drivers\etc\hosts`)에 `10.255.17.161 dobbys.okestro.com` 을 넣는다.
- 브라우저는 설정·Jira token·폴더 권한을 주소(출처)마다 따로 둔다. IP 로 쓰다가 도메인으로 옮기면 ⚙ 설정의 내보내기/가져오기로 설정을 옮기고 폴더·token 은 다시 고른다.

## 새 버전 올리기·되돌리기

```bash
git pull --ff-only
cd deploy && DOBBYS_COMMIT=$(git log -1 --format=%h) DOBBYS_COMMIT_DATE=$(git log -1 --format=%cs) \
IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build

docker image ls dobbys-dashboard-app        # 남아 있는 번호
IMAGE_TAG=<예전 번호> docker compose up -d   # --build 없이 되돌리기
```

## 운영

```bash
docker compose ps
docker compose logs -f proxy app
docker compose restart
docker compose down
curl http://127.0.0.1:8091/healthz           # ok
```

| 환경변수(`.env`) | 기본값 | 뜻 |
|---|---|---|
| `HTTP_PORT` | `8091` | 바깥 HTTP 포트. `/healthz` 만 답하고 나머지는 HTTPS 로 넘긴다 |
| `HTTPS_PORT` | `9443` | 바깥 HTTPS 포트 |
| `CERT_HOST` | `localhost` | 접속 주소 목록(쉼표 구분, IP 또는 도메인). 자체 서명 인증서와 허용 주소에 들어간다 |
| `IMAGE_TAG` | `local` | 이미지 번호(보통 커밋) |
| `DOBBYS_COMMIT`·`DOBBYS_COMMIT_DATE` | 비움 | 사이드바 버전 줄(이미지에 .git 이 없어 빌드 때 굽는다) |
| `JIRA_HOST_SUFFIX` | `.atlassian.net` | `/api/jira` 가 받는 Jira 주소 끝 |
| `TROMBONE_BASE` | 비움 | `/api/trombone` 이 부르는 기획서(TROMBONE) 주소(예: `http://기획서-서버:8088`). 컨테이너에서 닿는 주소여야 한다. 비우면 코멘트 탭이 '서버에 기획서 주소가 설정되지 않았다' 를 보인다 |

포트는 사내 서버의 80(GitLab), 8088(와이어프레임), 8089·8443(AI Office), 8190(SCM)과 겹치지 않게 골랐다.

## 알아 둘 것

- **파일은 서버로 가지 않는다.** 서버는 화면 파일과 Jira·기획서 전달만 한다. 엑셀·md 는 각자 브라우저가 읽고, 코멘트 체크리스트 md 도 브라우저가 직접 쓴다.
- **기획서 주소는 서버만 정한다.** 브라우저가 대상 주소를 보내지 않는다(사내망 열린 프록시 방지). 기획서 로그인 비밀번호·token 은 지나가기만 하고 저장·로그되지 않는다.
- **nginx 접근 로그는 쿼리를 남기지 않는다**(`noquery` 형식). `/api/jira` 쿼리에 Jira accountId·이슈 키가 실린다. `app` 로그도 메서드·경로·상태만.
- **기본 이미지**를 Docker Hub 에서 받는다. 막히면 `docker compose build --build-arg PYTHON_IMAGE=<사내 주소>/python:3.12-alpine --build-arg NGINX_IMAGE=<사내 주소>/nginx:1.27-alpine`.
- **Chrome·Edge 전용.** Safari·Firefox 에는 폴더 선택 기능이 없다.
- `deploy/.env`, `deploy/certs/` 는 서버마다 다르므로 저장소에 올리지 않는다(.gitignore).
