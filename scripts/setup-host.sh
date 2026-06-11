#!/bin/bash
set -e

echo "[eddie] Setting up host for Firecracker microVMs..."

# KVM access (group membership requires re-login; fallback to world-rw)
if ! [ -r /dev/kvm ] 2>/dev/null; then
  sudo chmod 666 /dev/kvm 2>/dev/null || {
    echo "WARN: Could not set permissions on /dev/kvm."
  }
fi

# Firecracker binary
FC_VERSION="1.10.1"
FC_RELEASE_URL="https://github.com/firecracker-microvm/firecracker/releases/download/v${FC_VERSION}"
FC_CI_VERSION="v${FC_VERSION%.*}"
if ! command -v firecracker &>/dev/null || [ "$(firecracker --version 2>/dev/null | head -1)" = "" ]; then
  echo "[eddie] Downloading Firecracker v${FC_VERSION}..."
  curl -sL -o /tmp/firecracker.tgz "${FC_RELEASE_URL}/firecracker-v${FC_VERSION}-x86_64.tgz"
  sudo tar -xzf /tmp/firecracker.tgz -C /usr/local/bin \
    "release-v${FC_VERSION}-x86_64/firecracker-v${FC_VERSION}-x86_64" \
    "release-v${FC_VERSION}-x86_64/jailer-v${FC_VERSION}-x86_64" \
    --strip-components=1
  sudo mv /usr/local/bin/firecracker-v${FC_VERSION}-x86_64 /usr/local/bin/firecracker
  sudo mv /usr/local/bin/jailer-v${FC_VERSION}-x86_64 /usr/local/bin/jailer
  sudo chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer
  rm -f /tmp/firecracker.tgz
fi

# Firecracker kernel (from official CI S3 bucket)
if [ ! -f assets/vmlinux ]; then
  KERNEL_KEY="$(curl -s "http://spec.ccfc.min.s3.amazonaws.com/?prefix=firecracker-ci/${FC_CI_VERSION}/x86_64/vmlinux-&list-type=2" \
    | grep -oP "(?<=<Key>)firecracker-ci/${FC_CI_VERSION}/x86_64/vmlinux-[0-9]+\.[0-9]+\.[0-9]{1,3}(?=</Key>)" \
    | sort -V | tail -1)"
  echo "[eddie] Downloading kernel: ${KERNEL_KEY} ..."
  curl -sL -o assets/vmlinux "https://s3.amazonaws.com/spec.ccfc.min/${KERNEL_KEY}"
  chmod 644 assets/vmlinux
fi

# Jailer user
sudo groupadd -f firecracker
sudo useradd -r -g firecracker -s /sbin/nologin firecracker 2>/dev/null || true

# Network bridge
sudo ip link add name fc-br0 type bridge 2>/dev/null || true
sudo ip addr add 172.20.0.1/24 dev fc-br0 2>/dev/null || true
sudo ip link set fc-br0 up

# NAT outbound
sudo iptables -t nat -A POSTROUTING -s 172.20.0.0/24 ! -d 172.20.0.0/24 -j MASQUERADE 2>/dev/null || true
sudo iptables -A FORWARD -s 172.20.0.0/24 -j ACCEPT 2>/dev/null || true
sudo iptables -A FORWARD -d 172.20.0.0/24 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
sudo iptables -A FORWARD -s 172.20.0.0/24 -d 172.20.0.0/24 -j DROP 2>/dev/null || true

# Enable IP forwarding
echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward >/dev/null

# Passwordless sudo for TAP device management
TARGET_USER="${SUDO_USER:-${USER}}"
IP_BIN="$(command -v ip)"
echo "${TARGET_USER} ALL=(root) NOPASSWD: ${IP_BIN} tuntap add dev tap-* mode tap, ${IP_BIN} link set tap-* master fc-br0, ${IP_BIN} link set tap-* up, ${IP_BIN} link del tap-*" | \
  sudo tee "/etc/sudoers.d/eddie-tap" >/dev/null

echo "[eddie] Host setup complete."
echo "Next: run scripts/build-rootfs.sh to create the VM rootfs image."
