# 작업 규칙

## 저장소와 체크아웃

- 원본은 GitHub `devseongeun/dobbys-dashboard` 다. `~/workspace/dobbys-dashboard`의 `origin`에는 push URL이 둘(GitHub + 사내 scm `okestro/dobbys-dashboard`) 등록돼 있어 `git push origin main` 한 번에 양쪽에 올라간다. **scm에 따로 push하지 않는다.**
- scm `main`은 protected branch 라 force push 가 막혀 있다. 이력 재작성이 필요하면 사용자가 브랜치 보호에서 force push 금지를 잠시 풀어야 한다.
- 로컬 체크아웃은 둘이다.
  - `~/workspace/dobbys-dashboard` — 편집·커밋·push 하는 곳.
  - `~/workspace/scm/okestro/dobbys-dashboard` — launchd(`com.dobbys-dashboard`)가 서버를 띄우는 곳. **직접 편집·커밋하지 않는다.**

## 커밋·push·반영 — 묻지 않고 한 번에 한다

사용자가 "커밋해줘"라고 하면 승인안을 따로 묻지 않고 아래를 순서대로 끝까지 한다.

1. `~/workspace/dobbys-dashboard`에서 관련 파일만 stage(`git add <경로>`, `-A`·`.` 금지)하고 커밋한다.
   - 메시지는 `type: 제목` 한글 -다체(`[저장소명]` 접두사 없음). AI가 작성했으면 `Co-Authored-By: Claude …`(이메일 없이), 동작 코드면 `Tested:`/`Not-tested:`.
2. `git push origin main` (GitHub·scm 동시).
3. `~/workspace/scm/okestro/dobbys-dashboard`는 대시보드 사이드바의 **⬆ 업데이트** 버튼(= `scripts/update.sh`)이 pull·재시작을 한 번에 한다. 터미널에서는 `git pull --ff-only` 뒤 4번. 거기서 커밋을 만들지 않는다.
4. `launchctl kickstart -k gui/$(id -u)/com.dobbys-dashboard`로 재시작하고 `http://127.0.0.1:8787/`이 200인지 본다.
