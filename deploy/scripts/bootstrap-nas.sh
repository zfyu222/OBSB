#!/bin/sh
set -eu

ROOT=/volume2/OBSB
PROJECT="$ROOT/project"
STAGE=${1:-/tmp/obsidiansb-stage}
DOCKER=/var/packages/ContainerManager/target/usr/bin/docker
COMPOSE="$PROJECT/bin/docker-compose"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo sh $0 $STAGE" >&2
    exit 1
fi

for required in AGENTS.md docs deploy versions.lock .gitignore bin/docker-compose artifacts/obsidian-livesync.tar.gz; do
    if [ ! -e "$STAGE/$required" ]; then
        echo "Missing staged deployment artifact: $STAGE/$required" >&2
        exit 1
    fi
done

if [ ! -x "$DOCKER" ]; then
    echo "Container Manager Docker CLI not found at $DOCKER" >&2
    exit 1
fi

if (ss -lnt 2>/dev/null || netstat -lnt 2>/dev/null) | grep -q ':15984[[:space:]]'; then
    if ! "$DOCKER" inspect brain-couchdb >/dev/null 2>&1; then
        echo "Port 15984 is already in use by an unknown service; refusing deployment." >&2
        exit 1
    fi
    echo "Port 15984 is already held by this deployment's CouchDB container; continuing idempotently."
fi

mkdir -p \
    "$PROJECT/bin" "$PROJECT/deploy" "$PROJECT/docs" \
    "$PROJECT/vault/InBox" "$PROJECT/vault/Raw/项目" "$PROJECT/vault/Raw/领域" \
    "$PROJECT/vault/Raw/归档" "$PROJECT/vault/Drived/整理日志" "$PROJECT/vault/Assets" \
    "$PROJECT/vault/.livesync" \
    "$ROOT/runtime/couchdb/data" "$ROOT/runtime/livesync/db" "$ROOT/runtime/logs" \
    "$ROOT/runtime/build" "$ROOT/worktrees" "$ROOT/secrets"

cp "$STAGE/AGENTS.md" "$PROJECT/AGENTS.md"
cp "$STAGE/.gitignore" "$PROJECT/.gitignore"
cp "$STAGE/versions.lock" "$PROJECT/versions.lock"
cp -R "$STAGE/docs/." "$PROJECT/docs/"
cp -R "$STAGE/deploy/." "$PROJECT/deploy/"
cp "$STAGE/bin/docker-compose" "$COMPOSE"
chmod 755 "$COMPOSE" "$PROJECT/deploy/scripts/"*.sh

cp "$PROJECT/deploy/vault.gitignore" "$PROJECT/vault/.gitignore"
cp "$PROJECT/deploy/livesync.ignore" "$PROJECT/vault/.livesync/ignore"

chmod 700 "$ROOT/secrets"
if [ ! -f "$ROOT/secrets/deployment-secrets.txt" ]; then
    COUCHDB_ADMIN_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
    SYNC_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
    E2EE_PASSPHRASE=$(openssl rand -base64 48 | tr -d '\n')
    SETUP_URI_PASSPHRASE=$(openssl rand -base64 24 | tr -d '\n')
    cat > "$ROOT/secrets/deployment-secrets.txt" <<EOF
COUCHDB_ADMIN_USER=obsidiansb_admin
COUCHDB_ADMIN_PASSWORD=$COUCHDB_ADMIN_PASSWORD
SYNC_USER=obsidiansb_sync
SYNC_PASSWORD=$SYNC_PASSWORD
COUCHDB_DATABASE=obsidiansb
E2EE_PASSPHRASE=$E2EE_PASSPHRASE
SETUP_URI_PASSPHRASE=$SETUP_URI_PASSPHRASE
EOF
    chmod 600 "$ROOT/secrets/deployment-secrets.txt"
fi
. "$ROOT/secrets/deployment-secrets.txt"

cat > "$ROOT/secrets/couchdb-admin.env" <<EOF
COUCHDB_USER=$COUCHDB_ADMIN_USER
COUCHDB_PASSWORD=$COUCHDB_ADMIN_PASSWORD
EOF
chmod 600 "$ROOT/secrets/couchdb-admin.env"

chown -R 1026:100 "$PROJECT" "$ROOT/runtime/livesync" "$ROOT/worktrees" "$ROOT/secrets"
chown -R 5984:5984 "$ROOT/runtime/couchdb/data"

# This root is a normal Btrfs directory, not a DSM shared folder.  Use ordinary
# POSIX permissions so each container can reach only the paths it needs.
find "$PROJECT" -type d -exec chmod 755 {} +
find "$PROJECT" -type f -exec chmod 644 {} +
chmod 755 "$COMPOSE" "$PROJECT/deploy/scripts/"*.sh
find "$PROJECT/vault" -type d -exec chmod 750 {} +
find "$PROJECT/vault" -type f -exec chmod 640 {} +
chmod 700 "$ROOT/runtime/couchdb/data" "$ROOT/runtime/livesync/db" "$ROOT/worktrees" "$ROOT/secrets"
chmod 600 "$ROOT/secrets/"*

