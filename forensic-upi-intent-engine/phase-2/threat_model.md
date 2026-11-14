# Signed device-action threat scenarios

| Scenario | Behavior | Rejection control |
| --- | --- | --- |
| Fast app-return spoof | Implausibly short dwell time | Device Integrity Check flag |
| Identifier swap | Claimed action ID differs from separately consented evidence | Integrity mismatch flag |
| Amount swap | Client changes amount after signing | Signature mismatch and locked-session amount comparison |
| Replay | Reuses a previously recorded signed request | Idempotent same-claim response or conflicting-claim rejection |
| Session hijack | Reuses a valid signature for another session | Signed session ID and enrolled user/device binding |
| Image tamper | Elevated JPEG recompression anomaly | Device Integrity Check failure |
| Device impersonation | Key substituted during request | Lookup in protected enrolled-key registry |
| Timestamp rollback | Replays an old claim | Signed timestamp window and session expiry |

The API treats a rejected integrity decision as a reason to decline the
client-attestation action. Native private-key protection and key enrollment
are separate operational security controls.
