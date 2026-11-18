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
cleanup() {
  result=$?
  # An offline emulator must not prevent failure artifacts from being uploaded.
  timeout 12s adb logcat -d -v threadtime > test-results/android/full-logcat.txt 2>&1 || true
  timeout 12s adb shell dumpsys activity activities > test-results/android/activity-state.txt 2>&1 || true
  timeout 12s adb shell dumpsys package ai.disha.testupi > test-results/android/test-app-package.txt 2>&1 || true
  timeout 12s adb shell dumpsys webviewupdate > test-results/android/webview-provider.txt 2>&1 || true
  timeout 12s adb devices -l > test-results/android/adb-devices.txt 2>&1 || true
  curl --silent --max-time 5 http://127.0.0.1:8765/health > test-results/android/fixture-health.json || true
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
# Bound the instrumented browser journey: a dropped WebView/credential prompt
# must fail with artifacts instead of leaving a runner hanging indefinitely.
timeout --signal=TERM --kill-after=10s 210s python3 -u tests/android/verify_android_flow.py
adb logcat -d -s DISHA_UPI_TEST:I '*:S' > test-results/android/intent-logcat.txt
echo 'ANDROID_P2P_INTENT_TESTS_PASS (no financial transfer performed)'
