#!/bin/bash
set -e

echo "[eddie] Setting up host for Firecracker microVMs..."

# KVM access
sudo setfacl -m u:"${USER}":rw /dev/kvm 2>/dev/null || {
  echo "WARN: Could not set ACL on /dev/kvm. Make sure your user has rw access."
}

# Firecracker binary
FC_VERSION="1.10.1"
FC_URL="https://github.com/firecracker-microvm/firecracker/releases/download/v${FC_VERSION}"
if ! command -v firecracker &>/dev/null; then
  echo "[eddie] Downloading Firecracker v${FC_VERSION}..."
  sudo curl -Lo /usr/local/bin/firecracker "${FC_URL}/firecracker-v${FC_VERSION}-x86_64"
  sudo curl -Lo /usr/local/bin/jailer "${FC_URL}/jailer-v${FC_VERSION}-x86_64"
  sudo chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer
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

echo "[eddie] Host setup complete."
echo "Next: run scripts/build-rootfs.sh to create the VM rootfs image."