echo "Verifying pinned Compose binary..."
echo 'db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576  '"$COMPOSE" | sha256sum -c -
"$COMPOSE" version
"$COMPOSE" -f "$PROJECT/deploy/compose.yaml" config >/dev/null

SOURCE_ARCHIVE="$STAGE/artifacts/obsidian-livesync.tar.gz"
echo '5d80f1b30581a4f9df6f9e9f466411390ba31290caecc4a5520a7de6a17e90d1  '"$SOURCE_ARCHIVE" | sha256sum -c -
rm -rf "$ROOT/runtime/build/obsidian-livesync-source"
mkdir -p "$ROOT/runtime/build/obsidian-livesync-source"
tar -xzf "$SOURCE_ARCHIVE" --strip-components=1 -C "$ROOT/runtime/build/obsidian-livesync-source"

echo "Pulling pinned images..."
"$DOCKER" pull couchdb:3.5.2.1@sha256:199ff89f9a930df6032a216570ae0169fcc36c449bb02b40fafeb6efecdb606f
"$DOCKER" pull alpine/git:2.49.1@sha256:53a6239398162098fed2f49a46512f9cbba9e3f31b9f2cea4fa90129ee069a99

echo "Building pinned LiveSync CLI image..."
"$DOCKER" build \
    -f "$PROJECT/deploy/livesync/Dockerfile" \
    -t obsidiansb/livesync-cli:1.0.30 \
    "$ROOT/runtime/build/obsidian-livesync-source"

if [ ! -f "$ROOT/secrets/livesync-settings.json" ]; then
    "$DOCKER" run --rm \
        -v "$ROOT/secrets:/out" \
        obsidiansb/livesync-cli:1.0.30 \
        init-settings /out/livesync-settings.json
fi

python3 - "$ROOT/secrets/livesync-settings.json" <<'PY'
import json
import os
import sys

path = sys.argv[1]
secrets = {}
with open('/volume2/OBSB/secrets/deployment-secrets.txt', encoding='utf-8') as fh:
    for line in fh:
        key, value = line.rstrip('\n').split('=', 1)
        secrets[key] = value
with open(path, encoding='utf-8') as fh:
    data = json.load(fh)
data.update({
    'remoteType': 'couchdb',
    'couchDB_URI': 'http://brain-couchdb:5984',
    'couchDB_USER': secrets['SYNC_USER'],
    'couchDB_PASSWORD': secrets['SYNC_PASSWORD'],
    'couchDB_DBNAME': secrets['COUCHDB_DATABASE'],
    'liveSync': True,
    'syncOnStart': False,
    'syncOnSave': False,
    'usePluginSync': False,
    'syncInternalFiles': False,
    'encrypt': True,
    'passphrase': secrets['E2EE_PASSPHRASE'],
    'usePathObfuscation': False,
    'isConfigured': True,
})
with open(path, 'w', encoding='utf-8') as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write('\n')
PY
chown 1026:100 "$ROOT/secrets/livesync-settings.json"
chmod 600 "$ROOT/secrets/livesync-settings.json"

echo "Initialising independent Git repositories..."
GIT_IMAGE=alpine/git:2.49.1@sha256:53a6239398162098fed2f49a46512f9cbba9e3f31b9f2cea4fa90129ee069a99
"$DOCKER" run --rm --entrypoint /bin/sh \
    -v "$PROJECT:/repo" -w /repo "$GIT_IMAGE" -c '
        git config --global --add safe.directory /repo
        if [ ! -d .git ]; then git init -b main; fi
        git config user.name "Second Brain Bootstrap"
        git config user.email "second-brain@local"
        git add AGENTS.md docs deploy versions.lock .gitignore
        if ! git diff --cached --quiet; then
            git commit -m "Initialize second-brain framework"
        fi
    '
chown -R 1026:100 "$PROJECT/.git"
"$DOCKER" run --rm --entrypoint /bin/sh \
    -v "$PROJECT/vault:/repo" -w /repo "$GIT_IMAGE" -c '
        git config --global --add safe.directory /repo
        if [ ! -d .git ]; then git init -b main; fi
        git config user.name "Second Brain Bootstrap"
        git config user.email "second-brain@local"
        git add .gitignore .livesync/ignore
        if ! git diff --cached --quiet; then
            git commit -m "Initialize empty knowledge vault"
        fi
    '
chown -R 1026:100 "$PROJECT/vault/.git"

echo "Starting CouchDB..."
"$COMPOSE" -f "$PROJECT/deploy/compose.yaml" up -d couchdb

attempt=0
until curl --fail --silent --show-error \
    -u "$COUCHDB_ADMIN_USER:$COUCHDB_ADMIN_PASSWORD" \
    http://10.0.0.81:15984/_up >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
        echo "CouchDB did not become healthy." >&2
        "$COMPOSE" -f "$PROJECT/deploy/compose.yaml" logs --tail 100 couchdb
        exit 1
    fi
    sleep 2
done

"$PROJECT/deploy/scripts/provision-couchdb.sh"

echo "Starting LiveSync CLI..."
"$COMPOSE" -f "$PROJECT/deploy/compose.yaml" up -d livesync-cli
sleep 5
"$COMPOSE" -f "$PROJECT/deploy/compose.yaml" ps

echo "Server deployment finished. Secrets remain only under $ROOT/secrets."
