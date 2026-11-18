# DISHA 8.2 — Product Knowledge Centre

**The money moves on UPI. The intelligence belongs to you.**

Welcome to the product home for DISHA 8.2, merchant-owned payment software for direct UPI checkout, device evidence, fraud resistance, financial records and business operations.

DISHA helps a merchant answer four questions consistently: **Who was meant to receive the money? What did the customer attempt? What evidence exists? What credit, if any, can be accounted for?**

This knowledge centre documents the **active product as seen in repository code on 19 November 2026**, along with what remains a release goal. It is intentionally written for merchants, product evaluators, business partners and operators.

## Choose your starting point

| I want to understand… | Read |
| --- | --- |
| What problem DISHA solves, and why it exists | [Product vision and value](Product-Vision-and-Value.md) |
| The entire payment from creation to ledger | [End-to-end journey](End-to-End-Journey.md) |
| What DISHA Vault remembers | [DISHA Vault](DISHA-Vault.md) |
| How suspicious payments are challenged | [Fraud and risk protection](Fraud-and-Risk-Protection.md) |
| What a merchant and the owner can manage | [Workspaces](Merchant-and-Owner-Workspaces.md) |
| The difference between personal and merchant UPI | [P2P and P2M](P2P-P2M-and-Receiving-Accounts.md) |
| When a receipt is issued and what a ledger means | [Records, reconciliation and receipts](Records-Reconciliation-and-Receipts.md) |
| The proposed business model and savings | [Commercial model and savings](Commercial-Model-and-Savings.md) |
| What is built, what is blocked, and delivery milestones | [Release status and roadmap](Release-Status-and-Roadmap.md) |
| Straight answers to common questions | [FAQ](FAQ.md) |

## Product principles

**Merchant ownership.** Businesses control their own receiving account configuration and operational data rather than depending on a DISHA-controlled funds balance.

**Evidence over appearance.** A green checkmark, device return or customer-provided UTR is not silently promoted into an account credit.

**One order, one context.** Payee, amount, classification, time window and evidence remain connected to their original order.

**Explain uncertainty.** When there is no qualified financial evidence, show pending, expired or under review rather than inventing payment success.

**Operational clarity.** Merchant staff and platform operators see their relevant orders, issues and records in their own workspaces.

## In one diagram

~~~mermaid
flowchart LR
 A["Merchant order"] --> B["Customer checkout"]
 B --> C["Existing UPI app and banks"]
 B --> D["DISHA Vault observations"]
 C --> E["Qualified financial-credit evidence, when available"]
 D --> F["Risk and exception review"]
 E --> F
 F --> G["Merchant records and confirmed receipt"]
~~~

The customer does not need a new DISHA wallet. DISHA surrounds the existing UPI journey with software for business operations and evidence interpretation.

> **Current release gate:** The product is **NO-GO for external real-money merchant onboarding**, pending bank-app acceptance, merchant P2M validation, an authenticated financial-credit source and independent acceptance testing. This is a product maturity statement, not an assertion that checkout screens or source code do not exist.

**Explore:** [Product README](../../README.md) · [Website](https://disha8-2.thenitishkr.in/) · [Roadmap](Release-Status-and-Roadmap.md)

_These versioned Markdown pages are the repository's publishable wiki source. GitHub's separate /wiki site requires a separate Wiki-publishing action._
