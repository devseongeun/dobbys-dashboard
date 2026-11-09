# dobbys-dashboard

업무 도구 여러 개를 한 화면 사이드바에 모은 로컬 대시보드다. 필요한 탭만 골라 켠다.

**한 번에 한 프로젝트만 본다.** 온보딩에서 프로젝트 이름(예: `TRB 4.0.0`)을 적고 그 프로젝트의 폴더·파일을 Finder에서 고른다. 지난 프로젝트 자료는 Obsidian에서 본다.

| id | 사이드바 이름 | 필요한 설정 | 로그인 위치 |
|---|---|---|---|
| `wbs` | 📅 WBS·Jira | 일정 기준(WBS 엑셀 / Jira), Jira 도메인·프로젝트 키. WBS 기준이면 WBS 엑셀 파일·담당자 이름(시트 이름은 기본값 있음) | 탭 안(Jira, WBS 기준이면 선택) |
| `assets` | 🗂️ 의사결정 현황 | 의사결정 문서 폴더 | 없음 |
| `plans` | 🛠️ 구현 진행 현황 | 구현 계획 폴더 | 없음 |
| `comments` | 💬 기획서 코멘트 현황 | 기획서(TROMBONE) 주소, 체크리스트 저장 폴더(선택) | 탭 안(TROMBONE) |
| `meetings` | 📎 회의 자료 | Vault 안 회의 폴더 | 없음 |
| `weekly` | 📝 주간 보고 (실험실) | 주간 보고 폴더(여러 개 가능) | 없음 |

## 요구 사항

- macOS
- Python 3.11 이상(`python3 --version`으로 확인한다). 표준 라이브러리만 쓴다.
- Obsidian Vault(회의 자료 탭)

## 설치

```
git clone https://github.com/devseongeun/dobbys-dashboard.git ~/workspace/dobbys-dashboard
cd ~/workspace/dobbys-dashboard && python3 serve.py
```

그다음 `http://127.0.0.1:8787/`을 열면 온보딩이 뜬다. 프로젝트 이름을 적은 뒤 "WBS와 Jira 일정을 한눈에 보고 관리하고 싶어요" 같은 질문에 하나씩 예·아니요로 답한다. 예라고 답한 탭만 켜지고, 그 탭의 경로·옵션은 같은 화면에서 바로 정한다. 경로는 직접 적지 않는다. **폴더 선택**·**파일 선택**·**폴더 추가**(여러 폴더 칸)를 누르면 서버가 Finder 선택 창(`osascript`, `dashboard/picker.py`)을 띄우고 고른 절대 경로를 채운다. 선택 창이 브라우저 뒤에 뜨면 Dock에서 찾는다. 마지막 확인 화면에서는 탭마다 토글로 켜고 끄고, 탭 이름을 누르면 그 자리에 입력 항목이 펼쳐진다(켜면 바로 펼쳐지고, 저장 오류가 난 탭도 펼쳐진다). 확인 화면에서 저장한다. 온보딩에서 적은 값은 저장한 뒤에도 바꿀 수 있다. ⚙ 설정은 확인 화면과 같은 탭 편집 화면(토글 + 아코디언, `shell/onboarding.js`의 `tabEditor`)에 프로젝트 이름 칸을 더한 것으로, 한 화면에서 프로젝트 이름, 탭 켜기·끄기, 경로를 고친다.

문서 안 형식에서 상태를 읽는 탭(의사결정 현황, 구현 진행 현황, 주간 보고)은 그 탭 질문에 예라고 답한 화면, 확인 화면, ⚙ 설정에서 **문서 템플릿**을 내려받는다. 템플릿을 설정한 폴더에 넣고 제목과 값만 고치면 탭이 경고 없이 읽는다. 파일명은 고정(`YYYY-MM-DD 계획 제목.md`처럼 날짜 자리는 직접 채운다)이고, 본문의 작성일·갱신일만 내려받는 날로 채워진다. 원본은 `tabs/<id>/templates/`다.

## 팀 공용 Claude Code 스킬

이 저장소는 Claude Code 플러그인 마켓이기도 하다(`.claude-plugin/`). Claude Code에서 한 번 설치하면 어느 폴더에서든 쓴다. GitHub 저장소 읽기 권한이 있어야 한다.

