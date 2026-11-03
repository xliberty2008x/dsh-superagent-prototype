#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
APP_ROOT="${0:A:h:h:h:h}"
LISTENER_PID="$(/usr/sbin/lsof -t -iTCP:3088 -sTCP:LISTEN 2>/dev/null | /usr/bin/sort -u || true)"
if [[ -n "$LISTENER_PID" ]]; then
  exec node "$APP_ROOT/source/integration/macos/reopen-ui.mjs" "$APP_ROOT/ui-browser-handoff.json" "$LISTENER_PID"
fi
if [[ ! -d "$APP_ROOT/harness-home/profiles/ui" ]]; then
  print -u2 'Перенесення профілю ще не завершено. Збережена авторизація не змінена.'
  exit 1
fi
cd "$APP_ROOT"
print 'Запускаю Superagent і штатний вхід у браузері. Залиш Terminal відкритим; зупинка Ctrl+C.'
print -r -- "$$" > "$APP_ROOT/ui.pid"
exec /usr/bin/env -u OPENAI_API_KEY DSH_HOME="$APP_ROOT/harness-home" "$APP_ROOT/runtime/node_modules/.bin/dsh" ui "$@"
