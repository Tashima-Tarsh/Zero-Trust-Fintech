# DISHA 8.2 — End-to-End UPI Journey and Handshake

This is the **target business flow**. The merged `DISHA-SIGNAL-V1` server/browser handshake is implemented, but authentication of a genuine payer-side debit event remains a distinct validation requirement. No bank API, payment aggregator, manual UTR entry or companion app is prescribed.

## Sequence: merchant, Vault, Quantum Signal, UPI app and evidence

```mermaid
sequenceDiagram
  autonumber
  actor Merchant
  participant API as DISHA API
  participant DB as PostgreSQL
  participant Browser as Android Chrome
  participant Vault as DISHA Vault
  participant Quantum as Quantum Signal
  participant OS as Android Intent
  participant PSP as UPI app
  participant Risk as Evidence + decision
  Merchant->>API: Create payment request: P2P or P2M
  API->>API: Validate real VPA, exact paise and classification
  API->>DB: Store order, payee snapshot, TR, expiry
  API-->>Merchant: Share secured checkout link
  Merchant-->>Browser: Open checkout
  Browser->>API: Retrieve bound order details
  API-->>Browser: Amount, payee, QR, exact UPI URI
  opt Optional higher-assurance Vault authorization
    Browser->>Vault: Device credential authorization
    Vault->>DB: Bind order and authorized Vault session
    Vault-->>Browser: Order-bound authorization
  end
  Browser->>Quantum: POST /start
  Quantum->>DB: Freeze session twin
  Quantum-->>Browser: Session nonce
  Browser->>Quantum: POST /challenge
  Quantum->>DB: Persist expiring challenge hash
  Quantum-->>Browser: Challenge and challenge ID
  Browser->>Quantum: POST /ack with original bearer
  Quantum->>DB: Store valid ACK
  Quantum-->>Browser: DISHA-SIGNAL-V1 ready
  Browser->>OS: One user-tapped Proceed anchor
  Browser->>Quantum: HANDOFF event
  OS->>PSP: ACTION_VIEW UPI payment URI
  alt App rejects before PIN
    PSP-->>Browser: Return if browser is resumed
    Browser->>Quantum: Observed RETURN / error context
    Quantum->>DB: Record diagnostic state
    Risk-->>Merchant: Attempt unresolved or rejected
  else Customer authorizes in UPI app
    PSP-->>Browser: Optional app-visible return fields
    Browser->>Quantum: BACKGROUND / RETURN with permitted fields
    Quantum->>DB: Correlate reference candidate and session
    opt Optional Vault recording
      Browser->>Vault: Bound browser-return evidence
      Vault->>DB: Store idempotent event
    end
    Note over PSP,Risk: Authenticated payer debit evidence acquisition is a target capability, not confirmed by app return
    opt Authenticatable debit evidence available
      Risk->>Risk: Validate provenance, payee, amount, UTR/TR and replay
      Risk->>DB: Post accepted idempotent decision
    end
    alt Validated transaction decision exists
      API-->>Browser: Completed state and receipt
      API-->>Merchant: Merchant timeline and ledger
    else Source missing, pending or conflicting
      API-->>Browser: Pending / exception state
      API-->>Merchant: Unresolved attempt with diagnostics
    end
  end
```

## Decision flow

```mermaid
flowchart TD
  A(["Payment requested"]) --> B{"Receiving account type?"}
  B -->|Personal P2P| C["Validate personal VPA: no fabricated merchant fields"]
  B -->|Bank-issued P2M| D["Validate merchant VPA, MCC and TR"]
  C --> E{"Valid exact URI?"}
  D --> E
  E -->|No| X["Reject before session or app dispatch"]
  E -->|Yes| F["Create Vault/Quantum-bound session"]
  F --> G["Challenge → ACK → one Proceed"]
  G --> H{"UPI app accepts request?"}
  H -->|No, before PIN| I["Capture error and leave unresolved"]
  H -->|Yes| J["Customer authorizes inside UPI app"]
  J --> K["Observe app/background/browser return"]
  K --> L["Correlate allowed UTR/TR, order and device signals"]
  L --> M{"Authenticatable payer debit evidence?"}
  M -->|Not available| P["Pending/exception · no completed receipt"]
  M -->|Available| N{"Original amount, payee and UTR/TR consistent?"}
  N -->|No| O["Reject or quarantine conflicts"]
  N -->|Yes| Q["Idempotent financial decision"]
  Q --> R["Receipt · ledger · SaaS timeline"]
```

## Exceptions

| Case | Expected handling |
| --- | --- |
| No UPI app installed | Keep scannable QR and safe retry |
| App opens then refuses before PIN | Record error; no completion |
| Customer cancels / wrong PIN | No completed decision |
| Browser backgrounded and never resumes | Persist observed handoff only |
| UTR absent on return | Explicit `RETURN_OBSERVED_NO_UTR` |
| Different UTRs or duplicate UTR across orders | Conflict/quarantine; no duplicate journal |
| Server challenge expires | Reject stale ACK; request fresh checkout |
| Customer scans QR using another phone | Original browser monitors same order state |
| Real payer debit evidence unobtainable | Unresolved, not automatically successful |

## Business UX

A merchant views **Payment, amount, customer-facing transaction reference where actually available, state and evidence timeline**. Raw order, journal, tenant and internal test IDs remain strictly operational identifiers in the service/database and must not appear as product-branded payment references.

See [architecture and interfaces](SYSTEM-ARCHITECTURE.md) and [test plan](TEST-AND-RELEASE.md).
