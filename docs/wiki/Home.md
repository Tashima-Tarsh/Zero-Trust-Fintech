# DISHA 8.2 — Product Knowledge Centre

<img src="../../public/assets/disha-8-2-wordmark-cropped.png" alt="DISHA 8.2 official logo" width="320">

**Direct UPI checkout, DISHA Vault, Quantum Signal and merchant-controlled transaction intelligence.**

DISHA is designed for businesses that want direct P2P or correctly bank-registered P2M UPI payment initiation without a payment aggregator in the intended payment path. It creates exact order-bound requests and connects Android app handoff, a two-way session handshake, device evidence and UTR/TR correlation.

### Start here

- [Product vision and commercial model](Product-Vision-and-Value.md)
- [Platform architecture and technology stack](Platform-Architecture.md)
- [Complete payment journey and Mermaid sequence](End-to-End-Journey.md)
- [DISHA Vault](DISHA-Vault.md) and [Vault architecture](Vault-Architecture.md)
- [P2P, P2M and receiving accounts](P2P-P2M-and-Receiving-Accounts.md)
- [Fraud and evidence controls](Fraud-and-Risk-Protection.md)
- [Merchant and owner workspaces](Merchant-and-Owner-Workspaces.md)
- [Transactions, ledger and receipts](Records-Reconciliation-and-Receipts.md)
- [Pricing](Commercial-Model-and-Savings.md)
- [Frequently asked questions](FAQ.md)

**Engineering source of truth:** [TDD/IDD](../architecture/SYSTEM-ARCHITECTURE.md) · [End-to-end design](../architecture/END-TO-END-FLOW.md) · [Release tests](../architecture/TEST-AND-RELEASE.md).

**Release status:** Quantum Signal code merged, opt-in `qs=1`. Actual Android pre-PIN acceptance and authenticatable payer-debit evidence remain open validation gates. No simulated transaction is presented as a real success.
