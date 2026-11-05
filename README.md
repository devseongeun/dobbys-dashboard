# dobbys-dashboard

업무 도구 여러 개를 한 화면 사이드바에 모은 로컬 대시보드다. 필요한 탭만 골라 켠다.

| id | 사이드바 이름 | 필요한 설정 | 로그인 위치 |
|---|---|---|---|
| `wbs` | 📅 WBS·Jira | WBS 엑셀 파일, 담당자 이름(시트·Jira 도메인·프로젝트는 기본값 있음) | 탭 안(Jira, 선택) |
| `assets` | 🗂️ 의사결정 현황 | 90-assets 폴더 | 없음 |
| `plans` | 🛠️ 구현 진행 현황 | 10-plans 폴더 | 없음 |
| `comments` | 💬 기획서 코멘트 현황 | 기획서(TROMBONE) 주소(기본값 있음), 체크리스트 저장 폴더(선택) | 탭 안(TROMBONE) |
| `meetings` | 📎 회의 자료 | Vault 안 회의 폴더 | 없음 |
| `weekly` | 📝 주간 보고 | 주간 보고 폴더(여러 개 가능) | 없음 |

## 요구 사항

- macOS
- Python 3.11 이상(`python3 --version`으로 확인한다). 표준 라이브러리만 쓴다.
- Obsidian Vault(회의 자료 탭)

## 설치

```
git clone https://github.com/devseongeun/dobbys-dashboard.git ~/workspace/dobbys-dashboard
cd ~/workspace/dobbys-dashboard && python3 serve.py
```

그다음 `http://127.0.0.1:8787/`을 열면 온보딩이 뜬다.

## 상주 실행

`scripts/install-launchd.sh`를 실행하면 로그인 때 대시보드를 띄우고, 죽으면 다시 띄운다. 다시 실행하면 등록을 갈아끼운다.

- 재시작: `launchctl kickstart -k gui/$(id -u)/com.dobbys-dashboard`
- 중지: `launchctl bootout gui/$(id -u)/com.dobbys-dashboard`
- 로그: `~/Library/Logs/dobbys-dashboard/`

서버 코드를 고친 뒤에는 재시작이 필요하다.

## 설정·데이터 위치

| 종류 | 위치 |
|---|---|
| 설정 | `~/.config/dobbys-dashboard/config.json` (0600) |
| 개인 상태 | `~/Library/Application Support/dobbys-dashboard/<tab>/` |
| 캐시 | `~/Library/Caches/dobbys-dashboard/` |
| 비밀값 | 키체인 `dobbys-dashboard.jira`·`dobbys-dashboard.trombone` (계정 `default`) |

설정을 초기화하려면 `config.json`을 지우고 서버를 재시작한 뒤(상주 실행이면 `launchctl kickstart -k gui/$(id -u)/com.dobbys-dashboard`, 직접 띄웠으면 Ctrl+C 후 `python3 serve.py`) 새로고침한다. 서버는 설정을 시작할 때 한 번만 읽는다.

## 탭별 메모

- **WBS**: 엑셀이 기본이고 Jira는 선택이다. API token은 `https://id.atlassian.com/manage-profile/security/api-tokens`에서 만든다. 수동 연결이 먼저고, WBS 제목이 정확히 한 Jira 이슈와만 맞을 때만 자동으로 잇는다.
- **코멘트**: 사내망(VPN)이 필요하다. 👀는 토글이라 직전 상태를 확인하고 보낸다.
- **회의 자료**: 대시보드에서 편집할 때는 Obsidian에서 같은 Canvas를 닫는다.
  - 회의 폴더의 `YYYY-MM-DD 회의명.canvas` 하나가 회의 한 건, Canvas 그룹 하나가 블록 하나다. 대시보드에서 `+ 회의`·`+ 블록`으로 만들고, 회의·블록 이름을 눌러 바꾸고, 왼쪽 Vault 트리(검색 가능)의 파일을 블록으로 끌어다 놓아 담고, 블록의 `+ 링크`로 OneDrive 같은 웹 페이지를 넣는다. 카드는 ⠿로 끌어 블록 안 순서를 바꾸거나 다른 블록으로 옮기고, ✕로 회의에서 뺀다(파일은 지우지 않는다). 블록 안 순서는 회의 폴더의 `.order/<회의 id>.json`에만 저장되고 Canvas 배치는 그대로다. 다른 블록으로 옮기거나 새로 넣은 카드는 그 그룹 맨 아래에 놓이고, 그룹이 모자라면 늘어나며 그 아래 카드가 밀린다. Obsidian Canvas에서 직접 고쳐도 되고, 그룹에 완전히 들어가지 않은 카드는 `미분류` 블록에 모인다. 자료 조사 메모는 Obsidian Canvas에서 텍스트 카드로 넣는다. Obsidian에서 고친 뒤에는 ⟳로 다시 읽는다. 열린 Canvas를 Obsidian이 저장하면 대시보드 변경을 덮어쓸 수 있다. 그사이 Canvas가 바뀌었으면 저장하지 않고 다시 불러온다. 대시보드에서 회의 이름을 바꾸면 다른 노트의 그 Canvas 링크는 고쳐지지 않는다. md는 대시보드 안에서 렌더, html·PDF·이미지는 iframe으로 보여 주고, 그 밖의 형식과 원본은 `Obsidian에서 열기`로 연다.
- **주간 보고**: 폴더 여러 개를 쓸 수 있다.

## 보안

- `127.0.0.1`(과 `::1`)에만 바인딩한다.
- 모든 경로에서 Host 헤더를 검사한다(`127.0.0.1`, `localhost`, `::1`).
- 쓰기 요청은 `Content-Type: application/json`만 받는다.
- 비밀값은 키체인에만 둔다.

## 개발

```
python3 -m unittest discover -s tests -t . -v
bun test tests/js
```

탭을 추가하려면 `tabs/<id>/__init__.py`에서 `TAB`을 내보내고, `tabs/__init__.py`의 `ALL_TABS`에 넣는다.
