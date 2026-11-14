# Phase 2 — device-integrity API

POST /v1/intent/evaluate accepts an authenticated internal request. Its job is
consented evidence processing and immutable device-integrity diagnostics.

Example:

~~~json
{
  "merchant_id": "demo",
  "session_id": "00000000-0000-4000-8000-000000000001",
  "submission_id": "00000000-0000-4000-8000-000000000002",
  "time_in_app_ms": 8400,
  "target_package": "com.example.sample",
  "claimed_utr": "123456789012",
  "retry_count": 0,
  "screenshot_consent": false
}
~~~

The optional screenshot_base64 requires screenshot_consent=true and is limited
to a small image. The same submission_id with different evidence is rejected.

Example decision fields:

~~~json
{
  "decision": "DEVICE_INTEGRITY_PASS",
  "integrity_passed": true,
  "risk_score": 0,
  "risk_flags": ["no_image_supplied"]
}
~~~

A violating measurement produces DEVICE_INTEGRITY_REJECT. Diagnostics alone do
not finalize a session. Final client-action acceptance requires the enrolled
device signature at /v1/client/attest-payment.
