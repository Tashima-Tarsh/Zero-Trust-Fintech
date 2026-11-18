# The DISHA payment journey — From order to receipt

**A single business journey. Distinct responsibilities. Transparent outcomes.**

[Home](Home.md) · [Full architecture](Platform-Architecture.md) · [Vault architecture](Vault-Architecture.md)

## Eight connected moments

| Stage | Customer and merchant experience | DISHA responsibility |
| :---: | --- | --- |
| **01 — Create** | Merchant selects an amount, recipient and order reference | Preserve the original receiving details and validity window |
| **02 — Present** | Customer opens a branded checkout with UPI apps and QR | Show the amount, exact payee and a three-minute timer |
| **03 — Authorize** | Customer uses a supported device passkey | Bind the Vault handoff to the original order |
| **04 — Hand off** | Customer opens a familiar UPI application | Preserve the intended UPI payment parameters |
| **05 — Attempt** | The existing UPI app and banks process the attempt | Do not equate app activity with merchant credit |
| **06 — Observe** | Browser returns, if supported | Record permitted return observations and classify discrepancies |
| **07 — Match** | A qualified financial-credit record becomes available | Check the merchant, order, exact amount, recipient and reference |
| **08 — Record** | The merchant sees a completed entry; customer receives a receipt | Maintain balanced accounting and make the result available |

## The connected customer experience

~~~mermaid
flowchart LR
 A["Merchant<br/>Creates order"]:::blue --> B["DISHA Checkout<br/>QR and UPI choice"]:::blue
 B --> C["DISHA Vault<br/>Device authorization"]:::purple
 C --> D["Existing UPI App<br/>Customer pays"]:::gray
 D --> E["DISHA Vault<br/>Return observation"]:::purple
 E --> F["Fraud Intelligence<br/>Evaluate context"]:::orange
 F --> G["Qualified Credit Matching"]:::green
 G --> H["Ledger<br/>Confirmed receipt"]:::green
 classDef blue fill:#103453,stroke:#38BDF8,color:#fff,stroke-width:2px;
 classDef purple fill:#30204F,stroke:#C084FC,color:#fff,stroke-width:2px;
 classDef orange fill:#472D18,stroke:#FBBF24,color:#fff,stroke-width:2px;
 classDef green fill:#103C31,stroke:#34D399,color:#fff,stroke-width:2px;
 classDef gray fill:#293241,stroke:#CBD5E1,color:#fff,stroke-width:2px;
~~~

The arrows describe the business journey, **not a claim that the app return creates a completed payment**. The final accounting step relies on its own qualified financial-credit record.

## End-to-end outcome branching

~~~mermaid
flowchart TD
  A["Customer attempts UPI payment"]:::external --> B["What did DISHA observe?"]:::vault
  B --> C["Order and evidence analysis"]:::risk
  C --> D{"Qualified financial credit available and exact match?"}:::risk
  D -->|"Yes"| Y["Completed financial record"]:::money
  Y --> R["Receipt and merchant ledger"]:::money
  D -->|"No financial credit yet"| P["Awaiting confirmation"]:::experience
  D -->|"Mismatch or duplicate"| Q["Exception review"]:::exception
  P --> S["Merchant order timeline"]:::experience
  Q --> S
  classDef experience fill:#103453,stroke:#38BDF8,color:#fff,stroke-width:2px;
  classDef vault fill:#30204F,stroke:#C084FC,color:#fff,stroke-width:2px;
  classDef risk fill:#472D18,stroke:#FBBF24,color:#fff,stroke-width:2px;
  classDef money fill:#103C31,stroke:#34D399,color:#fff,stroke-width:2px;
  classDef exception fill:#4A1F31,stroke:#FB7185,color:#fff,stroke-width:2px;
  classDef external fill:#293241,stroke:#CBD5E1,color:#fff,stroke-width:2px;
~~~

## Three viewpoints of the same order

**Customer** — A clear amount, receiving UPI identity, payment options, secure device authorization and an understandable status.

**Merchant** — An order-specific request, available device evidence, discrepancies, completed financial records, exports and customer-service context.

**Platform owner** — Merchant access governance, separately controlled business workspaces and oversight of incidents and financial exceptions.

## The business meaning of common outcomes

- **Pending:** An order exists, but a financially completed record has not been established.
- **Observed:** DISHA has evidence of part of the checkout journey; this is not the same as bank-credit evidence.
- **Expired:** The customer-facing request window has ended; a genuinely credited transfer may still require proper reconciliation.
- **Exception:** One or more claimed or qualified fields conflict with the intended order.
- **Completed:** Qualified financial evidence matches the original order and is represented in a balanced financial record.

[Fraud intelligence](Fraud-and-Risk-Protection.md) · [Records and receipts](Records-Reconciliation-and-Receipts.md) · [Home](Home.md)
