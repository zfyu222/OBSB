#!/bin/sh
set -eu

ROOT=/volume2/OBSB
PROJECT="$ROOT/project"
STAGE=${1:-/tmp/obsidiansb-phase2-stage}
DOCKER=/var/packages/ContainerManager/target/usr/bin/docker
COMPOSE="$PROJECT/bin/docker-compose"
OPENCODE_IMAGE='ghcr.io/anomalyco/opencode:2.0.7@sha256:d2c7ddda8142b47942426972fcee07f56ecde762ac7f528c5e53c2f957aabc05'
AGENT_IMAGE='obsidiansb/brain-agent:0.1.0'

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo sh $0 $STAGE" >&2
    exit 1
fi
if [ ! -x "$DOCKER" ] || [ ! -x "$COMPOSE" ]; then
    echo "Container Manager Docker or Compose is unavailable." >&2
    exit 1
fi
for required in AGENTS.md docs deploy tools tests .opencode opencode.jsonc versions.lock; do
    if [ ! -e "$STAGE/$required" ]; then
        echo "Missing staged phase-two artifact: $STAGE/$required" >&2
        exit 1
    fi
done

mkdir -p "$ROOT/runtime/opencode" "$ROOT/secrets" "$PROJECT/.opencode" "$PROJECT/tools" "$PROJECT/tests"
chmod 700 "$ROOT/secrets" "$ROOT/runtime/opencode"

if [ ! -f "$ROOT/secrets/opencode.env" ]; then
    password=$(openssl rand -base64 36 | tr -d '\n')
    umask 077
    cat > "$ROOT/secrets/opencode.env" <<EOF
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=$password
EOF
fi
if [ ! -f "$ROOT/secrets/deepseek.env" ]; then
    umask 077
    printf 'DEEPSEEK_API_KEY=\n' > "$ROOT/secrets/deepseek.env"
fi
chmod 600 "$ROOT/secrets/opencode.env" "$ROOT/secrets/deepseek.env"
chown 1026:100 "$ROOT/secrets/opencode.env" "$ROOT/secrets/deepseek.env"

. "$ROOT/secrets/deepseek.env"
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
    echo "DeepSeek key is missing. Set DEEPSEEK_API_KEY in $ROOT/secrets/deepseek.env, then re-run this script." >&2
    exit 2
fi

cp "$STAGE/AGENTS.md" "$PROJECT/AGENTS.md"
cp "$STAGE/opencode.jsonc" "$PROJECT/opencode.jsonc"
cp "$STAGE/versions.lock" "$PROJECT/versions.lock"
cp -R "$STAGE/docs/." "$PROJECT/docs/"
cp -R "$STAGE/deploy/." "$PROJECT/deploy/"
cp -R "$STAGE/tools/." "$PROJECT/tools/"
cp -R "$STAGE/tests/." "$PROJECT/tests/"
cp -R "$STAGE/.opencode/." "$PROJECT/.opencode/"
chmod 755 "$PROJECT/deploy/scripts/"*.sh "$PROJECT/tools/"*.py

chown -R 1026:100 "$PROJECT/.opencode" "$PROJECT/tools" "$PROJECT/tests" "$PROJECT/deploy" "$PROJECT/docs"
chown 1026:100 "$PROJECT/AGENTS.md" "$PROJECT/opencode.jsonc" "$PROJECT/versions.lock"
chown -R 1026:100 "$ROOT/runtime/opencode" "$ROOT/secrets"

echo "Verifying the pinned OpenCode image and project configuration..."
"$DOCKER" pull "$OPENCODE_IMAGE"
"$DOCKER" build \
    --build-arg "OPENCODE_IMAGE=$OPENCODE_IMAGE" \
    -t "$AGENT_IMAGE" \
    -f "$PROJECT/deploy/agent/Dockerfile" \
    "$PROJECT/deploy/agent"
"$COMPOSE" -f "$PROJECT/deploy/compose.yaml" config >/dev/null

echo "Starting brain-agent..."
"$COMPOSE" -f "$PROJECT/deploy/compose.yaml" up -d brain-agent

. "$ROOT/secrets/opencode.env"
attempt=0
until curl --fail --silent --show-error \
    -u "$OPENCODE_SERVER_USERNAME:$OPENCODE_SERVER_PASSWORD" \
    http://10.0.0.81:14096/api/info >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
        echo "brain-agent did not become healthy." >&2
        "$COMPOSE" -f "$PROJECT/deploy/compose.yaml" logs --tail 150 brain-agent
        exit 1
    fi
    sleep 2
done

"$COMPOSE" -f "$PROJECT/deploy/compose.yaml" ps brain-agent
echo "Phase two agent is ready at internal URL http://10.0.0.81:14096. Configure Lucky before using the public URL."
