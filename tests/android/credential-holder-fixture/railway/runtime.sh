#!/usr/bin/env bash
set -euo pipefail
grep '^PRETTY_NAME=' /etc/os-release
git --version
java -version
gradle --version
sdkmanager --version
printf 'CPU available: '; nproc
df -h /home/lab/source
for setting in /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max; do
    if [[ -r "$setting" ]]; then printf '%s: ' "$setting"; cat "$setting"; fi
done
if [[ -c /dev/kvm ]]; then ls -l /dev/kvm; else echo '/dev/kvm absent'; fi
bash railway/verify-apk.sh app/build/outputs/apk/debug/app-debug.apk
exec sleep infinity
