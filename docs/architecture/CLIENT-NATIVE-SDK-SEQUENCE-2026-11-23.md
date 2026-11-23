# Client sequence — target flow with verified boundaries

```mermaid
sequenceDiagram
 autonumber
 actor Customer
 participant SellerApp as Seller Android App
 participant SellerBackend as Seller Backend
 participant Disha as DISHA API
 participant SDK as Native DISHA SDK (payer device)
 participant UPI as UPI App
 participant Signals as Android Debit Signals (payer device)
 Customer->>SellerApp: Open checkout
 SellerApp->>SellerBackend: Request order checkout
 SellerBackend->>Disha: Create existing order-bound payment session
 Note over SellerBackend,Disha: Screenshot's POST /v1/checkout/session is proposed, not a confirmed route
 Disha-->>SellerBackend: Order / bounded checkout token
 SellerBackend-->>SellerApp: Checkout session and original payee
 SellerApp->>SDK: Initialize native host, only when installed on payer device
 Customer->>SellerApp: Pay now
 opt Native host available
  SDK->>SDK: Check app policy and session validity
  Note over SDK: Root/debugger/integrity PASS/BLOCK policy not established as deployed
  SDK->>Disha: Enroll session-bound public key (historical endpoint)
  Disha-->>SDK: Enrollment/authorization status
 end
 SellerApp-->>Customer: Show exact seller UPI ID
 Customer->>UPI: Open installed UPI app with original URI
 opt Payer installed SDK host, consented notification access
  UPI-->>Signals: Optional app notification; not a trusted bank callback
  Signals-->>SDK: Device-local observed notification
  SDK->>SDK: Filter and compare source, amount, payee, order; sign observation
  SDK->>Disha: Send session-bound signed observation
  Disha->>Disha: Verify signature, session, replay, reference, expiry
  Note over Disha: Evidence remains UNVERIFIED without authenticatable bank source
  Disha-->>SellerBackend: Read-only evidence state
  SellerBackend-->>SellerApp: Evidence state (pending/unverified/conflict)
  SellerApp-->>Customer: Show truthful evidence result
 end
 alt Security policy disallows handoff
  SDK-->>SellerApp: Stop native handoff; show refusal with reason
 else No trustworthy debit proof
  Disha-->>SellerApp: Pending / unresolved (never fabricated success)
 end
```

The exact sequence in the supplied screenshot is a **target**, not a fully validated live pipeline. Seller/payer device placement must be resolved before production.
