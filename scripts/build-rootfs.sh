#!/bin/bash
set -e

OUTPUT="assets/rootfs.ext4"
ROOTFS_DIR=$(mktemp -d)
SIZE_MB=384

mkdir -p assets

echo "[eddie] Bootstrapping Alpine rootfs..."

# Bootstrap minimal Alpine with Docker (alpine tar)
docker run --rm -v "${ROOTFS_DIR}:/rootfs" alpine:3.19 sh -c "
  apk add --no-cache alpine-baselayout busybox openrc nodejs npm curl ca-certificates
  cp -a /. /rootfs/ 2>/dev/null || cp -a /bin /rootfs/ && cp -a /lib /rootfs/ && cp -a /sbin /rootfs/ && cp -a /usr /rootfs/ && cp -a /etc /rootfs/ && cp -a /var /rootfs/
  : basic copy done
" 2>&1 | tail -3

# Create runtime directories
mkdir -p "$ROOTFS_DIR/run/metadata" "$ROOTFS_DIR/app"

# Copy agent scripts
cp scripts/agent-init.sh "$ROOTFS_DIR/sbin/init"
chmod +x "$ROOTFS_DIR/sbin/init"
cp scripts/agent.js "$ROOTFS_DIR/app/agent.js"

# Build ext4 image
echo "[eddie] Creating ext4 image (${SIZE_MB}MB)..."
dd if=/dev/zero of="$OUTPUT" bs=1M count=$SIZE_MB 2>/dev/null
mkfs.ext4 -F "$OUTPUT" 2>/dev/null
sudo mount -o loop "$OUTPUT" /mnt
sudo cp -a "$ROOTFS_DIR/." /mnt/
sudo umount /mnt
rm -rf "$ROOTFS_DIR"

echo "[eddie] Rootfs built at ${OUTPUT} (${SIZE_MB}MB)"
ls -lh "$OUTPUT"
