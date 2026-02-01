#!/bin/bash
set -e

echo "=== Installing base packages ==="
apt-get update
apt-get install -y \
  apt-transport-https ca-certificates curl gnupg \
  git tmux jq htop vim unzip wget \
  build-essential uidmap dbus-user-session \
  apparmor apparmor-utils

echo "=== Setting up agent_dev user ==="
useradd -m -s /bin/bash agent_dev || true
loginctl enable-linger agent_dev

# Create directory structure
mkdir -p /home/agent_dev/{workspace,cache,bin,.bashrc.d,.local/bin}
chown -R agent_dev:agent_dev /home/agent_dev/workspace /home/agent_dev/cache /home/agent_dev/.bashrc.d /home/agent_dev/.local /home/agent_dev/bin
chmod 750 /home/agent_dev

# Setup locked .bashrc (owned by root)
cat > /home/agent_dev/.bashrc << 'BASHRC'
# ~/.bashrc - Locked by root (do not modify)
[ -z "$PS1" ] && return
export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
for f in ~/.bashrc.d/*.sh; do [ -r "$f" ] && . "$f"; done
BASHRC
chown root:agent_dev /home/agent_dev/.bashrc
chmod 644 /home/agent_dev/.bashrc

# Setup locked .profile
cat > /home/agent_dev/.profile << 'PROFILE'
[ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
PROFILE
chown root:agent_dev /home/agent_dev/.profile
chmod 644 /home/agent_dev/.profile

# Docker environment
cat > /home/agent_dev/.bashrc.d/docker.sh << 'DOCKERENV'
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
DOCKERENV
chown agent_dev:agent_dev /home/agent_dev/.bashrc.d/docker.sh

echo "=== Installing Docker ==="
curl -fsSL https://get.docker.com | sh

echo "=== Setting up Rootless Docker ==="
sudo -u agent_dev bash -c '
export XDG_RUNTIME_DIR=/run/user/$(id -u)
mkdir -p $XDG_RUNTIME_DIR
/usr/bin/dockerd-rootless-setuptool.sh install 2>/dev/null || true
'

echo "=== Installing Mise ==="
sudo -u agent_dev bash -c '
curl -fsSL https://mise.run | sh
cat > ~/.bashrc.d/mise.sh << "MISEENV"
export PATH="$HOME/.local/bin:$PATH"
eval "$($HOME/.local/bin/mise activate bash)"
MISEENV
'

echo "=== Installing Claude Code ==="
sudo -u agent_dev bash -c '
export PATH="$HOME/.local/bin:$PATH"
~/.local/bin/mise use --global node@lts
export PATH="$HOME/.local/share/mise/installs/node/$(ls ~/.local/share/mise/installs/node/ 2>/dev/null | head -1)/bin:$PATH"
npm install -g @anthropic-ai/claude-code
'

# Setup Claude startup script
cat > /home/agent_dev/bin/start-claude.sh << 'STARTCLAUDE'
#!/bin/bash
cd $HOME/workspace
source ~/.bashrc
if tmux has-session -t claude 2>/dev/null; then
  echo "Claude session already exists"
  exit 0
fi
tmux new-session -d -s claude -c $HOME/workspace
tmux send-keys -t claude 'source ~/.bashrc && claude' Enter
echo "Claude Code started in tmux session 'claude'"
STARTCLAUDE
chown agent_dev:agent_dev /home/agent_dev/bin/start-claude.sh
chmod 755 /home/agent_dev/bin/start-claude.sh

echo "=== Configuring resource limits ==="
AGENT_UID=$(id -u agent_dev)
mkdir -p /etc/systemd/system/user-${AGENT_UID}.slice.d/
cat > /etc/systemd/system/user-${AGENT_UID}.slice.d/limits.conf << 'LIMITS'
[Slice]
MemoryMax=16G
CPUQuota=400%
TasksMax=1024
LIMITS
systemctl daemon-reload

echo "=== Core provisioning complete ==="
