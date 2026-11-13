# Zero-Trust Fintech

A defensive, experimental UPI payment-session and forensic risk-assessment platform.

Start with [forensic-upi-engine/README.md](forensic-upi-engine/README.md).

**Payment integrity:** screenshots, user-return redirects, UTR syntax and device telemetry are *not* proof of payment. Only independently authenticated bank/PSP evidence can change a session to PAID. The included provider callback handler is an integration contract; a real provider must be connected and validated before processing live money.

License: MIT (see [LICENSE](LICENSE)).
