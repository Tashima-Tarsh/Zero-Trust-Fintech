# Fraud matrix (defensive signals)

| Threat | Detection input | Mitigation | Payment proof |
| --- | --- | --- | --- |
| Screenshot manipulation | ELA / optional user-consented OCR | Flag for review; compare with bank statement | No |
| Faked UTR | Format and reused reference | Bank-side reference lookup and dedupe | No |
| Fake intent return | Elapsed time and lifecycle | Never mark PAID from return | No |
| Spoofed package ID | Installed-package signature report | Verify local certificate against signed allowlist; do not trust client claims | No |
| VPA substitution | Requested vs provider-reported destination | Reject mismatched credit and investigate | No |
| Webhook replay | Timestamp + HMAC + event ID | Window-bound signatures and idempotency | No, without bank verification |
| Reused statement | Bank event ID and reconciliation trace | Dedupe authoritative bank feed | No, without bank verification |
| Bulk API abuse | Redis counters | Fail-closed authenticated rate limiting | No |
| Exhausted VPA pool | Passive health report | Alert; no unauthorized synthetic bank transactions | No |

### Forensic score
A heuristic *triage score*, not a probability, evidence of a successful transfer, evidence of crime, or a justification for automatic account suspension. Validation needs labeled data and false-positive review.

### Privacy
No third-party app screen capture without platform-supported, prominent consent. Do not collect biometric identifiers or raw device motion traces. OCR images should be user-provided, access controlled, sanitized, and deleted under a documented retention policy.
