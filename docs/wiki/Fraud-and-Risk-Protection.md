# DISHA 8.2 — Risk and Evidence Intelligence

The core question is whether the **specific payment request** and **available authenticatable debit evidence** can be correlated with the same order without contradictory signals.

## Guardrails

| Control | Why it matters |
| --- | --- |
| P2P / P2M lane validation | Incorrect merchant classification can cause pre-PIN app refusal |
| Exact-amount and payee snapshot | Browser reload and VPA edits cannot silently change issued payment instructions |
| Quantum Signal nonce + challenge/ACK | Blocks cross-order browser-signal replay |
| Vault authorization and frozen packet | Where enabled, ties device authorization and observed journey to an order |
| Unique event IDs and UTR/transaction reference conflict checks | Detects repeated or inconsistent claims |
| Tenant isolation and CSRF checks | Protects merchant data and restricted write routes |
| Idempotent journal | Prevents duplicate processing for the same accepted transaction |
| Unknown/unavailable evidence state | Refuses to manufacture a completed payment decision |

**Evidence acquisition is an open engineering gate.** DISHA cannot learn a bank's internal debit decision merely from an Android browser's background/return event. The planned payer-side debit input must be technically possible, attributable and falsification resistant before release.

[System design](../architecture/SYSTEM-ARCHITECTURE.md) · [Test plan](../architecture/TEST-AND-RELEASE.md).
