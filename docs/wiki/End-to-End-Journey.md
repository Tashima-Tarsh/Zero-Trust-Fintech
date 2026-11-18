# End-to-end journey — from request to defensible receipt

DISHA 8.2 connects the commercial question ("which order is this?") to the customer action ("which UPI payment did they attempt?") and the accounting question ("is there a qualified financial credit?").

## The eight moments of a payment

### 1. Merchant access and receiving account

A business requests access, is reviewed by the platform owner and sets up its own workspace. It registers its receiving UPI address and the appropriate account type. A personal address is treated as P2P; a bank-issued merchant address is treated as P2M. Approved tenants receive separate records and visibility.

### 2. Create a specific order

The merchant enters the amount, optional order reference and description. DISHA fixes the payee and receiving-account classification against that order and creates its own reference and short validity window. Later changes to the merchant's default receiving account do not rewrite an existing payment request.

### 3. Show the customer a clear checkout

The customer opens an order-specific link. The branded checkout presents the amount, receiving account type and UPI address, a live countdown, installed-app choices on supported phones, and a scannable QR alternative. The current order lifetime is three minutes.

### 4. Authorize the device handoff

On a supported device, DISHA Vault requests a passkey registration or authentication. This authorizes the checkout's handoff and binds the device event to the order. It does not authenticate the recipient's bank account or the eventual movement of money.

### 5. Use the existing UPI system

The chosen app receives a payment request with the intended payee and amount. The customer proceeds in that app. Wrong PIN, insufficient balance, app refusal and cancellation are possible real outcomes outside DISHA's control.

### 6. Observe the return—without pretending to know more

When the browser actually backgrounds and resumes, DISHA may capture permitted return details. Some UPI apps expose no usable reference. In that case Vault stores an observation of the return without inventing a UTR. A window closing or returning to focus is not itself a success or failure.

### 7. Assess evidence and reconcile

DISHA compares available evidence with the order: exact recipient, exact amount including paise, permitted window, conflicting or repeated references, and previous records. Customer-origin evidence is kept **unverified**. If a qualified authenticated credit record is available from a real financial source, DISHA checks its match to the order, then records the completed entry. Suspicious or inconsistent qualified events go to quarantine for review.

### 8. Record and communicate the outcome

The merchant sees pending, expired, completed or exception-related states, evidence and ledger records. A completed checkout can offer a printable/shareable receipt. An unconfirmed payment should not be represented as settled merely because the customer saw a success animation elsewhere.

## Journey map

~~~mermaid
flowchart TD
 M["Merchant: create request"] --> O["Fixed order: amount + recipient + expiry"]
 O --> P["Customer: open link / QR"]
 P --> V["DISHA Vault: authorize handoff"]
 V --> U["Customer UPI app: payment attempt"]
 U --> B["Existing UPI banks and network"]
 U --> R["Browser: observed return, if any"]
 R --> E["DISHA: record order-bound evidence"]
 E --> T{"Any discrepancy?"}
 T -->|Yes| Q["Flag / quarantine relevant claim"]
 T -->|No| W["Await independently qualified credit"]
 B -. "Financial record from a separately authenticated source" .-> C["Credit reconciliation"]
 W --> C
 C --> X{"Recipient + exact amount + order + unique reference match?"}
 X -->|No / missing| Z["Pending or investigate; no paid receipt"]
 X -->|Yes| L["Completed record and balanced ledger"]
 L --> I["Merchant dashboard and confirmed receipt"]
~~~

## What the business sees

| Situation | Customer view | Merchant view | Accounting treatment |
| --- | --- | --- | --- |
| Link created, no payment yet | Payment options and countdown | New / pending order | No completed financial entry |
| Browser returns without reference | Checking / pending | Vault observation | No completed financial entry |
| Customer provides a reference or screenshot | Status remains subject to verification | Unverified claim and matching signals | No completed financial entry from claim |
| Wrong amount or another payee | Clear unresolved state | Mismatch / review | No matched completed entry |
| Session expires | Expired request or pending reconciliation | Expired operational window | No automatic success or automatic proof of non-payment |
| Qualified matching credit recorded | Confirmed status and receipt | Completed record and ledger | Balanced financial posting |
| Qualified credit event conflicts | No confirmed receipt | Quarantined exception | No posted completed entry |

## The product architecture, in business language

**Customer layer:** branded checkout, QR, installed UPI applications, accessibility and fallback.

**Trust layer:** device handoff, event history, temporal and reference checks, and explicit uncertainty.

**Financial layer:** independently sourced credit matching, merchant-specific accounts, exception quarantine and balanced records.

**Operations layer:** merchant dashboard and exports; separate platform-owner approvals, monitoring and incident tracking.

**Existing external rails:** banks, customers' UPI apps and the NPCI system handle the actual transfer of funds. DISHA does not hold the payment funds.

## What remains to validate

The repository includes automated and Android-emulator paths, but not a complete live-bank sign-off. Real ₹1 payments must establish correct app acceptance for both personal and registered merchant UPIs. A qualified financial-credit integration must then prove the final ledger and receipt path. Until those gates are passed, this document describes the designed and coded journey, not a certified production guarantee.

[Back to the knowledge centre](Home.md)
