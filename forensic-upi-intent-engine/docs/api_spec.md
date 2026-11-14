# Signed Client Attestation API

## Device enrollment

Table client_device_keys stores user_id, device_id, public_key_b64, hardware_attested and is_active. A privileged enrollment process must independently validate key provenance before setting hardware_attested=TRUE. There is no open device registration endpoint.

## POST /v1/sessions

Internal endpoint requiring Authorization: Bearer WORKER_API_KEY. Supply client_user_id and client_device_id in addition to merchant_id, merchant_reference, amount_paise, currency and note. Both identities must bind to the enrolled device before attestation.

## POST /v1/client/attest-payment

```json
{
  "session_id": "c3fb2561-32dc-4e87-8910-983e80bcd376",
  "user_id": "user1",
  "device_id": "device1",
  "utr": "123456789012",
  "amount": "500.00",
  "timestamp": "2026-11-14T13:00:00Z",
  "integrity": {"elapsed_ms": 9000, "retry_count": 0, "image_ela_score": 12.0},
  "client_signature": "<base64 Ed25519 signature>"
}
```

Sign the UTF-8 JSON of all fields **except client_signature**, with recursively sorted keys and compact separators. The timestamp must use a normalized RFC 3339 representation. Amount uses exactly two decimal digits. Sign the precise bytes reconstructed by canonical_attestation_bytes in the backend.

Accepted response:

```json
{"status":"CLIENT_ATTESTED","client_finalized":true,"attestation_hash":"<sha256 hex>","duplicate":false}
```

Exact retries return duplicate:true. Different claims for an already-attested session are rejected. The ledger is append-only.

## Device Integrity Checks

Signed elapsed_ms, retry_count, UTR formatting and optional image_ela_score are evaluated. Any flagged integrity threshold violation gives DEVICE_INTEGRITY_REJECT and blocks recording. These metrics define rejection policy, not independent cryptographic evidence of runtime behavior.

## Outbound notifications

GET /v1/client/attestations/recent?after_id=0 requires internal WORKER_API_KEY and returns an ordered event feed. Import n8n-workflows/04_attestation_notifications.json, configure its Header Auth credential and CLIENT_ATTESTATION_NOTIFY_URL, then activate it. Delivery is at least once; deduplicate by attestation_hash.

## Installation

Fresh worker deployments use infra/postgres/init.sql. Existing database installs need database/migrations/003_client_device_attestation.sql after backup. Native database/schema.sql is a separate schema and not interchangeable with the worker schema.

Native device signing, hardware key provenance validation and verified device registration remain integration tasks. Never embed private signing keys or internal API credentials in mobile JavaScript.
