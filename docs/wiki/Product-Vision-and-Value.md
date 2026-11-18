# The DISHA vision — Merchant-owned payment intelligence

<img src="../../public/assets/disha-8-2-wordmark-cropped.png" width="300" alt="DISHA 8.2">

## The money moves on UPI. The intelligence belongs to you.

Digital payments made transferring money easier. They did not automatically make every business payment easier to explain.

A customer can show a reference number. A storefront can display a QR. A seller can receive a screenshot. But a business still needs one coherent answer to the question that matters: **what happened to this particular order?**

DISHA 8.2 is designed around that question.

It gives merchants a single environment where **the intended order, the customer's checkout journey, available evidence, payment discrepancies and financial records belong together**.

## The five problems DISHA solves

| Business pain | The DISHA approach | Business impact |
| --- | --- | --- |
| A reference number has no clear order identity | Start with a fixed amount, recipient, reference and time window | Traceable customer payment requests |
| Payment screenshots may be misleading | Inspect authorized handoff observations and reference conflicts separately from actual credit | Fewer guess-based decisions |
| Receiving accounts are difficult to coordinate | Manage personal and bank-issued merchant UPI addresses in one workspace | Clearer account selection and payment history |
| Finance has to piece together multiple systems | Connect order context to qualified credit evidence and ledger entries | More coherent financial records |
| Growth creates more platform dependency | Merchant-controlled software and one-time commercial model | Better clarity about software ownership and costs |

## The DISHA business model

~~~mermaid
flowchart LR
 A["Merchant-owned<br/>Order context"]:::blue --> B["Customer UPI<br/>Payment experience"]:::blue
 B --> C["DISHA Vault<br/>Authorized evidence"]:::purple
 C --> D["Risk intelligence<br/>Check conflicts"]:::orange
 D --> E["Qualified credit<br/>Financial match"]:::green
 E --> F["Business records<br/>Receipt · Ledger · Reports"]:::green
 classDef blue fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
 classDef purple fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
 classDef orange fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
 classDef green fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
~~~

### 1. The merchant owns the order

DISHA begins before a UPI app opens. It records the precise receiving account, exact amount and original order. A payment link is therefore a business instrument, not just a generic QR.

### 2. The customer keeps their familiar payment app

The checkout presents supported UPI applications and a QR alternative. The external banking network moves the funds; DISHA stays focused on the surrounding business experience.

### 3. The Vault remembers the authorized journey

DISHA Vault associates a supported device authorization and available browser-return information with the original order, leaving unavailable information unclaimed.

### 4. Fraud intelligence challenges inconsistency

DISHA examines unusual timing, amount mismatches, unexpected recipients and conflicting reference claims. Suspicion is treated as information to investigate rather than a reason to manufacture a successful or failed payment.

### 5. Financial records require a different kind of evidence

The merchant's accounts are served by financial reconciliation and balanced ledger records. A payment-looking image is not a balance-sheet entry. Where qualified credit evidence matches the order, the completed outcome can support a receipt.

## Who DISHA is designed for

**Local commerce** — Shops and independent merchants who want better payment-request clarity and fewer screenshot disputes.

**Digital-first businesses** — Sellers with order-based checkout, virtual products, subscriptions or services that need consistent payment records.

**High-volume operations** — Businesses with multiple receiving accounts, reporting requirements and operational exceptions.

**Platform owners** — Operators responsible for approved merchant access, oversight, identity separation and business accountability.

## A different definition of control

Control is not pretending to own the bank rail or claiming that every fee can be eliminated. It is the ability to understand the request, choose eligible receiving accounts, review the available evidence and maintain trustworthy merchant records without outsourcing every layer of the software experience.

**DISHA 8.2: own the experience, understand the evidence, keep the record.**

[Platform architecture](Platform-Architecture.md) · [Customer journey](End-to-End-Journey.md) · [Home](Home.md)
