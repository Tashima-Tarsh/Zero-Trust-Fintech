# DISHA Vault — device-bound evidence for each order

**DISHA Vault is not a wallet. It is a memory of the authorized checkout journey.**

The product is designed to answer: did the customer authorize the device handoff? Was the merchant's order still current? Did the browser actually leave and return? What payment information, if any, did the return expose? Is that information consistent with the order?

## The customer experience

1. The customer opens the DISHA checkout with the merchant's recipient and amount already present.
2. They select **Touch to Pay**. On a supported device, an existing passkey is used or a new device passkey is registered.
3. They choose a supported UPI app; some devices may require an additional tap to open the external app after the passkey step.
4. Their UPI app handles the payment attempt. DISHA is not inside the banking application.
5. If the customer returns to the browser, the Vault makes the observed event available to that checkout.
6. The checkout securely attaches the event to the original order and shows that the status is being checked.

## What the Vault can remember

| Information | Interpretation |
| --- | --- |
| Checkout order and authorized Vault session | Which order the handoff belonged to |
| Browser background and return | Whether the page observed a handoff/return sequence |
| Event time and evidence ID | When the observation occurred and whether it is a duplicate |
| Order's intended amount and recipient | What the customer was asked to pay |
| Browser-visible return reference, when supplied | An **unverified candidate**, not guaranteed credit |
| Conflicts, expiry and timing classification | Reasons the evidence needs caution |
| Successful evidence storage acknowledgement | Confirmation that the observation was recorded, not that funds moved |

A one-time, order-bound authorization helps reject evidence submitted against someone else's order. Repeated submissions of the same event do not create multiple financial events.

## Evidence and payment success are deliberately separate

~~~mermaid
flowchart TD
 A["Touch to Pay / device authorization"] --> B["Order-bound handoff"]
 B --> C["Existing UPI app"]
 C --> D["Browser returns, if supported"]
 D --> E["Vault captures permitted observations"]
 E --> F{"Reference or claim present?"}
 F -->|No| G["Return observed; no UTR invented"]
 F -->|Yes| H["Unverified UTR/status candidate"]
 G --> I["Merchant evidence history"]
 H --> I
 I --> J["Await distinct qualified credit evidence"]
 J --> K["Matching credit -> completed record"]
~~~

## What it cannot do

DISHA Vault cannot see a bank account balance, read another app's private transaction screen, obtain an absent UTR, decide that the bank accepted a PIN, or independently prove money arrived. A passkey proves a device credential ceremony, not the correctness of a banking transfer. Some browsers and UPI apps will not return usable fields; private browsing or moving to another tab can interrupt the handoff.

## Why this matters to merchants

Instead of treating an emailed screenshot as a definitive answer, the merchant receives an order-linked sequence: what was requested, which authorized browser event occurred, whether a reference was exposed and whether a separate completed credit was established. This is particularly valuable in a dispute, because **a clearly documented unknown is more trustworthy than a fabricated success**.

## Current product position

The Vault implementation, evidence classifications, duplicate-event controls and related tests are present in the active product. Some passkey challenges remain process-local and need hardening for multiple application replicas. Real device/app compatibility and return coverage have not been comprehensively certified.

Read also: [Fraud protection](Fraud-and-Risk-Protection.md) · [Records and receipts](Records-Reconciliation-and-Receipts.md).

[Back to the knowledge centre](Home.md)
