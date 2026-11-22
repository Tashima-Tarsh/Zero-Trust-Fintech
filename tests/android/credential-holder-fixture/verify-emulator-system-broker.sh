#!/usr/bin/env bash
# Isolated Android test emulator only. Never run against a personal/production device.
set -euo pipefail
apk="${1:?Expected broker-only debug APK}"
out="test-results/android-system-broker"
mkdir -p "$out"
adb devices -l | tee "$out/devices.txt"
test "$(adb devices | awk '/\tdevice$/{n++} END{print n+0}')" -eq 1 || {
  echo "Exactly one authorized test emulator required" >&2; exit 1;
}
test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1 || {
  echo "Refusing to modify a non-emulator" >&2; exit 1;
}
adb root
adb wait-for-device
# OverlayFS requires disabling verified boot and rebooting the disposable emulator first.
adb disable-verity
adb reboot
adb wait-for-device
adb root
adb wait-for-device
adb remount
adb shell mkdir -p /system/priv-app/DishaBroker
adb push "$apk" /system/priv-app/DishaBroker/DishaBroker.apk
adb shell chmod 0644 /system/priv-app/DishaBroker/DishaBroker.apk
adb reboot
adb wait-for-device
for i in $(seq 1 90); do
  [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ] && break
  sleep 2
done
test "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1
adb shell pm list packages -s | tee "$out/system-packages.txt"
grep -Fx 'package:ai.disha.credentialfixture' "$out/system-packages.txt"
adb shell pm path ai.disha.credentialfixture | tee "$out/package-path.txt"
grep -E '/system/|/product/|/system_ext/' "$out/package-path.txt"
adb shell dumpsys package ai.disha.credentialfixture > "$out/package-dump.txt"
# Explicitly target the package to test Intent delivery, NOT verified Chrome dispatch.
dummy="$(printf 'A%.0s' {1..43})"
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://disha8-2.thenitishkr.in/android/observer/$dummy" -p ai.disha.credentialfixture | tee "$out/explicit-intent.txt"
grep -Eq 'Status: ok|Status: OK' "$out/explicit-intent.txt"
adb shell pm get-app-links ai.disha.credentialfixture | tee "$out/domain-verification.txt" || true
# A controlled Android ACTION_SEND probes the native Sharesheet receiver. This
# cannot establish an authenticated checkout or prove real UPI app sharing.
adb shell am start -W -a android.intent.action.SEND -t text/plain \
  --es android.intent.extra.TEXT 'RRN: 000000000190 Amount: INR 1.00' \
  -n ai.disha.credentialfixture/.PlatformSharedReceiptActivity \
  | tee "$out/share-receiver-intent.txt"
grep -Eq 'Status: ok|Status: OK' "$out/share-receiver-intent.txt"
grep -F 'PlatformSharedReceiptActivity' "$out/share-receiver-intent.txt"
echo "PASS: explicitly targeted original-text Sharesheet receiver dispatch"

echo "PASS: emulator-original-system-app install and explicitly targeted HTTPS VIEW dispatch"
echo "NOT PROVEN: domain verified Chrome dispatch, biometric/PIN, notification consent, trusted device attestation or real debit receipt"
