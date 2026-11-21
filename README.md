<div align="center">

<img src="public/assets/disha-8-2-wordmark-cropped.png" alt="DISHA 8.2 official logo" width="420">

# DISHA 8.2
### Direct UPI. Device-bound trust. Merchant-owned intelligence.

**P2P + P2M checkout · DISHA Vault · Quantum Signal handshake · UTR/TR correlation · Merchant Workspace**

[Product website](https://disha8-2.thenitishkr.in/) · [Architecture](docs/architecture/SYSTEM-ARCHITECTURE.md) · [End-to-end flow](docs/architecture/END-TO-END-FLOW.md) · [Testing & release](docs/architecture/TEST-AND-RELEASE.md)

</div>

---

## What we are building

DISHA 8.2 is an innovative, self-hosted software layer around existing Indian UPI rails. Instead of sending a merchant through a conventional payment-aggregator checkout, DISHA creates an exact, merchant-owned P2P or P2M request and connects it to an order-bound trust and evidence journey.

**The intended business model is payer-side debit-event evidence correlated with UTR, TR, original payee, amount, DISHA Vault and Quantum Signal**—with no dependency on a merchant-side account notification in the product target architecture.

**Evidence boundary (21 November 2026):** Android credential selection and holder callback are device-verified (PR #98); consented **synthetic** notification → Keystore-signed session-evidence delivery is device-verified (PR #99); an opt-in labelled UTR/RRN notification parser passes **synthetic** tests (PR #100). **No real payer-debit UTR/RRN has been captured or bank-authenticated.** The complete biometric → notification access → consent → copy → I Paid → evidence modal → callback flow is still an implementation target. [Evidence-based status and next acceptance gates](docs/architecture/DEBIT-FIRST-CHECKOUT-EVIDENCE-STATUS-2026-11-21.md).

## Try Checkout and merchant operations

Use **[Try Checkout](https://disha8-2.thenitishkr.in/choose-payment)** to choose P2P or P2M, enter an exact INR amount and a receiving UPI ID, and continue to a real, time-limited payment request. Public P2P accepts only the configured personal receiving account; an unknown receiving handle is rejected. For P2M, Clerk sign-in is required and the prefilled request is issued only against an active bank-registered merchant receiving account and its real MCC.

Once issued, the payment amount, recipient and P2M transaction reference are bound to the original order; the Quantum Signal challenge/ACK and optional device Vault complement the Android intent and return evidence path. No simulated financial completion is created by this form.

**The merchant workspace** has a single primary creation action in its main header, a simplified quick-request navigation and concise role-neutral access messaging. Customer-facing views do not expose private Super Admin email addresses, and the backend still enforces identity and tenancy checks.

**Locally served image system:** the Mars Perseverance landing scene is the merchant login visual; the spacecraft image is the checkout backdrop; the Earth-at-night photograph is shared by the landing page and merchant operations. All are optimized derivatives of the user-supplied images, stored in each deployment mirror. The official DISHA logo is unchanged. Visual layers never control payment status.

## Six connected layers

| Layer | Merchant benefit | Repository status |
| --- | --- | --- |
| **Direct UPI checkout** | Exact merchant-controlled P2P / bank-registered P2M amount, payee and native app handoff | Implemented; real pre-PIN acceptance unresolved |
| **DISHA Vault** | Optional device authorization and order-bound handoff/return evidence | Implemented |
| **Quantum Signal** | Server payment twin, challenge, browser ACK, idempotent journey events | **PR #68 merged**, activated with `qs=1` |
| **Evidence intelligence** | UTR/TR correlation, recipient/amount checks, event conflicts and replay detection | Signed synthetic Android observation passed on Pixel; real payer debit RRN/UTR and source authenticity unverified |
| **Merchant Operations** | Onboarding, receiving VPAs, real requests, statuses, timeline, risk and exports | Implemented; staging/production sign-in validation needed |
| **Owner Control** | Tenant approval, access, incident monitoring, operational evidence, read-only finance | Implemented; end-to-end release check needed |

## The flow in one view

```mermaid
flowchart LR
  A["Merchant payment<br/>Personal P2P or merchant P2M"]
  B["DISHA session<br/>Payee, amount, TR and expiry"]
  C["Vault trust<br/>Optional device authorization"]
  D["Quantum Signal<br/>Twin → challenge → ACK"]
  E["One tap<br/>Android UPI Intent"]
  F["Google Pay / PhonePe<br/>Payer authorization"]
  G["Observed return<br/>Vault and Quantum events"]
  H["UTR/TR and payer-debit<br/>evidence correlation"]
  I["Transaction decision<br/>Receipt and merchant timeline"]
  A --> B --> C --> D --> E --> F
  F -.->|"App-provided return when available"| G
  G --> H --> I
```

**Boundary:** The existing web-only journey does **not** provide notification access. An optional Android evidence mode requires an installed, user-authorized DISHA component plus separate Android system notification permission and per-session consent; browser PIN/passkey authentication does not grant notification access. The reference APK is currently a **research fixture**, not a deployed consumer app. No mandatory payment-app API, PSP, aggregator, bank API, webhook or merchant-credit callback is part of this observation target. A browser return, ACK, RRN/UTR string or device signature alone must not be presented as a bank-confirmed debit or completed merchant payment.

## Architecture and code

- **Cloudflare Pages + Worker:** canonical checkout shell and edge API forwarding, `public/_worker.js`.
- **Node.js / Express:** `server.js`, `merchant-api.js`, `platform-control.js`.
- **Payment rules:** `utils/upi-intent.js` and `public/cosmic-checkout-model.js`.
- **DISHA Vault:** `financial/vault-evidence.js` and `public/one-touch-vault.js`.
- **Quantum Signal:** `financial/quantum-signal.js` and `public/quantum-signal-client.js`.
- **Identity:** Clerk for merchant/owner, with server-side tenant authorization.
- **Database:** PostgreSQL for durable sessions, twin/handshake/evidence, financial controls; Redis optional for shared coordination.
- **Customer UI:** responsive HTML/CSS/JS, native Android Intent and genuine `upi://pay` QR. Presentation effects do not influence payment state.
- **Tests:** Node.js, disposable PostgreSQL, Android fixture API 35/37, independent real-device acceptance.

The canonical static source is `public/`. The `dist/` and `disha-cinematic/*` copies are build/deployment mirrors, **not independent sources to delete while deployment still references them**.

See the [TDD/IDD](docs/architecture/SYSTEM-ARCHITECTURE.md), [full Mermaid sequence and failure decision flow](docs/architecture/END-TO-END-FLOW.md), and [test/release gates](docs/architecture/TEST-AND-RELEASE.md).

## Run and verify

```bash
npm ci
npm run lint
npm test
npm run build
```

Root CI validates product code; the PostgreSQL workflow requires its disposable integration database. Physical Google Pay / PhonePe acceptance cannot be replaced with an emulator green check.

## Commercial approach

DISHA is positioned as **one-time software and implementation pricing**, with no DISHA percentage of the customer's UPI transfer. Hosting, any bank costs, compliance, maintenance and optional support are independent. We do not claim free operation for every deployment or guarantee an unverified payment outcome.

## Current acceptance status

- Merged: Quantum Signal server/browser challenge and ACK; P2P/P2M route separation.
- Automated: Node.js and PostgreSQL test suites plus Android fixture coverage.
- **Device-verified (synthetic):** PR #98 Android Credential Manager selector and holder callback; PR #99 Android notification consent, Keystore-signed event (HTTP 202), session binding, replay, expiry and revocation. PR #100 added the opt-in labelled debit UTR/RRN parser with synthetic negative tests; its Pixel showed `UTR_NOT_AVAILABLE` because no eligible payer package was installed.
- **Open:** actual RRN/UTR from a real consented notification; optional bank-SMS notification feasibility and privacy tests; end-to-end biometric/permission/consent-gated checkout copy; `I Paid` evidence-only popup and authenticated evidence callback; physical UPI pre-PIN acceptance, deployment parity, scale, recovery and SaaS UAT.
- Production transactions and financial dashboards must show actual data only: no mock settlements, invented revenue or generated internal row IDs masquerading as payment references.

## Documentation

- [System architecture — TDD and IDD](docs/architecture/SYSTEM-ARCHITECTURE.md)
- [End-to-end handshake and decision Mermaid diagrams](docs/architecture/END-TO-END-FLOW.md)
- [Tests, deployment gates and safe cleanup](docs/architecture/TEST-AND-RELEASE.md)
- [Original Vault implementation details](docs/vault-browser-evidence.md)
- [Quantum Signal implementation notes](docs/quantum-signal-session-twin.md)
- [Ponytail stale-code inventory issue #69](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/issues/69)
- [Debit-first checkout: verified implementation, privacy limits and pending gates](docs/architecture/DEBIT-FIRST-CHECKOUT-EVIDENCE-STATUS-2026-11-21.md)
- [Android session observation lab](tests/android/credential-holder-fixture/session-lab/README.md)
- [Real UTR observation rules and Pixel limitation](tests/android/credential-holder-fixture/session-lab/REAL-UTR.md)

**No code, screenshot or document should claim that the intended payer-debit source is proven until actual authenticated evidence has been observed in a real controlled transfer.**
