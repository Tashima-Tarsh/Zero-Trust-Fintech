<div align="center">

<img src="public/assets/disha-8-2-wordmark-cropped.png" alt="DISHA 8.2 official wordmark" width="420">

### The money moves on UPI. The intelligence belongs to you.

**Direct UPI Checkout · DISHA Vault · Fraud Intelligence · Merchant Command Centre · Financial Records**

A complete merchant-controlled experience around every payment — from the first order to its final financial record.

[**Discover DISHA**](https://disha8-2.thenitishkr.in/) &nbsp;·&nbsp; [**Explore the Product**](docs/wiki/Home.md) &nbsp;·&nbsp; [**See the Architecture**](docs/wiki/Platform-Architecture.md) &nbsp;·&nbsp; [**Request Access**](https://disha8-2.thenitishkr.in/request-access)

<img src="public/assets/disha-universe-background.svg" alt="DISHA 8.2 brand universe" width="100%">

</div>

---

# The payment is only the beginning.

A customer taps **Pay**. A UPI app opens. A reference appears. But a business needs to know much more than whether a screen showed a green tick.

**Was the intended account selected? Was the amount correct? Does the reference belong to this order? Did the banking record actually match? And can the business explain the entire journey later?**

DISHA 8.2 brings these questions into one merchant-owned operating environment.

It does not replace UPI, the customer's bank, or the customer's payment app. It is the intelligence and operations layer that gives each payment an identity, a history and a trustworthy business outcome.

## One platform. Six connected capabilities.

| | Capability | What it means for the business |
| :---: | --- | --- |
| 🟦 | **Direct UPI Checkout** | Order-specific links, dynamic QR, familiar UPI app choices and a clear three-minute payment window |
| 🟪 | **DISHA Vault** | Device-authorized handoff, order-linked return observations and an accountable evidence trail |
| 🟧 | **Fraud Intelligence** | Detect mismatched recipients, amounts, timing and repeated or conflicting reference claims |
| 🟩 | **Financial Reconciliation** | Match qualified credit records to the right order and maintain balanced financial entries |
| 🟦 | **Merchant Command Centre** | Track orders, configure receiving UPI accounts, inspect evidence, export reports and manage operations |
| 🟪 | **Platform Command** | Review merchant access, oversee separate business workspaces, monitor incidents and maintain governance |

# The DISHA architecture

The platform separates **the customer's payment**, **the evidence about that payment**, and **the merchant's financial record**. Every layer answers a different business question.

### Architecture key

🟦 Customer & merchant experiences &nbsp;·&nbsp; 🟪 DISHA Vault & evidence &nbsp;·&nbsp; 🟧 Risk decisions &nbsp;·&nbsp; 🟩 Financial records &nbsp;·&nbsp; ⬜ Existing UPI and bank systems

~~~mermaid
flowchart TB
    MER["MERCHANT COMMAND CENTRE<br/>Business · Receiving UPI · Payment order"]:::experience
    PAY["CUSTOMER CHECKOUT<br/>Amount · Payee · QR · UPI app · 03:00"]:::experience
    V["DISHA VAULT<br/>Device passkey · Order-bound authorization<br/>Handoff and return evidence"]:::vault
    U["EXISTING UPI APPS<br/>PhonePe · Google Pay · Paytm · Bank apps"]:::external
    BANK["UPI NETWORK & BANKS<br/>Customer bank → Receiving bank"]:::external
    REC["MERCHANT RECEIVING ACCOUNT<br/>Direct P2P or bank-issued P2M"]:::money
    RISK["DISHA FRAUD INTELLIGENCE<br/>Recipient · Amount · Time · UTR conflicts"]:::risk
    SOURCE["QUALIFIED CREDIT RECORD<br/>From an independently authenticated financial source"]:::money
    RECON["FINANCIAL MATCHING<br/>Merchant · Order · Exact amount · Reference"]:::money
    HOLD["EXCEPTION REVIEW<br/>Missing · Duplicate · Mismatched"]:::exception
    LEDGER["BALANCED LEDGER<br/>Recorded completed credit"]:::money
    RECEIPT["CUSTOMER RECEIPT<br/>Only after completed financial record"]:::experience
    DASH["MERCHANT REPORTS<br/>Orders · Evidence · Finance · Exports"]:::experience
    MER -->|"Create specific order"| PAY
    PAY -->|"Authorize handoff"| V
    V -->|"Open selected app"| U
    U --> BANK
    BANK -->|"Move funds"| REC
    V -->|"Observed return information"| RISK
    PAY -.->|"Original order details"| RISK
    REC -.->|"Account credit evidence, when available"| SOURCE
    SOURCE --> RECON
    RISK -->|"Correlation and warning flags"| RECON
    RECON -->|"Conflicts"| HOLD
    RECON -->|"Qualified match"| LEDGER
    LEDGER --> RECEIPT
    LEDGER --> DASH
    HOLD --> DASH
    RISK --> DASH
    classDef experience fill:#102F4D,stroke:#38BDF8,stroke-width:2px,color:#F8FAFC;
    classDef vault fill:#30204F,stroke:#C084FC,stroke-width:2px,color:#FFFFFF;
    classDef risk fill:#4A2B13,stroke:#F59E0B,stroke-width:2px,color:#FFF7ED;
    classDef money fill:#10392F,stroke:#34D399,stroke-width:2px,color:#F0FDF4;
    classDef exception fill:#4A1F31,stroke:#FB7185,stroke-width:2px,color:#FFF1F2;
    classDef external fill:#283240,stroke:#CBD5E1,stroke-width:2px,color:#FFFFFF;
~~~

**The operating principle:** a payment attempt is an event; a browser return is an observation; a qualified matching credit is a financial record. DISHA does not confuse one with the other.

[**Explore the complete architecture →**](docs/wiki/Platform-Architecture.md)

# The customer journey, end to end

~~~mermaid
flowchart LR
  A["01<br/>Merchant creates an order"]:::blue --> B["02<br/>Customer opens DISHA checkout"]:::blue
  B --> C["03<br/>Vault authorizes device"]:::purple
  C --> D["04<br/>Existing UPI app opens"]:::gray
  D --> E["05<br/>Payment attempted"]:::gray
  E --> F["06<br/>Return evidence evaluated"]:::orange
  F --> G["07<br/>Qualified credit matched"]:::green
  G --> H["08<br/>Receipt and merchant ledger"]:::green
  classDef blue fill:#103453,stroke:#38BDF8,color:#fff,stroke-width:2px;
  classDef purple fill:#31204A,stroke:#C084FC,color:#fff,stroke-width:2px;
  classDef orange fill:#472D18,stroke:#FBBF24,color:#fff,stroke-width:2px;
  classDef green fill:#103C31,stroke:#34D399,color:#fff,stroke-width:2px;
  classDef gray fill:#293241,stroke:#CBD5E1,color:#fff,stroke-width:2px;
~~~

**Create → Present → Authorize → Pay → Observe → Evaluate → Reconcile → Record.**

The checkout is designed for a customer using an ordinary UPI app; the intelligence, history and financial accountability belong in the merchant's workspace.

[**Walk through the eight stages →**](docs/wiki/End-to-End-Journey.md)

# DISHA Vault

## A memory of the payment journey. Not another wallet.

<img src="public/assets/disha-vault-sculpture.svg" alt="The existing DISHA Vault visual identity" width="300" align="right">

**DISHA Vault** records the first-party checkout's authorized journey: the device permission, the original order, the moment the UPI app was opened, and any allowed return information visible to the browser.

When the customer returns, DISHA can associate the observation with the same original order. If an external UPI app exposes no transaction reference, the Vault records the observation **without inventing one**.

The Vault makes a payment easier to investigate, but does not hold money or inspect another app's private bank data.

### Vault's five interconnected responsibilities

- **Device identity:** one supported passkey registration or authentication for the checkout handoff.
- **Order identity:** an authorization bound to the particular payment request, amount and receiving account.
- **Journey observation:** browser departure, return and available permitted reference fields.
- **Evidence integrity:** event uniqueness, repeat-submission protection and order-bound records.
- **Trust handoff:** evidence goes to DISHA's fraud intelligence; an independently qualified credit, not a return animation, determines the financial outcome.

~~~mermaid
flowchart LR
  D["Customer device<br/>Passkey"]:::purple --> A["DISHA Vault<br/>Order authorization"]:::purple
  A --> U["UPI app handoff"]:::gray
  U --> R["Browser return"]:::blue
  R --> E["Immutable event record<br/>Order · Time · Available fields"]:::purple
  E --> T["Fraud intelligence<br/>Match and flag conflicts"]:::orange
  T --> M["Merchant evidence timeline"]:::blue
  classDef purple fill:#30204F,stroke:#C084FC,color:#FFFFFF,stroke-width:2px;
  classDef blue fill:#103453,stroke:#38BDF8,color:#FFFFFF,stroke-width:2px;
  classDef orange fill:#472D18,stroke:#FBBF24,color:#FFFFFF,stroke-width:2px;
  classDef gray fill:#293241,stroke:#CBD5E1,color:#FFFFFF,stroke-width:2px;
~~~

[**Inside DISHA Vault: complete component architecture →**](docs/wiki/Vault-Architecture.md)

# Fraud intelligence: question every claim

Fraud-resistant payments do not start with blind trust in a receipt. They start by testing the relationship between the **specific order** and the **available evidence**.

| Signal | What DISHA examines | Business value |
| --- | --- | --- |
| **Recipient integrity** | Does the claimed payee match the saved receiving UPI address? | Limits misdirected or misattributed orders |
| **Exact amount** | Does the amount match, down to the paise? | Exposes short payments and wrong-order claims |
| **Reference conflict** | Has the reference been claimed or assigned elsewhere? | Helps detect copied or replayed references |
| **Time context** | Was the observed event inside the order's defined window? | Separates ordinary and late evidence |
| **Device journey** | Did an authorized checkout observe an app handoff or return? | Adds context beyond a screenshot |
| **Financial source** | Does a qualified credit belong to the same merchant and order? | Protects recorded financial completion |
| **Exception handling** | Should a conflict remain unconfirmed for review? | Keeps ambiguous activity out of completed records |

**No single green tick, screenshot, UTR shape or device return is treated as proof that funds arrived.**

[**Explore the fraud decision architecture →**](docs/wiki/Fraud-and-Risk-Protection.md)

# One command centre for the merchant

The DISHA merchant workspace connects payment operations with their business meaning.

| **Run payments** | **Operate accounts** | **Understand the business** |
| --- | --- | --- |
| Create order-specific payment links | Add personal or bank-issued merchant UPI accounts | Track order and payment states |
| Present mobile UPI checkout and QR | Select a primary receiving account | Explore Vault evidence |
| Follow the three-minute order window | Pause eligible receiving accounts | Review flagged discrepancies |
| Review completed financial records | Manage several receiving accounts | View reports, CSV exports and notifications |
| Access confirmed customer receipts | Maintain business settings | Follow reconciled ledger history |

An independent **Platform Command** manages merchant access requests, approvals, separate business workspaces, incident review and platform-wide oversight.

[**Explore the merchant and owner workspaces →**](docs/wiki/Merchant-and-Owner-Workspaces.md)

# Direct UPI. Two distinct payment types.

| **Personal payment · P2P** | **Merchant payment · P2M** |
| --- | --- |
| Uses an eligible personal receiving UPI account | Uses an account classified as merchant UPI by its bank/acquirer |
| Preserves personal-payee payment details | Preserves the genuine bank-issued merchant category details |
| Customer completes payment in their existing UPI app | Customer completes payment in their existing UPI app |
| Keeps the selected recipient attached to the original order | Keeps merchant classification and recipient attached to the original order |

DISHA does not turn a personal UPI address into a bank-issued merchant address or silently change a previously shared order's payee.

[**Understand P2P, P2M and receiving-account management →**](docs/wiki/P2P-P2M-and-Receiving-Accounts.md)

# The economics of ownership

DISHA is designed around a **one-time software and implementation commercial model** rather than a DISHA platform percentage deducted from each payment. The business keeps control of its configured receiving accounts and payment operating environment.

Potential savings depend on what the business currently pays and which existing charges are actually avoidable. Charges from banks, infrastructure, external services and ongoing support are separate from the DISHA software agreement.

| Illustrative monthly eligible volume | If an existing 0.5% platform charge is avoidable | Gross potential monthly reduction |
| ---: | ---: | ---: |
| ₹10 lakh | 0.5% | ₹5,000 |
| ₹1 crore | 0.5% | ₹50,000 |
| ₹10 crore | 0.5% | ₹5,00,000 |

These are scenarios, not claims that every UPI payment incurs these fees. The meaningful comparison is against the merchant's real contract and operating costs.

[**Explore the commercial model →**](docs/wiki/Commercial-Model-and-Savings.md)

# Product knowledge centre

| Discover | Experience | Operate |
| --- | --- | --- |
| [Product vision](docs/wiki/Product-Vision-and-Value.md) | [End-to-end customer journey](docs/wiki/End-to-End-Journey.md) | [Merchant and owner workspaces](docs/wiki/Merchant-and-Owner-Workspaces.md) |
| [Full platform architecture](docs/wiki/Platform-Architecture.md) | [DISHA Vault architecture](docs/wiki/Vault-Architecture.md) | [Financial records and receipts](docs/wiki/Records-Reconciliation-and-Receipts.md) |
| [P2P and P2M](docs/wiki/P2P-P2M-and-Receiving-Accounts.md) | [Fraud and risk intelligence](docs/wiki/Fraud-and-Risk-Protection.md) | [Commercial model](docs/wiki/Commercial-Model-and-Savings.md) |
| [Frequently asked questions](docs/wiki/FAQ.md) | [DISHA Vault overview](docs/wiki/DISHA-Vault.md) | [Request access](https://disha8-2.thenitishkr.in/request-access) |

## Take the next step

**Your receiving account. Your checkout. Your business intelligence.**

[**Explore the DISHA 8.2 website**](https://disha8-2.thenitishkr.in/) · [**Request merchant access**](https://disha8-2.thenitishkr.in/request-access) · [**Commercial enquiry**](mailto:nitish@thenitishkr.in)

<sub>DISHA 8.2 is merchant software built around existing UPI and banking services. Publicly viewable source is governed by the repository's [Business Source License 1.1](LICENSE); commercial use requires an appropriate agreement.</sub>

<div align="center">

<img src="public/assets/disha-8-2-wordmark-cropped.png" alt="DISHA 8.2" width="270">

**Own the experience. Understand the evidence. Keep the record.**

</div>
