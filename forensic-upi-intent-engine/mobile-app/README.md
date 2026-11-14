# React Native client scaffold — device attestation

The client includes session display, handoff UI, optional user-consented
integrity observations, and mobile-app/src/services/deviceAttestation.js.

The attestation service constructs a canonical JSON claim containing session,
user/device identity, action reference, exact amount, timestamp and integrity
observations. The signed claim is sent over HTTPS to
POST /v1/client/attest-payment.

The signBase64 callback is **not** a software placeholder key. It must be
implemented by an enrolled, device-native secure signing module and must keep
private key material outside the JS runtime.

Android build files and native signing/enrollment code still need to be
integrated for a running device application. iOS build scaffolding is also
incomplete. No secret internal worker credentials belong in the mobile app.
