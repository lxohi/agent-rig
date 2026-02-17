// Embedded root helper script for binary distribution.
// Installed to /usr/local/libexec/arigd-root-helper by `arig setup`.
// This script runs as root via sudo and only accepts whitelisted subcommands.
//
// NOTE: This is a bash script embedded as a TypeScript string constant
// because the project is distributed as a compiled Bun binary and cannot
// read asset files from the filesystem at runtime (see CLAUDE.md).
//
// Escaping rules: bash ${VAR} must be written as \${VAR} in the template
// literal. $() subshells are fine as-is since JS only interpolates ${}.

export const ROOT_HELPER_SCRIPT = `#!/bin/bash
set -euo pipefail

# ── Constants ──────────────────────────────────────────────────────
HELPER_VERSION="1"
AUDIT_LOG="/var/log/arigd-root-helper.log"
USERNAME_PATTERN='^arig_sb_[a-z0-9_-]+$'

# ── Audit logging ──────────────────────────────────────────────────
audit() {
  local level="$1"; shift
  local msg="$*"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"
  local caller_uid="\${SUDO_UID:-$(id -u)}"
  local caller_user="\${SUDO_USER:-$(whoami)}"
  printf '{"timestamp":"%s","level":"%s","component":"root-helper","caller_uid":%d,"caller_user":"%s","message":"%s"}\\n' \\
    "$ts" "$level" "$caller_uid" "$caller_user" "$msg" >> "$AUDIT_LOG" 2>/dev/null || true
}

die() {
  audit "error" "$*"
  echo "arigd-root-helper: ERROR: $*" >&2
  exit 1
}

# ── Validation ─────────────────────────────────────────────────────
validate_username() {
  local name="$1"
  if [ -z "$name" ]; then
    die "username is required"
  fi
  if ! echo "$name" | grep -qE "$USERNAME_PATTERN"; then
    die "invalid username '$name': must match $USERNAME_PATTERN"
  fi
}

# ── Subcommands ────────────────────────────────────────────────────
cmd_create_user() {
  local username="$1"
  validate_username "$username"

  if id "$username" &>/dev/null; then
    audit "info" "create-user: user $username already exists (idempotent)"
    return 0
  fi

  audit "info" "create-user: creating user $username"
  useradd --create-home --shell /bin/bash "$username"
  loginctl enable-linger "$username" 2>/dev/null || true

  # Create standard sandbox directories
  local home_dir
  home_dir="$(getent passwd "$username" | cut -d: -f6)"
  mkdir -p "$home_dir/workspace" "$home_dir/.local/share" "$home_dir/.config"
  chown -R "$username:$username" "$home_dir"

  audit "info" "create-user: user $username created successfully"
}

cmd_delete_user() {
  local username="$1"
  validate_username "$username"

  if ! id "$username" &>/dev/null; then
    audit "info" "delete-user: user $username does not exist (idempotent)"
    return 0
  fi

  audit "info" "delete-user: removing user $username"

  # Kill all processes owned by the user
  pkill -9 -u "$username" 2>/dev/null || true
  sleep 1

  # Disable lingering
  loginctl disable-linger "$username" 2>/dev/null || true

  # Remove user and home directory
  userdel --remove "$username" 2>/dev/null || userdel "$username" 2>/dev/null || true

  audit "info" "delete-user: user $username removed successfully"
}

cmd_ensure_slice() {
  local username="$1"
  validate_username "$username"

  local slice_name="arig-sandbox-\${username}.slice"
  local slice_dir="/etc/systemd/system/\${slice_name}.d"

  audit "info" "ensure-slice: configuring slice for $username"

  mkdir -p "$slice_dir"
  cat > "$slice_dir/override.conf" << 'SLICE_EOF'
[Slice]
MemoryMax=16G
CPUQuota=400%
TasksMax=4096
SLICE_EOF

  systemctl daemon-reload 2>/dev/null || true
  audit "info" "ensure-slice: slice for $username configured"
}

cmd_cleanup_resources() {
  local username="$1"
  validate_username "$username"

  audit "info" "cleanup-resources: cleaning up for $username"

  # Kill any remaining processes
  pkill -9 -u "$username" 2>/dev/null || true

  # Clean up systemd slice if it exists
  local slice_name="arig-sandbox-\${username}.slice"
  systemctl stop "$slice_name" 2>/dev/null || true
  rm -rf "/etc/systemd/system/\${slice_name}.d" 2>/dev/null || true
  systemctl daemon-reload 2>/dev/null || true

  # Clean up user docker data if present
  local home_dir
  home_dir="$(getent passwd "$username" | cut -d: -f6 2>/dev/null)" || true
  if [ -n "$home_dir" ] && [ -d "$home_dir/.local/share/docker" ]; then
    rm -rf "$home_dir/.local/share/docker"
  fi

  audit "info" "cleanup-resources: cleanup for $username completed"
}

# ── Main dispatch ──────────────────────────────────────────────────
if [ $# -lt 1 ]; then
  die "usage: arigd-root-helper <subcommand> <args...>"
fi

SUBCOMMAND="$1"; shift

case "$SUBCOMMAND" in
  create-user)
    [ $# -lt 1 ] && die "create-user requires a username argument"
    cmd_create_user "$1"
    ;;
  delete-user)
    [ $# -lt 1 ] && die "delete-user requires a username argument"
    cmd_delete_user "$1"
    ;;
  ensure-slice)
    [ $# -lt 1 ] && die "ensure-slice requires a username argument"
    cmd_ensure_slice "$1"
    ;;
  cleanup-resources)
    [ $# -lt 1 ] && die "cleanup-resources requires a username argument"
    cmd_cleanup_resources "$1"
    ;;
  *)
    die "unknown subcommand '$SUBCOMMAND'. Valid: create-user, delete-user, ensure-slice, cleanup-resources"
    ;;
esac
`;