```
/plugin marketplace add devseongeun/dobbys-dashboard
/plugin install dobbys-dashboard@dobbys-dashboard
```

| 스킬 | 요청 예 | 하는 일 |
|---|---|---|
| `weekly-report-draft` (실험실) | "이번 주 주간 보고 초안 써줘" | 이번 주 내 커밋(`git config user.email`)과 Jira 이슈로 주간 보고 탭의 표준 섹션 형식(`tabs/weekly/templates/`) 초안을 쓴다. 업무 묶음을 확인받은 뒤 ⚙ 설정의 주간 보고 첫 폴더에 `YYYY-MM-DD 주간 보고.md`로 저장한다. |

새 버전은 이 저장소에 push하면 팀원이 `/plugin marketplace update dobbys-dashboard` 뒤 `/plugin update dobbys-dashboard@dobbys-dashboard`로 받는다. 스킬은 `skills/<이름>/SKILL.md`에 둔다.

## 상주 실행

`scripts/install-launchd.sh`를 실행하면 로그인 때 대시보드를 띄우고, 죽으면 다시 띄운다. 다시 실행하면 등록을 갈아끼운다.

- 재시작: `launchctl kickstart -k gui/$(id -u)/com.dobbys-dashboard`
- 중지: `launchctl bootout gui/$(id -u)/com.dobbys-dashboard`
- 로그: `~/Library/Logs/dobbys-dashboard/`

서버 코드를 고친 뒤에는 재시작이 필요하다.

상주 실행 중에는 macOS 개인정보 보호(TCC) 때문에 Python이 `~/Downloads`·`~/Desktop`의 파일을 읽지 못하고, 권한 창을 기다리며 멈춘다(WBS 엑셀이 `~/Downloads`에 있으면 WBS 탭이 응답하지 않는다). WBS 엑셀과 설정한 폴더는 모두 `~/Downloads`·`~/Desktop` 밖(예: Vault 안)에 둔다. macOS가 "Python … 폴더의 파일에 접근하려고 합니다"를 띄우면 허용하거나, 파일을 옮기고 ⚙ 설정에서 경로를 고친 뒤 `launchctl kickstart -k gui/$(id -u)/com.dobbys-dashboard`로 재시작한다.

## 업데이트

사이드바 맨 아래에 현재 커밋(`10ac8f8 · 2026-11-06`)이 보인다. 서버가 열 때와 30분마다 `origin`을 받아 비교하고, 새 커밋이 있으면 그 위에 **⬆ 업데이트 N건**이 뜬다(마우스를 올리면 커밋 제목). 누르면 `git pull --ff-only` 뒤 서버가 같은 자리에서 다시 떠서 화면이 새로고침된다. launchd 상주든 터미널에서 `python3 serve.py`로 띄웠든 같다.

- 자동 업데이트를 거절하는 경우: 커밋하지 않은 로컬 변경이 있거나, 로컬 커밋이 `origin`보다 앞서 있을 때. 링크가 붉게 바뀌고 이유를 보여 준다. 정리한 뒤 다시 누른다.
- `git clone`이 아니라 압축으로 받았으면 git 저장소가 아니라 표시 자체가 없다.
- 터미널에서: `scripts/update.sh`. 같은 일을 하고, launchd 등록이 있으면 재시작까지 한다.

## 프로젝트 바꾸기

버전이 올라가거나 다른 프로젝트를 맡으면 ⚙ 설정에서 프로젝트 이름과 경로(WBS 엑셀, 폴더들, Jira 프로젝트 키, 기획서 주소)를 고치고 저장한다. 저장하면 탭을 다시 띄우므로 재시작은 필요 없다.

개인 상태(WBS↔Jira 수동 연결, 일정 조정 초안, 코멘트 우선순위·보류, 주간 보고 확인)는 프로젝트 이름 아래에 따로 저장된다. 이름을 바꾸면 빈 상태에서 시작하고, 이전 이름으로 돌아오면 그대로 복원된다. WBS ID나 코멘트 id가 프로젝트마다 다시 매겨져도 섞이지 않는다.

## 설정·데이터 위치

| 종류 | 위치 |
|---|---|
| 설정 | `~/.config/dobbys-dashboard/config.json` (0600) |
| 개인 상태 | `~/Library/Application Support/dobbys-dashboard/<프로젝트>/<tab>/` |
| 캐시 | `~/Library/Caches/dobbys-dashboard/` |
| 비밀값 | 키체인 `dobbys-dashboard.jira`·`dobbys-dashboard.trombone` (계정 `default`) |

