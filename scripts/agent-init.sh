#!/bin/sh
# PID 1 inside Firecracker microVM — must never exit

set -e

# Mount essentials
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true

# Configure loopback
ip link set lo up

# Parse kernel cmdline for IP configuration
# Firecracker passes: ip=<guest_ip>::<gateway>:<netmask>
CMDLINE=$(cat /proc/cmdline)
IP=$(echo "$CMDLINE" | tr ' ' '\n' | sed -n 's/^ip=\([^:]*\)::\([^:]*\):\([^ ]*\).*/\1/p')
GW=$(echo "$CMDLINE" | tr ' ' '\n' | sed -n 's/^ip=\([^:]*\)::\([^:]*\):\([^ ]*\).*/\2/p')

if [ -n "$IP" ] && [ -n "$GW" ]; then
  ip addr add "${IP}/24" dev eth0 2>/dev/null || true
  ip link set eth0 up
  ip route add default via "$GW" 2>/dev/null || true
fi

# Read metadata from MMDS (retry until available)
MMDS="http://169.254.169.254/latest/meta-data"
for i in $(seq 1 30); do
  NOUS_KEY=$(curl -sf "${MMDS}/nous_api_key" 2>/dev/null) && break
  sleep 0.5
done

echo "$NOUS_KEY" > /run/metadata/nous_api_key

export NOUS_API_KEY="$NOUS_KEY"

# Start the agent
cd /app
node agent.js &
AGENT_PID=$!

# PID 1 reap loop — restart agent if it crashes
while true; do
  wait
  echo "[init] Agent exited, restarting..."
  node agent.js &
  AGENT_PID=$!
done
