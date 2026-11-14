# Device-attestation architecture

~~~mermaid
flowchart LR
  U[Enrolled user device] -->|Ed25519 signed action claim| A[FastAPI /v1/client/attest-payment]
  A --> K[(Enrolled public-key registry)]
  A --> I[Device Integrity Checks]
  A -->|transactional append| L[(Immutable client-attestation ledger)]
  A --> S[(Session: CLIENT_ATTESTED)]
  N[n8n scheduled reader] -->|cursor-based read| L
  N -->|outbound notification| O[Configured notification target]
~~~

## Trust and state boundaries

1. The user and device identifiers are bound to the session before attestation.
2. The worker checks a previously enrolled, active Ed25519 public key.
3. The signed claim covers session, identity, exact amount, reference, timestamp and integrity metrics.
4. The worker rejects altered signatures, stale claims, expired sessions, duplicate conflicts and failed integrity policy.
5. A record is appended once for each bound session under a database transaction; UPDATE, DELETE and TRUNCATE of the event ledger are rejected.
6. An accepted claim is terminal **only as CLIENT_ATTESTED**, the application's signed-device-action state.
7. Notification delivery occurs after the event has been recorded; consumers deduplicate by attestation_hash.

## Platform integration boundaries

Device key generation, hardware provenance evidence and enrollment are not completed by the transport-only React Native helper. Production installations must integrate an audited native signing module, enrollment validation, secure key lifecycle, database permissions, and end-to-end tests.
