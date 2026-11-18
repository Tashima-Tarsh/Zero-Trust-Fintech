# Fraud and risk protection — verify the relationship, not the picture

DISHA 8.2 approaches payment risk as a chain of questions about a specific commercial order. A convincing receipt screenshot alone is not enough; the system considers the intended recipient, amount, time, reference history, observed device journey and source of financial evidence.

**The aim is to reduce avoidable mistakes and manipulation—not to promise that fraud becomes mathematically impossible.**

## Risk categories the product addresses

| What can go wrong | DISHA's relevant control | What the control actually establishes |
| --- | --- | --- |
| A reference is copied from another order | Duplicate and conflicting UTR checks | The reference claim is not unique or is disputed |
| A customer shows an attractive but forged receipt | Customer-origin claims remain unverified | An image or text alone cannot create a completed ledger entry |
| The payment went to a different UPI address | Recipient matching | The available evidence does not match the intended payee |
| The amount is short or modified | Exact-paise order matching | The claimed or qualified credit amount must match the order |
| The customer reuses an expired link | Server expiry and time-window rules | The request is no longer valid for a new attempt |
| A bank/app returns pending or failure | Separate observation and credit states | The product does not mistake a status string for confirmed funds |
| A financial event is duplicated | Idempotent financial posting and UTR ownership | The same qualified event is not counted twice |
| A financial event belongs to a different merchant | Tenant and account matching | One merchant cannot receive another merchant's financial record |
| An authorized event contains contradictory details | Risk review and quarantine | The item needs investigation instead of automatic approval |

## Three trust levels

**Level 1 — What was intended.** The order says whom to pay, how much, the receiving account type and when the window expires.

**Level 2 — What was observed or claimed.** A browser handoff, returned fields, a customer-supplied UTR or receipt can help investigate. They may be missing, incorrect, recycled or fabricated.

**Level 3 — What can be financially accounted for.** A qualifying independently authenticated, matching credit record supports a completed ledger event and the corresponding receipt. Without it, Level 2 does not become Level 3.

## The decision process

~~~mermaid
flowchart TD
 O["Original DISHA order"] --> A["Payee / amount / time / reference comparisons"]
 V["Vault device evidence"] --> A
 A --> C{"Missing or conflicting evidence?"}
 C -->|Yes| Q["Keep unverified; flag discrepancy"]
 C -->|No| P["Await qualifying credit evidence"]
 P --> F{"Independently qualified credit record received?"}
 F -->|No| N["Not confirmed"]
 F -->|Yes| M{"Exact order, amount, payee and unique reference?"}
 M -->|No| X["Quarantined exception"]
 M -->|Yes| L["Post completion and ledger"]
~~~

## Time and reference checks

DISHA uses a short, three-minute checkout session. Its temporal controls also distinguish an early observation, an observation inside the expected window and an expired return. These timing rules are **screening criteria**, not statistical proof that a payment succeeded.

A UTR can appear on pending or unsuccessful transfers. Therefore even a correctly shaped twelve-digit reference, an in-window return and a matching payee do **not** establish a bank credit by themselves.

## Operational fraud controls

The codebase includes merchant-specific account isolation, receiving-UPI health and availability fields, account pause controls, duplicate-event handling, evidence history, and quarantine of mismatched financial-credit events. The platform has a separate owner incident and release-control view.

The repository also contains broader VPA-routing and n8n automation designs. Their existence is not proof that all associated orchestration or bank-status monitoring is live.

## What the product does not claim

- No audited claim of 0% fraud, 99.7% accuracy, guaranteed fraud reduction or zero false positives.
- No guarantee that rotating receiving accounts prevents a bank restriction or an account freeze.
- No claim that a customer screenshot, PIN screen, UPI response text or browser return constitutes final financial settlement.
- No production certification until real-bank evidence, incident operations and independent security acceptance are established.

## Merchant playbook for disputed payments

If a customer says they paid but the order is not confirmed, locate the order, check the intended amount and recipient, inspect the recorded Vault observations and reference conflicts, and keep the order unresolved until an appropriate confirmed credit record can be matched. Escalate inconsistencies rather than releasing goods based only on an attractive image.

[Back to the knowledge centre](Home.md)
