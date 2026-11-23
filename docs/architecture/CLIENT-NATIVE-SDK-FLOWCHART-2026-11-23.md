# Client decision flow — target and fail-closed behavior

```mermaid
flowchart TD
 A([Customer opens checkout]) --> B[Create order-bound session with exact VPA and amount]
 B --> C{Original session valid?}
 C -->|No| X[Reject / expired session]
 C -->|Yes| D{Payer-side native host installed and consented?}
 D -->|No| E[Direct UPI handoff or copy/QR, no Android debit-signal capture]
 D -->|Yes| F[Enroll short-lived payer session + device public key]
 F --> G{Security policy verified?}
 G -->|Block| Z[Block native evidence path; record reason]
 G -->|Not implemented| H[Do not claim integrity PASS]
 G -->|Pass| I[Display original payee]
 H --> I
 I --> J[Customer initiates UPI app]
 E --> J
 J --> K{Authorized evidence signal available?}
 K -->|No| P[Pending / unresolved; no completed payment]
 K -->|Yes| L[Verify session, signature, time, exact amount/payee, replay]
 L -->|Mismatch| Q[Quarantine evidence / conflict]
 L -->|Matches| M{Independent authenticatable payer debit proof?}
 M -->|No| R[Observed evidence, NOT verified debit]
 M -->|Yes| N[Financial decision only under separately reviewed authority]
 N --> O[Idempotent ledger/receipt and merchant status]
 R --> S[Show evidence-only status]
 Q --> S
 P --> S
```

**Release gate:** Android native launch and notification reading have only synthetic/historical test coverage and require fresh consented real-device validation; bank debit verification must not be inferred from notifications.
