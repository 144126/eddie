#!/bin/bash
set -e

ALPINE_VERSION="3.21.3"
MIRROR="https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/x86_64"
TARBALL="alpine-minirootfs-${ALPINE_VERSION}-x86_64.tar.gz"
NODE_VERSION="22.14.0"
OUTPUT="assets/rootfs.ext4"
ROOTFS_DIR=$(mktemp -d)
SIZE_MB=512

mkdir -p assets

echo "[eddie] Downloading Alpine minirootfs ${ALPINE_VERSION}..."
curl -fSLo "/tmp/${TARBALL}" "${MIRROR}/${TARBALL}"

echo "[eddie] Extracting rootfs..."
tar -xzf "/tmp/${TARBALL}" -C "$ROOTFS_DIR"

echo "[eddie] Downloading Node.js ${NODE_VERSION} static binary..."
NODE_TARBALL="node-v${NODE_VERSION}-linux-x64.tar.xz"
curl -fSLo "/tmp/${NODE_TARBALL}" "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"

echo "[eddie] Extracting Node.js..."
sudo tar -xJf "/tmp/${NODE_TARBALL}" -C "$ROOTFS_DIR/usr/bin" --strip-components=2 "node-v${NODE_VERSION}-linux-x64/bin/node"

# Create /etc/resolv.conf for DNS (needed by the VM for OpenRouter API)
echo "nameserver 1.1.1.1" | sudo tee "$ROOTFS_DIR/etc/resolv.conf" >/dev/null

# Create runtime directories
sudo mkdir -p "$ROOTFS_DIR/run/metadata" "$ROOTFS_DIR/app"

# Install socat (needed to bridge AF_VSOCK → Unix socket — Node.js can't bind vsock natively)
# Use host's apk-tools-static if available, otherwise chroot into rootfs
echo "https://dl-cdn.alpinelinux.org/alpine/v3.21/main" | sudo tee "$ROOTFS_DIR/etc/apk/repositories" >/dev/null
sudo cp /etc/resolv.conf "$ROOTFS_DIR/etc/resolv.conf" 2>/dev/null || true
sudo mount -t proc none "$ROOTFS_DIR/proc"
sudo chroot "$ROOTFS_DIR" apk add --no-cache socat
sudo umount "$ROOTFS_DIR/proc"
# Restore DNS config for the VM (host's resolv.conf may have systemd stub 127.0.0.53)
echo "nameserver 1.1.1.1" | sudo tee "$ROOTFS_DIR/etc/resolv.conf" >/dev/null

# Copy agent scripts
sudo rm -f "$ROOTFS_DIR/sbin/init"
sudo cp scripts/agent-init.sh "$ROOTFS_DIR/sbin/init"
sudo chmod +x "$ROOTFS_DIR/sbin/init"
sudo cp scripts/agent.js "$ROOTFS_DIR/app/agent.js"

# Build ext4 image
echo "[eddie] Creating ext4 image (${SIZE_MB}MB)..."
dd if=/dev/zero of="$OUTPUT" bs=1M count=$SIZE_MB 2>/dev/null
sudo mkfs.ext4 -F -d "$ROOTFS_DIR" "$OUTPUT" 2>/dev/null

sudo rm -rf "$ROOTFS_DIR"
echo "[eddie] Rootfs built at ${OUTPUT} (${SIZE_MB}MB)"
ls -lh "$OUTPUT"
