# Device integrity and replay threat matrix

| Attack or anomaly | Prevention in current attestation API |
| --- | --- |
| Signature substitution | Verify registered Ed25519 public key, never key from request |
| Amount substitution | Include exact amount in signature and compare with locked session |
| Session substitution | Include session UUID in signature, require device/session binding |
| Reused action reference | Enforce unique UTR claim in append-only event ledger |
| Exact repeat | Return duplicate:true without second event |
| Conflicting repeat | Reject already finalized session |
| Delayed replay | Check signed timestamp and session expiry |
| Short dwell or excessive attempts | Reject on Device Integrity Check flags |
| High image recompression anomaly | Reject signed integrity payload when threshold violated |
| Previously rejected evidence | Block if immutable prior device-integrity record rejects |
| Spoofed device enrollment | Require separately validated enrollment and hardware_attested flag |

Thresholds are a configurable application rejection policy. Device hardware provenance validation and enrollment controls must be implemented at deployment time.
