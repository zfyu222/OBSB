#!/bin/sh
# DSM Task Scheduler entry point. The task schedule itself is intentionally not
# created by this script; install it only after the manual third-phase test.
set -eu

ROOT=/volume2/OBSB
DOCKER=/var/packages/ContainerManager/target/usr/bin/docker
LOG_DIR="$ROOT/runtime/nightly"

mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

exec "$DOCKER" exec --user 1026:100 brain-agent \
  python3 /workspace/tools/nightly_orchestrator.py \
  --vault /workspace/vault \
  --worktrees /worktrees \
  --state-dir /var/lib/brain-agent/nightly \
  --agent-command "python3 /workspace/tools/nightly_opencode_agent.py"
