#!/usr/bin/env bash
set -Eeuo pipefail
# Run once on a fresh Ubuntu 24.04 VM, as the SSH user (normally ubuntu).
# shellcheck disable=SC1091
[[ "$(. /etc/os-release; echo "$ID")" == ubuntu ]] || { echo 'Ubuntu required' >&2; exit 1; }
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
# shellcheck disable=SC1091
codename="$(. /etc/os-release; echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "$codename" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$(id -un)"
sudo install -d -m 0750 -o "$(id -u)" -g "$(id -g)" /opt/absolute-cinema
install -d -m 0700 /opt/absolute-cinema/releases /opt/absolute-cinema/backups
echo 'Docker installed. Reconnect SSH to activate docker group membership.'
echo 'Configure OCI ingress and the guest firewall for TCP 80/443; retain SSH access.'
