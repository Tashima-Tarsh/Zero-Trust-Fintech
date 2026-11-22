# DISHA 8.2 — Frequently Asked Questions

### Does DISHA replace a UPI app or bank?

No. The customer authorizes using a supported UPI app on existing UPI and bank rails. DISHA owns the merchant checkout, trust handshake and operational evidence layer.

### Does the intended product require a payment aggregator?

No. The architecture targets direct P2P and correctly registered P2M UPI initiation under merchant control. It is not a claim that every merchant or account can bypass existing banking rules.

### What are DISHA Vault and Quantum Signal?

Vault is order-linked device and browser-journey evidence. Quantum Signal establishes the server order twin and a two-way, short-lived session challenge/ACK before the native UPI handoff.

### Does the handshake itself establish that the payer was debited?

No. A browser-to-server ACK establishes DISHA session continuity. The proposed authenticatable payer-side debit evidence channel is a separate feature that has to be demonstrated using controlled real transactions.

### Must customers install DISHA, share SMS or manually enter UTR?

No in the target experience. Customers use Chrome/QR and their existing payment app. Real app return fields vary, so DISHA must handle missing UTR/TR without inventing it.

### Can I use my personal VPA or a P2M merchant account?

Both are separate pathways. P2M requires a truly registered merchant account and corresponding MCC; P2P must not imitate a merchant transaction.

### Is DISHA free to operate?

The commercial target is one-time software pricing with no DISHA transaction-percentage charge. Hosting, bank and other operational costs can still apply.

### Can I consider the current repository production ready?

Not yet. Quantum Signal has merged, but physical pre-PIN UPI acceptance and authenticatable debit-evidence/receipt proof have not cleared release gates.

[Home](Home.md) · [Architecture](Platform-Architecture.md) · [Tests](../architecture/TEST-AND-RELEASE.md).
