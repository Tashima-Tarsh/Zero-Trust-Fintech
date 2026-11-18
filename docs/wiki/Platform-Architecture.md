# DISHA 8.2 — Complete Product Architecture

*The money travels through existing UPI banks. DISHA connects the commercial order, the authorized customer journey and the financial record.*

[Home](Home.md) · [Vault architecture](Vault-Architecture.md) · [End-to-end flow](End-to-End-Journey.md)

## Architecture legend

| Color | Platform responsibility | Central question |
| --- | --- | --- |
| 🟦 Blue | Customer and merchant experiences | What did the business request, and what does the customer see? |
| 🟪 Violet | DISHA Vault, authorization and recorded observations | What part of the journey can be connected to this order? |
| 🟧 Amber | Fraud, risk and matching decisions | What is inconsistent, duplicated, early or late? |
| 🟩 Green | Qualified credit, accounting and receipt | Which transaction can be financially recorded? |
| 🟥 Rose | Exceptions and disputes | What must remain unresolved for investigation? |
| ⬜ Slate | Existing UPI applications, network and banks | Where do actual funds move? |

## 1. Complete end-to-end payment architecture

~~~mermaid
flowchart TB
  subgraph ACTORS["CUSTOMER & MERCHANT EXPERIENCES"]
    M["Merchant workspace<br/>Orders · Receiving accounts · Reports"]:::experience
    C["Customer checkout<br/>Order · Recipient · QR · Timer · UPI choices"]:::experience
    O["Platform Command<br/>Approvals · Tenants · Oversight"]:::experience
  end
  subgraph TRUST["DISHA VAULT & TRUST INTELLIGENCE"]
    PASS["Device passkey authorization<br/>Bound to original order"]:::vault
    OBS["Vault evidence record<br/>Handoff · Return · Available UTR candidate"]:::vault
    RISK["Fraud intelligence<br/>Payee · Exact amount · Clock · Replay"]:::risk
    EX["Exception / discrepancy review"]:::exception
  end
  subgraph RAILS["EXISTING PAYMENT RAILS"]
    APP["Existing UPI application"]:::external
    NET["UPI network and payer / payee banks"]:::external
    ACCOUNT["Merchant receiving account<br/>Personal P2P or bank-issued P2M"]:::external
  end
  subgraph FINANCE["FINANCIAL RECORDS"]
    CREDIT["Independently qualified account-credit record"]:::money
    MATCH["Merchant-specific credit matching<br/>Order · Amount · Payee · Reference"]:::money
    JOURNAL["Balanced financial ledger"]:::money
    RECEIPT["Confirmed customer receipt"]:::money
  end
  O --> M
  M -->|"Create order"| C
  C --> PASS
  PASS -->|"Launch authorized handoff"| APP
  APP --> NET
  NET --> ACCOUNT
  PASS --> OBS
  C -. "Original order" .-> RISK
  OBS --> RISK
  ACCOUNT -. "Credit data when supplied by qualified source" .-> CREDIT
  CREDIT --> MATCH
  RISK --> MATCH
  RISK -->|"Discrepancy"| EX
  MATCH -->|"Mismatch / conflict"| EX
  MATCH -->|"Qualified match"| JOURNAL
  JOURNAL --> RECEIPT
  JOURNAL --> M
  OBS --> M
  EX --> M
  classDef experience fill:#103453,stroke:#38BDF8,stroke-width:2px,color:#FFFFFF;
  classDef vault fill:#30204F,stroke:#C084FC,stroke-width:2px,color:#FFFFFF;
  classDef risk fill:#472D18,stroke:#FBBF24,stroke-width:2px,color:#FFFFFF;
  classDef money fill:#103C31,stroke:#34D399,stroke-width:2px,color:#FFFFFF;
  classDef exception fill:#4A1F31,stroke:#FB7185,stroke-width:2px,color:#FFFFFF;
  classDef external fill:#293241,stroke:#CBD5E1,stroke-width:2px,color:#FFFFFF;
  style ACTORS fill:#07192B,stroke:#38BDF8,color:#FFFFFF
  style TRUST fill:#1B1330,stroke:#C084FC,color:#FFFFFF
  style RAILS fill:#1C2631,stroke:#94A3B8,color:#FFFFFF
  style FINANCE fill:#0D2A24,stroke:#34D399,color:#FFFFFF
~~~

**Important architectural separation:** The existing UPI network handles the transfer of money. DISHA does not need to take custody of those funds. Vault evidence informs the merchant; financially qualified matching credit informs the ledger.

## 2. Physical platform architecture

This view shows the actual principal components represented by the active DISHA product. It distinguishes browser-facing experiences, identity, business logic, recorded data and external financial sources. It is a product architecture map rather than a developer integration manual.

