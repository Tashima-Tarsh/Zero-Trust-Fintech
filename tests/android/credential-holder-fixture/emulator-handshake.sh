#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results/credential-handshake
out=test-results/credential-handshake
node tests/android/credential-holder-fixture/lab-server.js > "$out/lab-server.log" 2>&1 &
labpid=$!
trap 'kill "$labpid" 2>/dev/null || true' EXIT
sleep 1
adb reverse tcp:8765 tcp:8765
adb install -r tests/android/credential-holder-fixture/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n ai.disha.credentialfixture/.RegisterActivity
sleep 4
adb shell uiautomator dump /sdcard/disha-ui.xml >/dev/null 2>&1
adb pull /sdcard/disha-ui.xml "$out/registration-ui.xml" >/dev/null
python3 tests/android/credential-holder-fixture/tap-label.py "$out/registration-ui.xml" "Run signed Android to DISHA server handshake"
sleep 8
adb shell uiautomator dump /sdcard/disha-ui.xml >/dev/null 2>&1
adb pull /sdcard/disha-ui.xml "$out/server-handshake.xml" >/dev/null
if ! grep -q 'DISHA_ANDROID_SERVER_SIGNED_HANDSHAKE_PASS' "$out/server-handshake.xml"; then
  echo "Android -> server signature verification failed";exit 1
fi
echo "ANDROID_SERVER_HANDSHAKE_PASS"
adb shell am force-stop ai.disha.credentialfixture
adb shell am start -n ai.disha.credentialfixture/.RegisterActivity
sleep 3
adb shell uiautomator dump /sdcard/disha-ui.xml >/dev/null 2>&1
adb pull /sdcard/disha-ui.xml "$out/registration-ui.xml" >/dev/null
python3 tests/android/credential-holder-fixture/tap-label.py "$out/registration-ui.xml" "Register synthetic DISHA credential"
sleep 6
adb shell uiautomator dump /sdcard/disha-ui.xml >/dev/null 2>&1
adb pull /sdcard/disha-ui.xml "$out/registration-result.xml" >/dev/null
if ! grep -q 'Registered synthetic credential metadata with Android' "$out/registration-result.xml"; then
  echo "Credential Manager fixture registration did not succeed."
  grep -o 'Registration failed[^<]*' "$out/registration-result.xml" || true
  exit 1
fi
if ! adb shell pm list packages | grep -q 'package:com.android.chrome'; then
  echo "Android image lacks Chrome; do not claim browser handshake was tested."
  exit 1
fi
adb logcat -c
adb shell am start -a android.intent.action.VIEW -d 'https://disha8-2.thenitishkr.in/debit-credential-test.html' com.android.chrome
sleep 12
adb shell uiautomator dump /sdcard/disha-ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/disha-ui.xml "$out/browser-before.xml" >/dev/null || true
python3 tests/android/credential-holder-fixture/tap-label.py "$out/browser-before.xml" "Request Android Credential (No Payment)"
sleep 12
adb logcat -d -s DISHA_CREDENTIAL_FIXTURE:I > "$out/provider-logcat.txt"
adb shell uiautomator dump /sdcard/disha-ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/disha-ui.xml "$out/browser-after.xml" >/dev/null || true
if ! grep -q 'Android handoff received' "$out/provider-logcat.txt"; then
  echo "Chrome did not deliver a GET_CREDENTIAL request to fixture on this image."
  exit 1
fi
echo "CHROME_ANDROID_CREDENTIAL_HANDSHAKE_PASS (synthetic no-payment evidence only)"
