# DISHA Vault — Complete Architecture

<img src="../../public/assets/disha-vault-sculpture.svg" alt="DISHA Vault artwork" width="260">

**A device-authorized memory of the payment journey, connected to an individual order.**

DISHA Vault is not a stored-money wallet. It protects the identity of the checkout handoff and preserves the first-party browser's available evidence so that a merchant can distinguish an observed event from an actually accounted payment.

## Vault architecture in one view

🟦 Customer/browser &nbsp;·&nbsp; 🟪 Device and Vault &nbsp;·&nbsp; 🟧 Risk classification &nbsp;·&nbsp; 🟩 Financial outcome &nbsp;·&nbsp; ⬜ External UPI app

~~~mermaid
flowchart TB
  subgraph CUSTOMER["CUSTOMER DEVICE & CHECKOUT"]
    ORDER["Order-specific DISHA checkout<br/>Payee · Amount · Expiry"]:::browser
    PASS["Device passkey<br/>Biometric or device authentication"]:::vault
    HANDOFF["Authorized UPI app handoff"]:::vault
    APP["External UPI app<br/>Payment attempt"]:::external
    RETURN["First-party browser<br/>Background / return observations"]:::browser
  end
  subgraph VAULT["DISHA VAULT TRUST BOUNDARY"]
    AUTHORIZE["Order-bound authorization<br/>Same order + customer session"]:::vault
    EVENT["Frozen event packet<br/>Event ID · Times · Allowed return fields"]:::vault
    STORAGE["Durable Vault evidence record<br/>Order-linked history"]:::vault
    CLASS["Evidence classification<br/>Return / Candidate / Conflict / Late"]:::risk
  end
  subgraph BUSINESS["MERCHANT INTELLIGENCE"]
    RISK["Risk correlation<br/>Amount · Payee · Window · Replay"]:::risk
    VIEW["Merchant Vault timeline"]:::browser
    CREDIT["Separate qualified credit matching"]:::money
    LEDGER["Completed accounting record<br/>Only if financial match exists"]:::money
  end
  ORDER --> PASS
  PASS --> AUTHORIZE
  AUTHORIZE --> HANDOFF
  HANDOFF --> APP
  APP -. "App returns to browser, if supported" .-> RETURN
  RETURN --> EVENT
  AUTHORIZE --> EVENT
  EVENT --> STORAGE
  STORAGE --> CLASS
  CLASS --> RISK
  RISK --> VIEW
  RISK -. "Context, not proof of credit" .-> CREDIT
  CREDIT --> LEDGER
  classDef browser fill:#103453,stroke:#38BDF8,stroke-width:2px,color:#FFFFFF;
  classDef vault fill:#30204F,stroke:#C084FC,stroke-width:2px,color:#FFFFFF;
  classDef risk fill:#472D18,stroke:#FBBF24,stroke-width:2px,color:#FFFFFF;
  classDef money fill:#103C31,stroke:#34D399,stroke-width:2px,color:#FFFFFF;
  classDef external fill:#293241,stroke:#CBD5E1,stroke-width:2px,color:#FFFFFF;
  style CUSTOMER fill:#07192B,stroke:#38BDF8,color:#FFF
  style VAULT fill:#1B1330,stroke:#C084FC,color:#FFF
  style BUSINESS fill:#102623,stroke:#34D399,color:#FFF
~~~

## The five Vault components

| Component | Business purpose | What it holds or produces |
| --- | --- | --- |
| **Device authorization** | Confirm that a supported device authorized the handoff for the current order | Passkey authorization associated with the checkout |
| **Order lock** | Connect the device event to exactly one original request | Order identity, expiry and order-specific authorization |
| **Journey observer** | Capture events visible to the customer's own browser | Background, return and allowlisted return parameters |
| **Evidence record** | Save the original observed event without duplicate financial effects | Immutable-style event packet, unique event ID, order history |
| **Trust classifier** | Tell merchants what the evidence actually says | Observed return, unverified reference, conflicting evidence or late return |

