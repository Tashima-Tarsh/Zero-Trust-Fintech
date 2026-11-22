# DISHA 8.2 — End-to-End Payment Journey

The system is designed around **payer-side debit evidence, order-bound Vault records, Quantum Signal ACK and UTR/TR correlation**—not a conventional payment-aggregator hosted checkout.

```mermaid
sequenceDiagram
 autonumber
 actor Merchant
 participant API as DISHA Backend
 participant PG as PostgreSQL
 participant Checkout as Android Chrome
 participant Vault as DISHA Vault
 participant Quantum as Quantum Signal
 participant App as UPI Application
 participant Evidence as Evidence Decision
 Merchant->>API: Request exact P2P/P2M amount and recipient
 API->>PG: Persist order, account class, TR and expiry
 API-->>Checkout: Checkout page and original UPI URI
 opt Higher-assurance Vault
  Checkout->>Vault: Optional device authorization
  Vault->>PG: Bind Vault session to original order
 end
 Checkout->>Quantum: Start twin
 Quantum->>PG: Store order snapshot
 Checkout->>Quantum: Request challenge
 Quantum-->>Checkout: Short-lived challenge
 Checkout->>Quantum: ACK original challenge
 Quantum->>PG: Persist validated ACK
 Checkout->>App: One deliberate Proceed / native Intent
 Checkout->>Quantum: Record HANDOFF and BACKGROUND
 alt UPI app rejects before PIN
  App-->>Checkout: Browser resumes, if available
  Checkout->>Quantum: Return observation and error category
 else Payer authorizes in UPI app
  App-->>Checkout: Permitted return fields, if provided
  Checkout->>Quantum: RETURN with candidate UTR
  opt Optional Vault evidence
   Checkout->>Vault: Record device-bound observation
  end
  Note over App,Evidence: Actual authenticated payer-debit signal still requires its own provenance
  Evidence->>Evidence: Match debit evidence, payee, exact amount, TR, UTR and replay constraints
 end
 Evidence->>PG: Persist validated decision or unresolved exception
 PG-->>Merchant: Real merchant payment status and evidence timeline
```

## Final decision rule

- **Completed:** independently authenticatable payment outcome, correct payee/amount/reference, no replay, accepted by the transaction state machine.
- **Pending / exception:** source not available, app returns without a reference, event conflict, expiry or incomplete proof.
- **Failed:** reported rejection or an observed matching terminal failure, without a fabricated completed ledger state.

Browser return is an event in DISHA's trust timeline; it must not be confused with independently authenticated payer debit.

The detailed sequence, decision tree and every exception are maintained in [the canonical Mermaid flow](../architecture/END-TO-END-FLOW.md).