설정을 초기화하려면 `config.json`을 지우고 서버를 재시작한 뒤(상주 실행이면 `launchctl kickstart -k gui/$(id -u)/com.dobbys-dashboard`, 직접 띄웠으면 Ctrl+C 후 `python3 serve.py`) 새로고침한다. 서버는 설정을 시작할 때 한 번만 읽는다.

프로젝트 이름이 없는 옛 `config.json`은 온보딩(값은 미리 채워짐)으로 보내고, 옛 `Application Support/dobbys-dashboard/<tab>/`은 처음 이름을 저장할 때 그 이름 아래로 옮긴다.

## 탭별 메모

- **WBS**: 일정 기준을 고른다. **WBS 엑셀 기준**은 엑셀의 내 행이 기본이고 Jira는 선택이다. 수동 연결이 먼저고, WBS 제목이 정확히 한 Jira 이슈와만 맞을 때만 자동으로 잇는다. **Jira 기준**은 엑셀 없이 탭 안에서 Jira에 로그인해 내 담당 이슈만 본다(엑셀 칸은 숨고 저장하지 않는다). 기준이 없는 옛 config는 WBS 엑셀 기준이다. API token은 `https://id.atlassian.com/manage-profile/security/api-tokens`에서 만든다.
  - 보드 칸은 할 일 → 진행 → 개발완료 → 완료 | 취소 | 기타 순이다. Jira 상태가 앞의 다섯이면 그 칸에, 아니면(Jira 미연결 포함) 기타 칸에 놓는다. Jira 상태가 다섯이 아닌 카드는 카드 아래 칸 선택으로 보드 칸과 상태 필터를 정할 수 있고, 개인 상태의 `wbs/status-assign.json`에 저장된다. Jira에는 보내지 않는다. Jira 상태가 다섯 중 하나로 바뀌면 Jira 값이 우선한다.
- **의사결정 현황**: 폴더 이름은 자유다(예: `90-assets`). 폴더 바로 아래 HTML 하나가 문서 한 건이고, 메타데이터는 문서 안에서 읽는다. 템플릿: `tabs/assets/templates/`.
  - 기능 구분·작성일: `<head>`의 `<meta name="feature" content="DB 설계, 배포">`·`<meta name="created" content="2026-09-17">`. 없으면 경고하고 `-`로 둔다.
  - 상태: 상단 문의 현황 표 `<section class="docst" data-doc="open|closed">`와 그 안의 `회신 대상<b>…</b>`·`집계<b>미결 n · 완료 n · 취소됨 n</b>`·`최종 갱신<b>YYYY-MM-DD</b>`. 표가 없으면 참고 문서다.
  - 화면 이름: 파일명에서 `프로젝트_버전_` 접두어(예: `TRB_4.0.0_`)와 끝의 `_v1.0`을 떼고 밑줄을 공백으로 바꾼다.
  - 목록 `00_<폴더명>_목록.md`·`.html`은 자동 생성이고 `00_`으로 시작하는 파일은 목록에서 뺀다.
- **구현 진행 현황**: 폴더 이름은 자유다(예: `10-plans`). 폴더 바로 아래 `YYYY-MM-DD 제목.md` 하나가 계획 한 건이고, 하위 폴더는 보지 않는다. 템플릿: `tabs/plans/templates/`.
  - frontmatter 한 줄짜리 키만 읽는다: `status`(할 일·진행 중·완료, 없으면 참고), `progress`(0–100), `feature`(`A, B` 또는 `[A, B]`, 없으면 미분류), `updated`·`created`(최종 갱신).
  - 체크는 펜스 코드 블록 밖의 `- [ ]`·`- [x]`를 센다. 완료인데 `[ ]`가 남으면 ⚠.
  - 목록 `00_<폴더명>_목록.md`·`.html`은 자동 생성이다.
