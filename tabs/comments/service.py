"""코멘트 탭 동작. 로그인 token·작성자 이름은 키체인(dobbys-dashboard.trombone)에만 둔다."""
from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

from . import model
from .client import TromboneError
from .markdown import build_markdown

KEY = "trombone"


class NeedLogin(Exception):
    pass


class ExportDisabled(Exception):
    pass


class NothingToExport(Exception):
    pass


class CommentService:
    def __init__(self, client, keychain, overrides, export_dir: Path | None, today=date.today, now=datetime.now):
        self._client = client
        self._keychain = keychain
        self._overrides = overrides
        self._export_dir = Path(export_dir) if export_dir else None
        self._today = today
        self._now = now

    def session(self) -> dict | None:
        creds = self._keychain.get(KEY)
        if not creds or creds.get("base") != self._client.base or not creds.get("token") or not creds.get("name"):
            return None
        return creds

    def describe(self) -> dict:
        creds = self.session()
        return {"loggedIn": creds is not None, "name": creds["name"] if creds else None,
                "base": self._client.base, "exportEnabled": self._export_dir is not None}

    def login(self, login_id: str, password: str) -> str:
        res = self._client.login(login_id, password)
        if not isinstance(res, dict) or not res.get("token") or not res.get("name"):
            raise TromboneError("로그인 응답에 token·name 이 없다")
        self._keychain.set(KEY, {"base": self._client.base, "token": res["token"], "name": res["name"]})
        return res["name"]

    def logout(self) -> None:
        self._keychain.delete(KEY)

    def _collect(self):
        creds = self.session()
        if creds is None:
            raise NeedLogin("로그인이 필요하다")
        rows, pages, answered = model.collect(self._client.inbox(), self._client.bundle, creds["name"], self._overrides.load())
        return creds, rows, pages, answered

    def report(self) -> dict:
        creds, rows, pages, _ = self._collect()
        return {
            "base": self._client.base,
            "pages": model.page_payload(pages),
            "cats": model.category_counts(rows),
            "catColor": model.CATEGORY_COLOR,
            "cfg": {
                "author": creds["name"], "date": self._today().isoformat(),
                "collected": self._now().strftime("%Y-%m-%d %H:%M"),
                "categoryOrder": model.CATEGORY_ORDER, "priorityOrder": list(model.PRIORITY_ORDER),
                "headLimit": model.HEAD_LIMIT_HTML, "decidedEmoji": model.DECIDED_EMOJI,
            },
        }

    def react(self, ids: list[str]) -> dict:
        """방금 읽은 반응으로 이미 👀 가 있으면 건너뛴다(토글 API 라 다시 보내면 떼어진다)."""
        creds, rows, _, _ = self._collect()
        by_id = {r["commentId"]: r for r in rows}
        applied, skipped, failed = 0, 0, []
        for comment_id in dict.fromkeys(ids):
            row = by_id.get(comment_id)
            if row is None:
                failed.append(f"{comment_id}(코멘트 없음)")
                continue
            if row["decided"] or model.locked(row) or model.already_eyed(row, creds["name"]):
                skipped += 1
                continue
            try:
                after = self._client.react(model.target_of(row), model.DECIDED_EMOJI, creds["token"])
            except TromboneError as exc:
                if exc.status == 401:
                    self.logout()
                    raise NeedLogin(f"로그인이 만료됐다. 다시 로그인한다 (반영 {applied}건까지 완료)") from None
                failed.append(f"{comment_id}({exc})")
                continue
            if isinstance(after, list) and creds["name"] not in model.eye_actors({"reactions": after}):
                failed.append(f"{comment_id}(반영 후 확인 실패)")
                continue
            applied += 1
        return {"applied": applied, "skipped": skipped, "failed": failed}

    def export(self) -> Path:
        if self._export_dir is None:
            raise ExportDisabled("⚙ 설정에서 체크리스트 저장 폴더를 지정해야 쓸 수 있다")
        creds, rows, pages, answered = self._collect()
        if not rows:
            raise NothingToExport("내보낼 코멘트가 없다")
        day = self._today().isoformat()
        md = build_markdown(rows, pages, answered, base=self._client.base, author=creds["name"], date=day,
                            collected=self._now().strftime("%Y-%m-%d %H:%M"))
        path = self._export_dir / f"{day} 웹기획서 코멘트 리뷰 체크리스트 ({creds['name']}).md"
        path.write_text(md, encoding="utf-8")
        return path

    def set_override(self, comment_id: str, priority: dict | None, resolved: str | None) -> dict:
        return self._overrides.update(comment_id, priority, resolved)
