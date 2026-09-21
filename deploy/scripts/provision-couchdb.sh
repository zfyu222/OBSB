#!/bin/sh
set -eu

ROOT=/volume2/OBSB
. "$ROOT/secrets/deployment-secrets.txt"

NETRC=$(mktemp)
USER_DOC=$(mktemp)
SECURITY_DOC=$(mktemp)
trap 'rm -f "$NETRC" "$USER_DOC" "$SECURITY_DOC"' EXIT INT TERM
chmod 600 "$NETRC" "$USER_DOC" "$SECURITY_DOC"

cat > "$NETRC" <<EOF
machine 10.0.0.81 login $COUCHDB_ADMIN_USER password $COUCHDB_ADMIN_PASSWORD
EOF

python3 - "$SYNC_USER" "$SYNC_PASSWORD" "$USER_DOC" "$SECURITY_DOC" <<'PY'
import json
import sys

username, password, user_doc, security_doc = sys.argv[1:]
with open(user_doc, "w", encoding="utf-8") as fh:
    json.dump({
        "_id": f"org.couchdb.user:{username}",
        "name": username,
        "password": password,
        "roles": [],
        "type": "user",
    }, fh)
with open(security_doc, "w", encoding="utf-8") as fh:
    json.dump({
        "admins": {"names": [], "roles": []},
        "members": {"names": [username], "roles": []},
    }, fh)
PY

BASE=http://10.0.0.81:15984
CURL="curl --fail --silent --show-error --netrc-file $NETRC"

for db in _users _replicator _global_changes obsidiansb; do
    attempt=0
    while :; do
        code=$(curl --silent --show-error --netrc-file "$NETRC" \
            -o /dev/null -w '%{http_code}' -X PUT "$BASE/$db" || true)
        case "$code" in
            201|202|412) break ;;
            500)
                attempt=$((attempt + 1))
                if [ "$attempt" -lt 6 ]; then
                    sleep 2
                    continue
                fi
                ;;
        esac
        echo "Failed to ensure database $db (HTTP $code)" >&2
        exit 1
    done
done

code=$($CURL -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: application/json' -X PUT \
    --data-binary "@$USER_DOC" \
    "$BASE/_users/org.couchdb.user:$SYNC_USER" || true)
case "$code" in
    201|202|409) ;;
    *) echo "Failed to ensure sync user (HTTP $code)" >&2; exit 1 ;;
esac

$CURL -H 'Content-Type: application/json' -X PUT \
    --data-binary "@$SECURITY_DOC" \
    "$BASE/obsidiansb/_security" >/dev/null

echo "CouchDB database and restricted sync account are provisioned."