## Device-to-Vault sequence

~~~mermaid
sequenceDiagram
  autonumber
  participant C as Customer
  participant B as DISHA Checkout
  participant D as Device Passkey
  participant V as DISHA Vault
  participant U as External UPI App
  participant R as DISHA Risk Record
  C->>B: Open order-specific checkout
  B->>V: Load original order context
  C->>D: Authorize the payment handoff
  D-->>V: Authorized device assertion
  V-->>B: Order-bound Vault authorization
  B->>U: Open selected UPI application
  C->>U: Attempt payment using existing bank
  U-->>B: Return to browser when supported
  B->>V: Request original order event packet
  V-->>B: Event ID, timing and permitted observations
  B->>R: Submit event under same checkout order
  R-->>B: Evidence stored and classified
  B->>V: Acknowledge recorded event
  Note over C,R: This sequence records evidence, not bank-credit confirmation.
~~~

## The evidence decision architecture

~~~mermaid
flowchart TD
  E["Original Vault event"]:::vault --> O{"Bound to this order and authorized session?"}:::risk
  O -->|"No"| REJ["Reject unrelated event"]:::exception
  O -->|"Yes"| W{"Within expected time context?"}:::risk
  W -->|"Late"| L["Late return observation"]:::risk
  W -->|"Within window"| P{"Any permitted return reference?"}:::risk
  P -->|"No"| N["Return observed — no UTR"]:::vault
  P -->|"Yes"| T["Unverified UTR candidate"]:::vault
  T --> A{"Payee, amount or repeated-reference conflict?"}:::risk
  A -->|"Yes"| F["Conflicting evidence"]:::exception
  A -->|"No"| K["Correlated unverified observation"]:::vault
  L --> Z["Merchant evidence timeline"]:::browser
  N --> Z
  F --> Z
  K --> Z
  classDef browser fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
  classDef vault fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
  classDef risk fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
  classDef exception fill:#4A1F31,stroke:#FB7185,color:#FFF,stroke-width:2px;
~~~

## What happens in difficult cases

| Customer experience | Vault interpretation | Merchant implication |
| --- | --- | --- |
| UPI app opens but user cancels | Possible observed handoff/return | No automatic paid status |
| UPI app refuses the request before PIN | No authenticated banking credit inferred | Checkout needs an appropriate error or unresolved status |
| Customer returns but UTR is absent | Return observed without reference | Investigation may need another qualified source |
| A twelve-digit reference is exposed | Unverified candidate reference | Compare against order and other claims |
| Reference appears on multiple orders | Conflict captured for review | Neither order should gain financial credit merely from the claim |
| Browser never returns | No invented return event | Order remains governed by its actual evidence and expiry |
| A qualifying account credit later arrives | Separate financial matching takes over | Matching transaction may be posted and receipted |

## Vault privacy and security boundaries

- The customer authorizes through a platform-supported device credential rather than entering a new DISHA password in the checkout.
- Order authorization is bound to its original session, and recorded events have identifiers that prevent duplicate submissions from becoming duplicate financial effects.
- Browser observations are limited to what the first-party checkout can actually see. A third-party UPI app's private screens, PIN and bank balance are not read by the Vault.
- An observed reference is never upgraded to an actual financial credit solely because it looks valid.
- Financial confirmation is a **separate accounting decision**, not a Vault claim.

## Why this product element is distinctive

In a typical payment dispute, the merchant sees the customer's final screenshot but little about the journey that created it. DISHA Vault provides a coherent history: **the right order, the authorized handoff, the available return event and the recorded evidence classification**. That history improves the quality of investigation without inventing financial certainty.

[Platform architecture](Platform-Architecture.md) · [Fraud intelligence](Fraud-and-Risk-Protection.md) · [Home](Home.md)
