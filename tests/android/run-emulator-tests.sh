#!/usr/bin/env bash
set -Eeuo pipefail
cd "$GITHUB_WORKSPACE"
mkdir -p test-results/android
export DISHA_ANDROID_FIXTURE_ONLY=1
export NODE_ENV=test
gradle -p tests/android/upi-receiver :app:assembleDebug --no-daemon --console=plain
adb wait-for-device
adb install -r tests/android/upi-receiver/app/build/outputs/apk/debug/app-debug.apk
node tests/android/fixture-server.js > test-results/android/fixture-server.log 2>&1 &
FIXTURE_PID=$!
LOGCAT_PID=''
cleanup() {
  result=$?
  # An offline emulator must not prevent failure artifacts from being uploaded.
  timeout 12s adb logcat -d -v threadtime > test-results/android/full-logcat.txt 2>&1 || true
  timeout 12s adb shell dumpsys activity activities > test-results/android/activity-state.txt 2>&1 || true
  timeout 12s adb shell dumpsys package ai.disha.testupi > test-results/android/test-app-package.txt 2>&1 || true
  timeout 12s adb shell dumpsys webviewupdate > test-results/android/webview-provider.txt 2>&1 || true
  timeout 12s adb devices -l > test-results/android/adb-devices.txt 2>&1 || true
  # Retain host-side OOM evidence when QEMU disappears before adb can report.
  free -m > test-results/android/host-memory.txt 2>&1 || true
  sudo dmesg -T 2>&1 | grep -Ei 'out of memory|oom|killed process|qemu' | tail -60 > test-results/android/host-oom.txt || true
  curl --silent --max-time 5 http://127.0.0.1:8765/health > test-results/android/fixture-health.json || true
  if [[ -n "$LOGCAT_PID" ]]; then kill "$LOGCAT_PID" 2>/dev/null || true; fi
  kill "$FIXTURE_PID" 2>/dev/null || true
  exit "$result"
}
trap cleanup EXIT
for i in $(seq 1 40); do
 if curl --fail --silent http://127.0.0.1:8765/health >/dev/null; then break; fi
 sleep .5
done
curl --fail --silent http://127.0.0.1:8765/health
adb logcat -c
# Keep one continuous host-side logcat stream. Repeated '-d' calls triggered
# ADB timeouts and left Android API 35 disconnected during state polling.
adb logcat -v time -s DISHA_UPI_TEST:I '*:S' > test-results/android/intent-logcat-live.txt 2>&1 &
LOGCAT_PID=$!
sleep 1
if ! kill -0 "$LOGCAT_PID" 2>/dev/null; then
  echo 'ANDROID_LOGCAT_STREAM_DIED' >&2
  exit 1
fi
# Bound the instrumented browser journey: a dropped WebView/credential prompt
# must fail with artifacts instead of leaving a runner hanging indefinitely.
timeout --signal=TERM --kill-after=10s 210s python3 -u tests/android/verify_android_flow.py
# Run the new ProofBridge journey on the same emulator, using only synthetic test evidence.
timeout --signal=TERM --kill-after=10s 175s python3 -u tests/android/verify_proofbridge_android.py
cp test-results/android/intent-logcat-live.txt test-results/android/intent-logcat.txt
echo 'ANDROID_P2P_INTENT_TESTS_PASS (no financial transfer performed)'
