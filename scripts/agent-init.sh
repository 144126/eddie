#!/bin/sh
# PID 1 inside Firecracker microVM — must never exit

echo "[INIT] === VM boot started $(date -u) ==="

echo "[INIT] Mounting proc, sysfs, devtmpfs..."
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null || echo "[INIT] devtmpfs mount skipped (already mounted?)"

echo "[INIT] Bringing up loopback..."
ip link set lo up && echo "[INIT] lo up OK"

echo "[INIT] Parsing kernel cmdline..."
CMDLINE=$(cat /proc/cmdline)
echo "[INIT] cmdline: $CMDLINE"

IP=$(echo "$CMDLINE" | tr ' ' '\n' | sed -n 's/^ip=\([^:]*\)::\([^:]*\):\([^ ]*\).*/\1/p')
GW=$(echo "$CMDLINE" | tr ' ' '\n' | sed -n 's/^ip=\([^:]*\)::\([^:]*\):\([^ ]*\).*/\2/p')
echo "[INIT] parsed IP=$IP GW=$GW"

if [ -n "$IP" ] && [ -n "$GW" ]; then
  echo "[INIT] Configuring eth0: ip=${IP}/24 gw=${GW}"
  ip addr add "${IP}/24" dev eth0 2>&1 && echo "[INIT] ip addr add OK" || echo "[INIT] ip addr add FAILED"
  ip link set eth0 up 2>&1 && echo "[INIT] eth0 up OK" || echo "[INIT] eth0 up FAILED"
  ip route add default via "$GW" 2>&1 && echo "[INIT] default route OK" || echo "[INIT] default route FAILED"
else
  echo "[INIT] WARN: could not parse IP/GW from cmdline"
fi

echo "[INIT] Reading metadata from MMDS (max 30 retries)..."
for i in $(seq 1 30); do
  echo "[INIT] MMDS attempt $i..."
  NOUS_KEY=$(wget -q -O - http://169.254.169.254/latest/meta-data/nous_api_key 2>&1)
  RET=$?
  if [ $RET -eq 0 ] && [ -n "$NOUS_KEY" ]; then
    echo "[INIT] MMDS success on attempt $i, key length=${#NOUS_KEY}"
    break
  fi
  echo "[INIT] MMDS attempt $i failed (exit=$RET, output=${NOUS_KEY:-empty}), sleeping..."
  sleep 0.5
done

if [ -n "$NOUS_KEY" ]; then
  echo "$NOUS_KEY" > /run/metadata/nous_api_key
  echo "[INIT] wrote nous_api_key to /run/metadata/nous_api_key"
else
  echo "[INIT] WARN: MMDS fetch failed after 30 attempts, writing empty key"
  echo "" > /run/metadata/nous_api_key
fi

echo "[INIT] Checking available devices..."
ls -la /dev/vsock* 2>&1 || echo "[INIT] no /dev/vsock* found (AF_VSOCK is socket family, not device)"
ls -la /dev/net/tun 2>&1 || echo "[INIT] no /dev/net/tun"

echo "[INIT] Starting socat (VSOCK-LISTEN:52,fork → UNIX-CONNECT:/tmp/agent.sock)..."
socat VSOCK-LISTEN:52,fork UNIX-CONNECT:/tmp/agent.sock &
SOCAT_PID=$!
echo "[INIT] socat PID=$SOCAT_PID"
sleep 0.5
# Verify socat is running
kill -0 $SOCAT_PID 2>/dev/null && echo "[INIT] socat is alive" || echo "[INIT] WARN: socat already died!"

echo "[INIT] Starting Node.js agent..."
cd /app
ls -la /app/agent.js && echo "[INIT] agent.js exists" || echo "[INIT] WARN: agent.js missing!"
node agent.js &
AGENT_PID=$!
echo "[INIT] agent PID=$AGENT_PID"
sleep 0.5
kill -0 $AGENT_PID 2>/dev/null && echo "[INIT] agent is alive" || echo "[INIT] WARN: agent already died!"

echo "[INIT] === VM boot complete $(date -u) ==="

# PID 1 reap loop — restart agent if it crashes
while true; do
  wait "$AGENT_PID" 2>/dev/null || true
  sleep 1
  echo "[INIT] Agent (PID $AGENT_PID) exited, restarting..."
  node agent.js &
  AGENT_PID=$!
  echo "[INIT] New agent PID=$AGENT_PID"
done