~~~mermaid
flowchart LR
  subgraph FRONT["PRESENTATION & ACCESS"]
    CF["Cloudflare Pages<br/>DISHA website and checkout assets"]:::experience
    UI["Customer browser<br/>Checkout · Passkey · QR"]:::experience
    MER["Merchant browser<br/>Command Centre"]:::experience
    OWN["Owner browser<br/>Platform Command"]:::experience
  end
  subgraph ID["IDENTITY"]
    CL["Clerk identity<br/>Merchant sign-in / approval binding"]:::vault
    WEB["Device passkeys<br/>Vault handoff authorization"]:::vault
  end
  subgraph CORE["DISHA APPLICATION — RAILWAY"]
    N["Active DISHA Node service<br/>Orders · Merchant records · Owner controls"]:::core
    V["Vault evidence processor<br/>Authorized event records"]:::vault
    F["Risk and correlation<br/>Time · Reference · Recipient · Amount"]:::risk
    FIN["Qualified-credit matching<br/>Exception queue · Accounting"]:::money
  end
  subgraph RECORDS["DURABLE RECORDS"]
    PG[("PostgreSQL<br/>Orders · Vault evidence · Financial journals")]:::money
    RED[("Redis (where enabled)<br/>Short-lived coordination")]:::core
  end
  subgraph OUTSIDE["BANKING SYSTEMS"]
    UPI["Customer's UPI app / bank"]:::external
    BANK["Receiving bank account"]:::external
    S["Qualified financial credit source<br/>Separate from browser return"]:::external
  end
  UI --> CF
  MER --> CF
  OWN --> CF
  CF --> N
  MER --> CL
  OWN --> CL
  UI --> WEB
  CL --> N
  WEB --> V
  N --> V
  N --> F
  N --> FIN
  V --> F
  V --> PG
  F --> PG
  FIN --> PG
  N --> PG
  N -. "Coordination" .-> RED
  UI --> UPI
  UPI --> BANK
  BANK -. "Authenticated credit evidence" .-> S
  S --> FIN
  classDef experience fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
  classDef vault fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
  classDef core fill:#202E45,stroke:#818CF8,color:#FFF,stroke-width:2px;
  classDef risk fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
  classDef money fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
  classDef external fill:#293241,stroke:#CBD5E1,color:#FFF,stroke-width:2px;
  style FRONT fill:#07192B,stroke:#38BDF8,color:#FFF
  style ID fill:#1B1330,stroke:#C084FC,color:#FFF
  style CORE fill:#161C36,stroke:#818CF8,color:#FFF
  style RECORDS fill:#0D2A24,stroke:#34D399,color:#FFF
  style OUTSIDE fill:#1C2631,stroke:#94A3B8,color:#FFF
~~~

**Core separation explained**

- **Presentation and identity:** the public website, anonymous customer checkout, approved merchant workspace and independent owner command centre.
- **Order authority:** payment request, exact amount, recipient/account type and expiry are bound to one business order.
- **Vault and risk:** authorized device return observations remain an evidence stream, not a financial posting.
- **Financial matching:** a distinctly qualified credit record can be matched to the intended order; conflicting records become exceptions.
- **Records:** merchants see only their own orders and related views; the owner has separately controlled business-wide oversight.

## 3. The two non-interchangeable information paths

~~~mermaid
flowchart LR
  subgraph EVIDENCE["PATH A — OBSERVATION"]
    A["Browser handoff"]:::vault --> B["Vault event"]:::vault --> C["Risk correlation"]:::risk --> D["Merchant evidence timeline"]:::experience
  end
  subgraph CREDIT["PATH B — FINANCIAL RECORD"]
    W["Actual receiving account"]:::external -.-> X["Qualified credit event"]:::money --> Y["Exact financial match"]:::money --> Z["Balanced ledger and receipt"]:::money
  end
  C -. "Context only: never creates credit" .-> Y
  classDef experience fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
  classDef vault fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
  classDef risk fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
  classDef money fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
  classDef external fill:#293241,stroke:#CBD5E1,color:#FFF,stroke-width:2px;
  style EVIDENCE fill:#1B1330,stroke:#C084FC,color:#FFF
  style CREDIT fill:#0D2A24,stroke:#34D399,color:#FFF
~~~

### Why the separation matters

A browser can observe that a customer returned from a payment app, but it cannot inspect that app's private bank balance or guarantee that a transfer completed. A qualifying financial credit record carries a different degree of authority. DISHA's model preserves this distinction while still making the observation useful for investigation.

## 4. Business account and tenant architecture

~~~mermaid
flowchart TB
  OWN["Platform Command<br/>Access and approval"]:::core
  OWN --> A["Merchant A<br/>Private workspace"]:::experience
  OWN --> B["Merchant B<br/>Private workspace"]:::experience
  A --> OA["Orders A"]:::experience
  A --> VA["Receiving UPI A"]:::money
  A --> LA["Ledger and evidence A"]:::vault
  B --> OB["Orders B"]:::experience
  B --> VB["Receiving UPI B"]:::money
  B --> LB["Ledger and evidence B"]:::vault
  classDef experience fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
  classDef core fill:#202E45,stroke:#818CF8,color:#FFF,stroke-width:2px;
  classDef money fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
  classDef vault fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
~~~

Each business's records and receiving accounts belong to that business's workspace. An approved owner administers admission and oversight but does not replace the customer's existing UPI payment app.

## 5. The complete business decision table

| Event | Trust meaning | What appears in the business record |
| --- | --- | --- |
| Payment link created | Order exists and is awaiting a customer action | Requested / pending |
| Authorized checkout opens UPI | Device-authorized attempt | Vault handoff event |
| Browser returns without reference | Browser return observed | Unresolved observation |
| Customer presents UTR or screenshot | Customer-origin claim | Unverified candidate |
| Reference has already appeared on another order | Reference conflict | Risk indicator / investigation |
| Qualified financial credit matches all order fields | Completed money record | Balanced ledger entry and confirmed receipt |
| Financial credit conflicts with original recipient, amount or identity | Material inconsistency | Quarantined exception |

[Inside the Vault](Vault-Architecture.md) · [Fraud architecture](Fraud-and-Risk-Protection.md) · [Home](Home.md)
