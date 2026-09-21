#!/bin/sh
set -eu

ROOT=/volume2/OBSB
PROJECT="$ROOT/project"
DOCKER=/var/packages/ContainerManager/target/usr/bin/docker
COMPOSE="$PROJECT/bin/docker-compose"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo sh $0" >&2
    exit 1
fi
. "$ROOT/secrets/deployment-secrets.txt"

echo "== compose =="
"$COMPOSE" -f "$PROJECT/deploy/compose.yaml" ps

echo "== couchdb unauthenticated =="
code=$(curl --silent -o /dev/null -w '%{http_code}' http://10.0.0.81:15984/_up || true)
test "$code" = 401
echo "HTTP $code (expected 401)"

echo "== couchdb sync account =="
code=$(curl --silent -o /dev/null -w '%{http_code}' \
    -u "$SYNC_USER:$SYNC_PASSWORD" http://10.0.0.81:15984/obsidiansb || true)
test "$code" = 200
echo "HTTP $code (expected 200)"

echo "== couchdb admin endpoint denied to sync account =="
code=$(curl --silent -o /dev/null -w '%{http_code}' \
    -u "$SYNC_USER:$SYNC_PASSWORD" http://10.0.0.81:15984/_node/_local/_config || true)
case "$code" in 401|403) ;; *) echo "Unexpected HTTP $code" >&2; exit 1 ;; esac
echo "HTTP $code (expected 401 or 403)"

echo "== LiveSync recent logs =="
"$COMPOSE" -f "$PROJECT/deploy/compose.yaml" logs --tail 80 livesync-cli

echo "== excluded paths in remote listing =="
"$DOCKER" exec brain-livesync-cli livesync-cli \
    --settings /run/secrets/livesync-settings.json ls 2>/dev/null | \
    grep -E '(^|/)(\.git|\.obsidian|@eaDir|#recycle)(/|$)' && {
        echo "Excluded path found in LiveSync database." >&2
        exit 1
    } || true

echo "Server-side checks completed."
