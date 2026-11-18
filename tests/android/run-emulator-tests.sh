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
trap 'kill "$FIXTURE_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 40); do
 if curl --fail --silent http://127.0.0.1:8765/health >/dev/null; then break; fi
 sleep .5
done
curl --fail --silent http://127.0.0.1:8765/health
adb logcat -c
python3 tests/android/verify_android_flow.py
adb logcat -d -s DISHA_UPI_TEST:I '*:S' > test-results/android/intent-logcat.txt
echo 'ANDROID_P2P_INTENT_TESTS_PASS (no financial transfer performed)'
