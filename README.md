<div align="center">
  <img src="assets/disha-logo.svg" width="84" alt="DISHA 8.2 symbol">
  <h1>DISHA 8.2</h1>
  <h3>Merchant-owned payment intelligence for direct UPI</h3>
  <p><strong>The money moves on UPI. The intelligence belongs to you.</strong></p>
  <p>One connected experience for payment requests, customer checkout, device evidence, fraud controls, reconciliation, and business records.</p>
  <p><a href="https://disha8-2.thenitishkr.in/">Explore DISHA</a> · <a href="docs/wiki/Home.md">Product knowledge centre</a> · <a href="docs/wiki/Release-Status-and-Roadmap.md">Product roadmap</a> · <a href="https://disha8-2.thenitishkr.in/request-access">Request access</a></p>
</div>

---

> **Release position — 19 November 2026.** The repository contains an operating checkout and merchant platform with automated tests, but its latest production assessment is **NO-GO for unmonitored external real-money merchant onboarding**. Real P2P/P2M bank-app acceptance and a live financial-credit source are not yet validated. This page describes built product capabilities while distinguishing them from launch commitments. See [release readiness](docs/wiki/Release-Status-and-Roadmap.md).

## What is DISHA 8.2?

DISHA is a merchant-controlled software environment built around India's existing Unified Payments Interface. It is **not a new bank, wallet, UPI network, or payment aggregator**. A customer pays using a familiar UPI application; the merchant uses DISHA to create the specific order, present the right receiving account, observe the payment journey, investigate suspicious evidence, and maintain a defensible record of what is actually known.

Its central idea is simple: **an attempted payment, a payment-looking receipt, and a confirmed credit are three different things**. DISHA is designed to keep them separate.

DISHA 8.2 brings the following into one product:

| Customer experience | Merchant operations | Trust and financial control |
| --- | --- | --- |
| Order-specific payment link and QR | Business profile and receiving UPI accounts | DISHA Vault device-authorized handoff |
| Personal UPI (P2P) and bank-issued merchant UPI (P2M) | Payment requests, order status and records | Amount, payee, reference and timing checks |
| Supported UPI app selection | Business dashboard, reporting and CSV exports | Duplicate and conflicting-reference monitoring |
| Three-minute checkout window | Notifications and voice-alert interface | Reconciliation, exceptions and balanced ledger design |
| Receipt after a confirmed financial record | Separate platform-owner command centre | Access control, tenant separation and release gates |

Some capabilities depend on external onboarding or integrations and are not yet active in production; they are called out below and in the knowledge centre.

## The business problem

A small shop, growing digital business or high-volume platform can initiate UPI transactions easily but still struggle to connect an order to reliable payment evidence. A customer may close the bank app, share a pending reference, show a copied success screen or return after the session expires. A merchant then has to decide whether to release goods or services without a clean chain of evidence.

At the same time, conventional payment arrangements may introduce software subscriptions, per-transaction platform charges, delayed operational reporting, reconciliation workload and reliance on external dashboards. These costs vary substantially by provider, transaction category and contract—**not every UPI transaction incurs an MDR fee**.

DISHA's response is to give the business control over its own payment software and the information surrounding each order, rather than claiming to change how banks transfer money.

## From order to defensible record

~~~mermaid
flowchart TD
 A["Merchant creates payment request"] --> B["DISHA fixes order, payee, amount and expiry"]
 B --> C["Customer sees payment link / QR"]
 C --> D["DISHA Vault authorizes device handoff"]
 D --> E["Customer opens chosen UPI app"]
 E --> F["Customer attempts payment through existing UPI network"]
 F --> G["Browser returns or session times out"]
 G --> H["Record available device and return observations"]
 H --> I{"Qualified account-credit record available?"}
 I -->|No| J["Pending / expired / review: do not issue paid receipt"]
 I -->|Yes| K["Match merchant, amount, payee, reference and time"]
 K --> L{"Exact, unique and consistent?"}
 L -->|No| M["Quarantine discrepancy for investigation"]
 L -->|Yes| N["Post completed financial record and balanced ledger"]
 N --> O["Show confirmed status and downloadable receipt"]
~~~

**Crucial distinction:** DISHA Vault records evidence about the authorized browser journey. It does not read another app's private banking screen or turn a browser return into proof that money arrived. The financial-credit reconciliation mechanism exists in code, but the live trusted credit source remains an outstanding release dependency.

### A payment, step by step

1. **Join and configure.** An approved business sets up its identity and the UPI receiving accounts it controls. Personal and merchant-classified accounts are treated differently.
2. **Create the order.** A merchant enters an amount and reference. DISHA keeps the selected payee, account classification and amount attached to that particular request.
3. **Share the experience.** A time-limited checkout opens with the amount, recipient details, familiar UPI app choices and a QR alternative.
4. **Authorize and hand off.** Where supported, the customer authorizes a device passkey through DISHA Vault and proceeds to an installed UPI app.
5. **Observe what happened.** Available browser-return and reference details are stored for the same order. Missing details stay missing; they are not invented.
6. **Evaluate discrepancies.** The product examines amount mismatches, unexpected recipients, expired sessions, reused reference claims and other warning signals.
7. **Reconcile qualifying credit.** If a separately verified financial credit arrives, DISHA associates it with the order and records the accounting outcome. Otherwise the order is not presented as paid.
8. **Give both sides clarity.** The merchant sees recorded statuses and exports; a confirmed checkout can show a receipt suitable for printing or sharing.

Read the [complete customer-to-ledger journey](docs/wiki/End-to-End-Journey.md).

## DISHA Vault — remember the journey, not just the screenshot

