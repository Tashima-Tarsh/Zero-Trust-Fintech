# Product vision — a better record of what happened to the payment

## The proposition

**DISHA 8.2 is merchant-owned payment intelligence around the existing UPI journey.**

It does not ask the customer to learn a new wallet or change banks. It asks the merchant to change how it creates, observes and accounts for a payment request.

A conventional "payment received" green tick can be reassuring, but the real commercial question is deeper: **did the right money reach the right receiving account for the right order, and what supports that conclusion?**

DISHA is built to preserve that distinction across the customer checkout, merchant workflow and financial record.

## Five operational problems

### 1. Orders and payment references become detached

A reference on a chat screenshot may not say which cart, service, receiving account or merchant it belongs to. DISHA begins by creating a fixed order context with the right payee, amount and expiry. This makes later evidence easier to compare.

### 2. A payment attempt looks too much like a completed payment

An app can open and close. A customer can return from it without entering a PIN, or with an uncertain result. DISHA records the available observation without treating the return as a bank credit.

### 3. Merchants have to investigate payment disputes manually

Wrong amount, reused reference, altered image, unexpected recipient and delayed credit can produce contradictory signals. DISHA links those signals to the order and gives the business a structured record for review.

### 4. The merchant's information is fragmented

Payment links, receiving accounts, reported outcomes, transaction history, evidence, notifications and financial records often live in separate tools. DISHA brings these parts together in merchant and owner workspaces.

### 5. The software business model can scale against the merchant

Some providers charge recurring software fees or a percentage on eligible transactions; fees vary by actual payment type and contract. DISHA proposes a one-time software and implementation license with costs transparently separated from applicable banking, infrastructure and support expenses.

## The product pillars

| Pillar | Product promise | What exists in the current repository |
| --- | --- | --- |
| **A clear checkout** | One order, one receiving account, one understandable payment request | Payment links, QR, app selection, three-minute expiry and P2P/P2M separation |
| **DISHA Vault** | Remember permitted evidence of the customer journey | Passkey-authorized handoff and order-bound browser evidence |
| **Fraud resistance** | Challenge conflicts rather than believe appearances | Payee, exact amount, reference, window and duplicate evidence checks |
| **Merchant operations** | Give each business a control room for its own orders | Business onboarding, payment creation, receiving accounts, reports, exports, notifications |
| **Financial accountability** | A real completion must have a real accounting basis | Qualified-credit reconciliation rules, quarantine and balanced-ledger path; live source remains unconnected |
| **Platform governance** | Controlled onboarding and oversight | Owner approvals, tenants, incidents, analytics and release settings |

## A practical story

Consider a merchant selling a digital service worth ₹500. The merchant creates a request for ₹500, sends the checkout and sees it in their own workspace. The buyer selects a UPI app. The browser later returns. DISHA Vault logs that return, but no UTR may be available; the order remains unresolved. If a qualified credit of exactly ₹500 can later be connected to that merchant's receiving account and order, DISHA can record it and produce a confirmed receipt. If a conflicting reference appears instead, the merchant has information to investigate rather than a fabricated sale.

## Who DISHA is for

**Independent merchants** who want a consistent way to create UPI requests, track outcomes and investigate ambiguous payments.

**Growing commerce businesses** that need organized receiving accounts, merchant staff workflows, reporting and cleaner order-to-payment records.

**High-volume platforms** evaluating a self-controlled payment operating layer with strong isolation, traceability and accountability. The current release is not yet qualified for real-money external launch at scale.

**Product and operations teams** responsible for evidence review, launch gates, exception handling and merchant support.

## Positioning boundaries

DISHA is not a bank or NPCI substitute. It does not supply a guaranteed merchant classification, guarantee zero account restrictions, make every UPI payment free under every contract, hold funds on behalf of merchants or guarantee that all banking apps reveal a UTR.

Its competitive differentiator is a coherent **merchant-owned evidence and operations experience** paired with a one-time software-commercial proposal, not a claim to defeat the banking system.

## The long-term ambition

Make payment operations more explainable, more portable and less dependent on manual screenshot-based decision-making. The roadmap is evidence-led: prove live bank acceptance, prove the credit-to-ledger path, validate Vault compatibility, and only then open controlled external merchant onboarding.

[Read the end-to-end journey](End-to-End-Journey.md) · [Return home](Home.md)
