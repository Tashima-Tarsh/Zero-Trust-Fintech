# Fraud vectors and control matrix

| Vector | Signals | Control | Can prove successful payment? |
| --- | --- | --- | --- |
| Edited screenshot / QR image | JPEG recompression variance, metadata, inconsistency | Triage; request independent PSP confirmation | No |
| Fabricated UTR | Syntax check, reused reference | Uniqueness check and verify with provider | No |
| App-return spoofing | Very short dwell, unexpected redirect | Log anomaly; never set PAID from return | No |
| Webhook replay | Reused event ID, stale timestamp | Unique event ID and HMAC timestamp window | No, unless authenticated event also matches |
| Amount / VPA substitution | Provider claims differ from original session | Exact compare, reject | No |
| VPA exhaustion / race | Concurrent assignment | Row lock, lease expiry, merchant scope | No |
| Malicious webhook / leaked secret | Signature failures | HMAC, credential rotation, source controls and reconciliation | Not by itself |
| Device manipulation | Optional, consented timing pattern | Low-impact risk signal only; data minimization | No |

## Decisioning

`risk_score` is 0–100 with descriptive flags. It is not a probability, an ML inference, or a bank authorization. No client-supplied signal is definitive. The only authoritative payment state is derived from verified provider/bank evidence, plus reconciliation and reversal handling as required.

## Privacy

Do not collect or retain raw gyro/touch traces, contact lists, SMS, biometrics or precise geolocation. Capture session-level timestamps and user-consented minimal signals only. Document a purpose, retention period and deletion mechanism before any production collection.