- **기능 구분 표에서 옮기기**: 예전 `00_<폴더명>_기능구분.md` 표를 쓰던 폴더는 `python3 scripts/migrate-features.py --assets <폴더> --plans <폴더> [--dry-run]`으로 각 문서 안에 meta·`feature`를 넣고 표를 지운다.
- **코멘트**: 사내망(VPN)이 필요하다. 👀는 토글이라 직전 상태를 확인하고 보낸다.
- **회의 자료**: 대시보드에서 편집할 때는 Obsidian에서 같은 Canvas를 닫는다.
  - 회의 폴더의 `YYYY-MM-DD 회의명.canvas` 하나가 회의 한 건, Canvas 그룹 하나가 블록 하나다. 대시보드에서 `+ 회의`·`+ 블록`으로 만들고, 회의·블록 이름을 눌러 바꾸고, 왼쪽 Vault 트리(검색 가능)의 파일을 블록으로 끌어다 놓아 담고, 블록의 `+ 링크`로 OneDrive 같은 웹 페이지를 넣는다. 카드는 ⠿로 끌어 블록 안 순서를 바꾸거나 다른 블록으로 옮기고, ✕로 회의에서 뺀다(파일은 지우지 않는다). 블록 안 순서는 회의 폴더의 `.order/<회의 id>.json`에만 저장되고 Canvas 배치는 그대로다. 다른 블록으로 옮기거나 새로 넣은 카드는 그 그룹 맨 아래에 놓이고, 그룹이 모자라면 늘어나며 그 아래 카드가 밀린다. Obsidian Canvas에서 직접 고쳐도 되고, 그룹에 완전히 들어가지 않은 카드는 `미분류` 블록에 모인다. 자료 조사 메모는 Obsidian Canvas에서 텍스트 카드로 넣는다. Obsidian에서 고친 뒤에는 ⟳로 다시 읽는다. 열린 Canvas를 Obsidian이 저장하면 대시보드 변경을 덮어쓸 수 있다. 그사이 Canvas가 바뀌었으면 저장하지 않고 다시 불러온다. 대시보드에서 회의 이름을 바꾸면 다른 노트의 그 Canvas 링크는 고쳐지지 않는다. md는 대시보드 안에서 렌더, html·PDF·이미지는 iframe으로 보여 주고, 그 밖의 형식과 원본은 `Obsidian에서 열기`로 연다.
- **주간 보고 (실험실)**: 실험 중인 탭이라 형식·화면이 바뀔 수 있다. 폴더 여러 개를 쓸 수 있다. AI 브리핑은 초안의 표준 섹션(보고 기간·이번 주 핵심 업무·업무별 상세 내용·정량 지표·금주/차주 주요 사항·이슈 및 기타 사항·PPT 붙여넣기용·출처 및 검증·PPT 처리)을 찾아 배치한다. 섹션별 쓰는 법은 뷰어의 `표준 섹션 안내`에서 보고, 템플릿은 그 창이나 온보딩·⚙ 설정에서 내려받는다: `tabs/weekly/templates/`. Claude Code를 쓰면 [팀 공용 스킬](#팀-공용-claude-code-스킬) `weekly-report-draft`가 같은 형식으로 초안을 쓴다.

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

최초 온보딩을 다시 보려면 `sh scripts/sandbox.sh`(기본 포트 8790, `PORT=…`로 변경)를 실행하고 `http://127.0.0.1:8790/`을 연다. 임시 `HOME`에서 빈 설정으로 뜨므로 실제 설정·상태는 그대로고, 끄면 임시 폴더를 지운다. Finder 선택 창은 실제 디스크를 보여 주므로 고른 경로도 실제 폴더다. 키체인은 실제 것을 쓰므로 샌드박스 탭 안에서는 로그인하지 않는다.

탭을 추가하려면 `tabs/<id>/__init__.py`에서 `TAB`을 내보내고, `tabs/__init__.py`의 `ALL_TABS`에 넣는다. 첫 온보딩에서 물을 불편 지점은 `Tab(question=…, summary=…)`에 적는다(비면 "탭을 쓸까요?"로 묻는다). 문서 형식이 정해진 탭은 `Tab(templates=(Template(경로, help=…),))`로 템플릿을 붙이면 질문·확인 화면과 ⚙ 설정에 내려받기 링크가 뜬다(`/_dashboard/templates/<id>/<순번>`, 파일명은 그대로, 본문의 `{{TODAY}}`는 오늘 날짜). 실험 중인 탭은 `Tab(experimental=True)`로 두면 사이드바와 탭 편집 화면(확인 화면·⚙ 설정)의 이름 옆에 `실험실`이 붙는다.
