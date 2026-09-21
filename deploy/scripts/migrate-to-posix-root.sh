#!/bin/sh
set -eu

OLD_ROOT=/volume2/ObsidianSB
NEW_ROOT=/volume2/OBSB
STAGE=${1:-/tmp/obsidiansb-stage-20260918}
DOCKER=/var/packages/ContainerManager/target/usr/bin/docker
MARKER="$NEW_ROOT/.migrated-from-obsidiansb"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo sh $0 $STAGE" >&2
    exit 1
fi

if [ ! -d "$OLD_ROOT/project" ] || [ ! -d "$OLD_ROOT/secrets" ]; then
    echo "Existing deployment was not found under $OLD_ROOT; refusing migration." >&2
    exit 1
fi
if [ ! -f "$STAGE/deploy/scripts/bootstrap-nas.sh" ]; then
    echo "Updated deployment stage is missing: $STAGE" >&2
    exit 1
fi

if [ -e "$NEW_ROOT" ] && [ ! -f "$MARKER" ]; then
    if find "$NEW_ROOT" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
        echo "$NEW_ROOT contains unknown data; refusing migration." >&2
        exit 1
    fi
fi

echo "Stopping the two Phase 1 containers..."
"$DOCKER" rm -f brain-livesync-cli brain-couchdb >/dev/null 2>&1 || true

if [ ! -f "$MARKER" ]; then
    echo "Copying framework Git, vault Git, notes, attachments, and secrets without DSM ACL metadata..."
    mkdir -p "$NEW_ROOT"
    (
        cd "$OLD_ROOT"
        tar -cf - project secrets
    ) | (
        cd "$NEW_ROOT"
        tar -xpf -
    )
    printf '%s\n' "$OLD_ROOT" > "$MARKER"
    chmod 600 "$MARKER"
fi

echo "Rebuilding the empty runtime under the non-shared directory..."
sh "$STAGE/deploy/scripts/bootstrap-nas.sh" "$STAGE"

echo "Migration completed. The rollback copy remains untouched at $OLD_ROOT."
