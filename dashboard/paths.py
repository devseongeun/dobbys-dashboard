"""사용자별 설정·상태·캐시 위치와 포트. HOME 을 바꾸면 통째로 옮겨진다(빈 환경 확인용)."""
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
HOME = Path.home()
CONFIG_PATH = HOME / ".config" / "dobbys-dashboard" / "config.json"
STATE_ROOT = HOME / "Library" / "Application Support" / "dobbys-dashboard"
CACHE_ROOT = HOME / "Library" / "Caches" / "dobbys-dashboard"
PORT = int(os.environ.get("PORT", "8787"))
