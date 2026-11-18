# Railway financial reconciliation boundary

This feature does NOT establish live bank integration on its own. It stays
disabled unless a separately authenticated bank-account statement connector
has been installed, vetted, and configured. A secret HMAC alone does not
establish bank provenance. The upstream connector MUST independently verify
a real POSTED credit to the merchant receiving account before signing.

Config on the Railway Node service:
- RECONCILIATION_WEBHOOK_SECRET: long random secret, keep private.
- RECONCILIATION_SOURCE_ID: exact identifier of approved read-only source.
Do not enable either for tests with actual customer funds. The endpoint is
inactive if the variables are absent.

Ingest POST /api/reconciliation/credit with header X-Disha-Timestamp (Unix
seconds) and X-Disha-Signature (sha256=<hex HMAC of timestamp + '.' + raw JSON>).
Body fields are source, eventId, statementEntryId, direction=CREDIT,
status=POSTED, bankEvidence=VERIFIED_STATEMENT, merchantId, orderId, utr
(12 digits), payeeVpa, amountPaise (string integer), creditedAt (epoch ms).
A connector must not invent evidence absent from its bank-side source.

The API checks source identity, signing key, replay window, merchant tenant,
bank credit time against order window, exact amount/VPA and unique UTR.
A mismatch creates a QUARANTINED inbox record, not a payment success.
Matched entries atomically produce the merchant-owned double-entry journal,
legacy ledger, UTR binding, SUCCESS session state, and notification.

Before enabling real payments: integrate the actual bank account statement
source, independently validate attribution to order ID, test live Rs 1 credit
plus adversarial and duplicate cases, implement monitoring, secret rotation,
off-provider backups, and operator quarantine review. Never wire a customer
receipt, UPI app return, self-reported UTR or browser to this endpoint.
