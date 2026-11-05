#!/bin/sh
# 로그인 때 대시보드를 띄우고 죽으면 다시 띄운다. 다시 실행하면 등록을 갈아끼운다.
set -eu
LABEL=com.dobbys-dashboard
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$(command -v python3)"
PORT="${PORT:-8787}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/dobbys-dashboard"
"$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 11))' || { echo "Python 3.11 이상이 필요하다: $PYTHON" >&2; exit 1; }
mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key><array><string>$PYTHON</string><string>serve.py</string></array>
	<key>WorkingDirectory</key><string>$REPO</string>
	<key>EnvironmentVariables</key><dict>
		<key>PORT</key><string>$PORT</string>
		<key>PYTHONUNBUFFERED</key><string>1</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>10</integer>
	<key>ProcessType</key><string>Background</string>
	<key>StandardOutPath</key><string>$LOGS/stdout.log</string>
	<key>StandardErrorPath</key><string>$LOGS/stderr.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "등록했다: http://127.0.0.1:$PORT/  (로그 $LOGS)"
