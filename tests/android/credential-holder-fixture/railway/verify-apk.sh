#!/usr/bin/env bash
set -euo pipefail
apk="${1:?APK path required}"
sdk="${ANDROID_HOME:?ANDROID_HOME required}/build-tools/35.0.0"
badging="$("$sdk/aapt" dump badging "$apk")"
grep -F "package: name='ai.disha.credentialfixture' " <<< "$badging"
manifest="$("$sdk/aapt" dump xmltree "$apk" AndroidManifest.xml)"
for entry in PlatformObservationBrokerActivity PaymentObservationListener BIND_NOTIFICATION_LISTENER_SERVICE; do
    grep -Fq "$entry" <<< "$manifest"
done
if grep -Eq 'RegisterActivity|PresentActivity|SessionObservationActivity|DishaCredentialApplication|POST_NOTIFICATIONS' <<< "$manifest"; then
    echo 'Unexpected fixture declaration' >&2
    exit 1
fi
"$sdk/apksigner" verify --print-certs "$apk"
sha256sum "$apk"
