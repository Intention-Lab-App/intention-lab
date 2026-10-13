#!/usr/bin/env bash
# Checks the Linux package on Linux or in WSL: start, reuse, keepalive, idle quit,
# port conflict, missing app folder, shutdown. Needs curl and node.
# Run: bash tests/linux.sh dist/IntentionLab-linux-x64
set -u
src="$1"; dir=/tmp/il-linux-check; rm -rf "$dir"; cp -r "$src" "$dir"; chmod +x "$dir/DeviceBridge"
pass=0; fail=0
check() { if eval "$2"; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1"; fail=$((fail+1)); fi; }
ready() { for i in $(seq 1 100); do curl -sf "http://127.0.0.1:$1/bridge/bootstrap" >/dev/null && return 0; sleep 0.1; done; return 1; }
cd /tmp
INTENTIONLAB_PORT=29891 INTENTIONLAB_IDLE_SECONDS=4 "$dir/DeviceBridge" --no-browser 2>/tmp/il-err.txt & pid=$!
check "starts and answers" "ready 29891"
boot=$(curl -sf http://127.0.0.1:29891/bridge/bootstrap)
check "identifies itself" "echo '$boot' | grep -q '\"application\":\"IntentionLab.DeviceBridge\"'"
check "serves the app from beside the executable" "curl -sf http://127.0.0.1:29891/ | grep -q 'js/app.js'"
devices=$(curl -sf http://127.0.0.1:29891/bridge/devices); echo "  devices: $devices"
check "lists devices without opening them" "echo '$devices' | grep -q '^\['"
INTENTIONLAB_PORT=29891 "$dir/DeviceBridge" --no-browser; second=$?
check "second launch reuses the running bridge" "[ $second -eq 0 ] && kill -0 $pid"
for i in $(seq 1 8); do curl -sf http://127.0.0.1:29891/bridge/status >/dev/null; sleep 1; done
check "keeps running while a page pings" "kill -0 $pid"
start=$(date +%s); wait $pid; code=$?; took=$(( $(date +%s) - start ))
check "quits by itself after the idle limit (exit $code after ${took}s)" "[ $code -eq 0 ] && [ $took -ge 3 ] && [ $took -le 9 ]"
node -e 'require("http").createServer((q,s)=>s.end("other")).listen(29892,"127.0.0.1")' & other=$!; sleep 0.5
INTENTIONLAB_PORT=29892 "$dir/DeviceBridge" --no-browser 2>/tmp/il-conflict.txt; code=$?
check "port conflict fails with a readable message" "[ $code -eq 1 ] && grep -q 'cannot use port 29892' /tmp/il-conflict.txt"
# Desktop mode with no display: the dialog tools fail at once instead of hanging.
env -u DISPLAY -u WAYLAND_DISPLAY INTENTIONLAB_PORT=29892 timeout 20 "$dir/DeviceBridge" 2>/dev/null; code=$?
check "desktop error without a display still exits" "[ $code -eq 1 ]"
kill $other
INTENTIONLAB_PORT=29893 INTENTIONLAB_APP_DIR=/nonexistent "$dir/DeviceBridge" --no-browser 2>/tmp/il-missing.txt; code=$?
check "missing app folder fails with a readable message" "[ $code -eq 1 ] && grep -q 'App folder not found' /tmp/il-missing.txt"
INTENTIONLAB_PORT=29894 "$dir/DeviceBridge" --no-browser & pid=$!; ready 29894
token=$(curl -sf http://127.0.0.1:29894/bridge/bootstrap | sed 's/.*"token":"\([0-9A-F]*\)".*/\1/')
curl -sf -X POST -H "X-Bridge-Token: $token" http://127.0.0.1:29894/bridge/shutdown >/dev/null; wait $pid; code=$?
check "shutdown request stops the bridge" "[ $code -eq 0 ]"
echo "TOTAL $pass passed, $fail failed"; rm -rf "$dir"; [ $fail -eq 0 ]
