# Records, reconciliation and receipts — what counts as completed

A merchant should be able to explain not just the amount requested but what occurred after it was requested. DISHA separates **operational events**, **customer-origin observations** and **qualified financial records**.

## The three record families

### 1. The order

An order captures the amount, the intended receiving UPI account, the merchant, the customer-facing reference and the validity window. This is a request to pay, not a transaction credit.

### 2. The evidence trail

DISHA Vault can attach the authorized browser handoff and any permitted return parameters. It may contain a UTR candidate, claimed success/failure or no reference at all. This evidence is useful for review but is not, by itself, a confirmation that money reached the merchant.

### 3. The financial record

A separately qualified account-credit event, when available and correctly matched, supports a completed transaction and balanced ledger entry. The financial path checks that the credit belongs to the proper merchant, receiving address, amount, reference and original order. Conflicting qualified events are quarantined.

## Payment status lifecycle

~~~mermaid
stateDiagram-v2
 [*] --> Requested
 Requested --> Pending: Customer checkout opened
 Pending --> Observed: Device return or reference observation
 Observed --> AwaitingCredit: Evidence recorded
 Pending --> AwaitingCredit: No return details
 Requested --> Expired: Session lifetime ends
 Pending --> Expired: Session lifetime ends
 AwaitingCredit --> Completed: Qualified matching credit
 AwaitingCredit --> Review: Conflicting or unqualified evidence
 Review --> Completed: Later qualified matching credit
 Expired --> Completed: Independently reconciled valid credit
 Completed --> [*]
~~~

This diagram is a business-level lifecycle. Product screens may show different labels for intermediate states. Expiry does not prove that money never moved; likewise a UTR claim does not prove that it did.

## Reconciliation decisions

| Financial situation | Business treatment |
| --- | --- |
| No qualified credit available | Keep unresolved; do not issue completed receipt |
| Authenticated matching credit, once | Record completed transaction and balanced ledger |
| Duplicate of a previously posted credit | Reuse existing financial outcome; never double count |
| Credit for the wrong merchant | Quarantine |
| Different amount or recipient | Quarantine |
| Credit outside the permitted matching window | Quarantine / investigate |
| Customer shares a screenshot or reference only | Store as an unverified claim, not as a bank-credit entry |
| Browser returns with “success” text | Observation only; no automatic settled record |

## Why a balanced ledger matters

A merchant's financial history must reconcile. DISHA has accounting structures designed to record both sides of a completed transaction as matching entries. Their value is not an animated green badge; it is that the recorded amount must remain internally consistent and tied to a specific order.

**A ledger is not a substitute for the bank's actual statement.** When the bank-facing credit source has not been established, the ledger must not invent money.

## Customer receipt

A confirmed checkout can present the recorded order, amount, recipient and reference and allow printing or sharing. This receipt should be available **after** a qualifying completed financial record, not immediately after a user returns from a payment app.

Until then, the customer should see a truthful pending, checking or expired state. A fresh payment session should not silently reuse an expired unresolved request.

## Exceptions and dispute resolution

When a customer says “I paid,” the business can use the order history and evidence log to investigate. Staff should look for the correct merchant and amount, a legitimate statement credit, an appropriate reference match, and any conflicting use of the same reference. A mismatch becomes an exception, not a second sale.

## Current implementation versus release status

The active product includes the financial matching rules, duplicate controls, quarantine inbox concept, exact-value ledger path and a customer receipt presentation. The latest production review states that the independent authenticated real-world credit source is **not yet connected**. Real-money settlement-to-receipt acceptance therefore remains incomplete.

[DISHA Vault](DISHA-Vault.md) · [Fraud controls](Fraud-and-Risk-Protection.md) · [Home](Home.md)