DISHA Vault is the product's device-evidence experience. It combines an order-bound device authorization with the evidence a first-party browser can observe when the customer goes to, and returns from, a UPI app. It records the event consistently, controls duplicate submission and helps the merchant understand when a reference is merely a claim.

It is **not a wallet, cash store, bank statement reader or independent payment guarantee**.

[Explore DISHA Vault](docs/wiki/DISHA-Vault.md)

## Fraud resistance by design

DISHA tests whether a claimed payment belongs to the correct order and whether the available facts agree. Its controls cover conflicting UTR claims, already-used references, time-window anomalies, different payees or amounts, duplicate evidence, forged-looking receipt claims and suspicious financial-credit mismatches. Inconsistent authenticated financial events are held for review instead of quietly marked paid.

This is **fraud-resistant design, not a promise of zero fraud**. The repository does not establish an audited numerical fraud-prevention rate.

[Understand the protection model](docs/wiki/Fraud-and-Risk-Protection.md)

## A merchant command centre, not another payment spreadsheet

The business workspace provides payment requests, order tracking, receiving-UPI management, multiple account import, transaction history, operational metrics, evidence views, reports, exports, notifications, and a ledger view. It also includes risk and voice-alert interfaces. Each approved merchant has a distinct workspace.

A separate **DISHA Platform Command** gives the owner visibility into access applications, merchant approvals, tenants, recorded transactions, evidence, incidents, platform analytics, and release settings. Owner test activity is labelled separately from external merchants.

[Explore the workspaces](docs/wiki/Merchant-and-Owner-Workspaces.md)

## P2P and P2M: a deliberate distinction

A **personal receiving UPI account (P2P)** and a **bank-issued merchant receiving UPI account (P2M)** are not interchangeable. DISHA creates their payment requests differently and preserves the original receiving-account classification on an order. It does not turn a personal UPI address into a merchant account or substitute fictional merchant credentials.

[How receiving accounts work](docs/wiki/P2P-P2M-and-Receiving-Accounts.md)

## Merchant economics: buy the software, retain control

DISHA's proposed commercial relationship is a **one-time software and implementation agreement** tailored to the business, rather than a DISHA percentage on every payment. Its economic opportunity comes from reducing applicable third-party software charges and manual reconciliation effort where the merchant's existing arrangement permits those savings.

Savings are **scenario-dependent**, not guaranteed. Banks, hosting, maintenance, external services, commercial licensing and other applicable fees remain separate.

| Illustrative monthly payment volume | Avoidable external platform fee, if applicable | Illustrative monthly difference before other costs |
| ---: | ---: | ---: |
| ₹10 lakh | 0.5% | ₹5,000 |
| ₹1 crore | 1.0% | ₹1,00,000 |
| ₹10 crore | 1.0% | ₹10,00,000 |

These are **arithmetic examples**, not observed DISHA customer savings or claims about UPI MDR. Compare your actual invoices and contracts.

[Commercial model and savings framework](docs/wiki/Commercial-Model-and-Savings.md)

## Product readiness at a glance

| Area | Position as reflected by the repository |
| --- | --- |
| Checkout, order timer, QR, UPI handoff | Implemented; simulated/mobile tests exist |
| Merchant onboarding, account management, payment links, reports | Implemented in the active Node merchant product |
| DISHA Vault and evidence classification | Implemented; cross-app/browser limits apply |
| Payee, amount, time and replay controls | Implemented, with residual testing and historical-provenance work |
| Financial ledger and qualified-credit reconciliation logic | Implemented; authenticated live credit source **not connected** |
| Real P2P and P2M acceptance by banks and payer apps | **Not verified** across the required live scenarios |
| n8n workflow catalogue | Stored in the repository; **not verified as an active production orchestration service** |
| Independent financial/security production sign-off | **Outstanding** |
| External merchant real-money launch | **NO-GO** pending acceptance gates |

The active merchant and checkout service is the root Node product. The repository also contains a separate Python/FastAPI implementation and legacy deployment mirrors; these are not proof that those independent services are running in production.

## Product knowledge centre

The [DISHA Product Knowledge Centre](docs/wiki/Home.md) is written for business owners, merchants, partners and product stakeholders—not API implementers.

- [Product vision and market problem](docs/wiki/Product-Vision-and-Value.md)
- [Complete end-to-end journey and architecture](docs/wiki/End-to-End-Journey.md)
- [DISHA Vault and device evidence](docs/wiki/DISHA-Vault.md)
- [Fraud and risk protection](docs/wiki/Fraud-and-Risk-Protection.md)
- [Merchant and owner workspaces](docs/wiki/Merchant-and-Owner-Workspaces.md)
- [P2P, P2M and receiving-account management](docs/wiki/P2P-P2M-and-Receiving-Accounts.md)
- [Reconciliation, ledger, receipts and exceptions](docs/wiki/Records-Reconciliation-and-Receipts.md)
- [Business model, savings and ROI](docs/wiki/Commercial-Model-and-Savings.md)
- [Release readiness and product milestones](docs/wiki/Release-Status-and-Roadmap.md)
- [Frequently asked questions](docs/wiki/FAQ.md)

## Ownership, access and licensing

DISHA 8.2 is **source-available under Business Source License 1.1**, not unrestricted open source. The repository license permits specified non-commercial use and requires a separate commercial agreement for business/production use. It identifies a future change license and change date. Review the [LICENSE](LICENSE) before use.

**Product and commercial enquiries:** [nitish@thenitishkr.in](mailto:nitish@thenitishkr.in) · [DISHA website](https://disha8-2.thenitishkr.in/) · [Request access](https://disha8-2.thenitishkr.in/request-access).

---

<div align="center"><strong>DISHA 8.2 · Own the payment experience. Know the state of every order.</strong><br>Documentation grounded in the repository at 19 November 2026. No real-money launch certification implied.</div>
