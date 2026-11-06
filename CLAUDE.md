# 작업 규칙

## 저장소와 체크아웃

- 원본은 GitHub `devseongeun/dobbys-dashboard` 하나다. 사내 scm(`okestro/dobbys-dashboard`)은 GitHub를 미러링하므로 **따로 push하지 않는다**.
- 로컬 체크아웃은 둘이다.
  - `~/workspace/dobbys-dashboard` — 편집·커밋·push 하는 곳.
  - `~/workspace/scm/okestro/dobbys-dashboard` — launchd(`com.dobbys-dashboard`)가 서버를 띄우는 곳. **직접 편집·커밋하지 않는다.**

## 커밋·push·반영 — 묻지 않고 한 번에 한다

사용자가 "커밋해줘"라고 하면 승인안을 따로 묻지 않고 아래를 순서대로 끝까지 한다.

1. `~/workspace/dobbys-dashboard`에서 관련 파일만 stage(`git add <경로>`, `-A`·`.` 금지)하고 커밋한다.
   - 메시지는 `type: 제목` 한글 -다체(`[저장소명]` 접두사 없음). AI가 작성했으면 `Co-Authored-By: Claude …`(이메일 없이), 동작 코드면 `Tested:`/`Not-tested:`.
2. `git push origin main`.
3. `~/workspace/scm/okestro/dobbys-dashboard`에서 `git pull --ff-only`로 미러를 받는다.
   - 미러 반영이 아직 안 됐으면 잠시 뒤 다시 pull한다. 거기서 커밋을 만들어 메우지 않는다.
4. `launchctl kickstart -k gui/$(id -u)/com.dobbys-dashboard`로 재시작하고 `http://127.0.0.1:8787/`이 200인지 본다.
   - 목록 HTML(`00_*_목록.html`)은 정적 파일이라 재시작만으로 안 바뀐다. 화면 ⟳ 또는 `/<탭>/api/<탭>?refresh=1`로 다시 만든다.

단 force-push·amend·rebase·브랜치 삭제는 이 규칙에 포함되지 않는다. 그때는 묻는다.
