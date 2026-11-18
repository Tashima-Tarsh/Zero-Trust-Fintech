# DISHA Vault — Evidence belongs to the order

<div align="center"><img src="../../public/assets/disha-vault-sculpture.svg" width="330" alt="DISHA Vault visual identity"></div>

**The Vault is a device-authorized evidence experience—not another wallet.**

A merchant typically receives a payment reference after the fact. DISHA Vault instead preserves context about the journey that the customer actually authorized through the original checkout.

## What the customer experiences

~~~mermaid
flowchart LR
 A["Open payment link"]:::blue --> B["Authorize device<br/>Passkey"]:::purple
 B --> C["Choose familiar UPI app"]:::blue
 C --> D["Attempt payment"]:::gray
 D --> E["Return to checkout<br/>when supported"]:::blue
 E --> F["Vault records<br/>available evidence"]:::purple
 classDef blue fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
 classDef purple fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
 classDef gray fill:#293241,stroke:#CBD5E1,color:#FFF,stroke-width:2px;
~~~

The passkey ceremony authorizes the device handoff. The bank app remains external. Once the browser returns, DISHA can collect permitted browser-return information, bind it to the original order and record an evidence event.

**The Vault does not see a customer's PIN, read an external UPI app's private screen or discover a bank balance.**

## What the Vault remembers

| Vault element | Why it matters |
| --- | --- |
| **Original order identity** | Prevents the evidence from floating without a payment request |
| **Authorized device handoff** | Connects a supported customer device ceremony to that order |
| **Browser departure and return** | Adds context about the attempted UPI journey |
| **Available reference candidate** | Gives the merchant a clue to investigate, when one is actually exposed |
| **Exact amount and payee comparison** | Shows whether visible return details agree with the original order |
| **Timing and duplicate signals** | Identifies late, repeated or conflicting event claims |
| **Evidence timeline** | Keeps a clear record of what was observed without asserting a financial credit |

## Three scenarios

**Scenario A — The browser returns without a reference.** DISHA can record the return, but does not create a missing UTR or mark the payment paid.

**Scenario B — A reference is visible but belongs to another order.** DISHA can identify the conflict and keep it in the merchant's evidence history without crediting the wrong transaction.

**Scenario C — A qualifying credit record later matches.** The financial matching layer, separate from the Vault, can create a completed accounting record and customer receipt.

## Why this is more useful than another screenshot

The Vault establishes a richer history of the *attempted journey*. Its value is the distinction between what the first-party checkout actually observed, what a customer or app return claims and what a separate credit record can establish.

[**Explore the complete Vault architecture**](Vault-Architecture.md) · [Fraud intelligence](Fraud-and-Risk-Protection.md) · [Home](Home.md)
