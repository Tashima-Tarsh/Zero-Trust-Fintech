# Phase 2 — Five fraud scenarios in the first four minutes

Time windows are illustrative, not guaranteed fraud-detection deadlines. A pending payment can settle much later; do not treat the end of the window as confirmation.

| Scenario | Adversary behavior | Phase 2 response | Important limitation |
|---|---|---|---|
| 1. Pending trap | Presents a processing/pending screenshot as success | OCR keyword `pending`/`processing` flags; enqueue `PENDING_RECONCILIATION` | A success screenshot is also untrusted; only bank credit confirms |
| 2. UTR swap | Puts an unrelated genuine reference next to a larger displayed amount | OCR amount/UTR consistency flags and replay review | UTR format itself contains **no trustworthy amount**, and ELA cannot reliably prove a Photoshop paste |
| 3. Intent hijack | A fake app claims to be a wallet or payment app | Warn on unexpected reported package; compare signing certificate locally against an independently maintained allowlist in a future trusted client integration | App-reported package/name is forgeable; Android handoff/chooser does not guarantee which app processed payment |
| 4. Replay attack | Reuses last week's payment screenshot | SHA-256 cross-session replay lookup, session binding, timestamp/TTL validation | EXIF timestamps can be removed or edited; image hash will not catch a re-encoded copy |
| 5. VPA substitution | Redirects a payment to a nonmerchant payee | Compare extracted **claimed** VPA to server-assigned VPA; flag mismatch | Screenshot OCR can be manipulated; must verify final **bank credited beneficiary** |

## Defensive decisioning

- Every valid intake produces `decision = PENDING_RECONCILIATION`.
- OCR `success` adds `unverified_success_claim`, **not a verified settlement**.
- High `risk_score` means more suspicious advisory flags, *not* a >95% confidence of real payment.
- Duplicate submission IDs are idempotent; a reused ID with different evidence is rejected.
- Identical screenshot bytes seen in different sessions are flagged for review; raw screenshots are not retained by the worker.
- Explicit image consent is required for base64 image analysis; n8n execution data saving is disabled in the Phase 2 workflow exports.
- The forensic queue is independent of the financial ledger; neither the worker nor 04's scheduler posts credits.

## No outbound canary payments

Random ₹1 payments would be real financial activity, incur transaction costs, and might violate PSP/bank terms. The 03 workflow remains passive: it reads VPA health fields and can alert on stale or unhealthy *merchant-approved* VPAs. Only an authorized PSP/bank health interface can determine current serviceability. No health result can justify bypassing NPCI/bank controls.
