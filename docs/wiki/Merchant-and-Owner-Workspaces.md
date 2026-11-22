# DISHA Command Centres — Business operations with clear ownership

DISHA provides two deliberately different operational experiences: the **Merchant Command Centre** for the business receiving payments and the **Platform Command** for approved access and portfolio oversight.

## The merchant command centre

| Navigation area | Merchant question | What the workspace provides |
| --- | --- | --- |
| **Overview** | What is happening in my business? | Recorded activity, completed and pending counts, trends and operational signals |
| **Create payment** | How do I ask a customer to pay this order? | Amount-specific checkout link, intended UPI recipient and reference |
| **Transactions** | What happened to every request? | Searchable records, dates, amounts and recorded states |
| **UPI accounts** | Which accounts can receive payment? | Registered personal and merchant receiving addresses, primary selection and controls |
| **Routing and accounts** | Which eligible receiving account is selected? | Health, availability, load and cooldown-related selection data |
| **Vault & evidence** | What did the authorized browser return actually show? | Order-linked observations and available candidate reference data |
| **Security review** | What needs attention? | Open, expired, completed and discrepancy-related operational context |
| **Reconciliation and ledger** | What is financially accounted for? | Qualified financial journal records and summaries |
| **Reports and exports** | How do I report the activity? | Period filters, recorded totals and CSV export |
| **Notifications** | What operational events occurred? | Merchant-specific event notices |
| **Voice alerts** | Can a confirmed event be announced? | Browser voice-alert experience for recorded completed events |
| **Settings** | How do I maintain my business profile? | Business identity, account holder details and relevant preferences |

## The merchant journey

~~~mermaid
flowchart LR
 A["Approved merchant"]:::blue --> B["Business profile<br/>and UPI accounts"]:::blue --> C["Create customer order"]:::blue
 C --> D["Share checkout<br/>or QR"]:::blue
 D --> E["Vault evidence and risk"]:::purple
 E --> F["Finance and records"]:::green
 F --> G["Dashboard · Export · Report"]:::green
 classDef blue fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
 classDef purple fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
 classDef green fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
~~~

Each approved merchant's records and receiving account configuration are attached to their own workspace. The product is designed around actual recorded order and financial data, rather than sample transactions.

## Platform Command — Owner oversight

The owner works at a different level. The platform's operations view includes merchant access applications, invitations, approved identities, tenant status, recorded transaction oversight, available evidence, financial records, incidents, audit activity and reporting.

~~~mermaid
flowchart TD
 O["PLATFORM COMMAND<br/>Governance and owner oversight"]:::owner
 O --> R["Merchant access review"]:::blue
 R --> D{"Business approved?"}:::risk
 D -->|"Yes"| T["Approved identity<br/>and isolated workspace"]:::green
 D -->|"No"| X["No active workspace"]:::rose
 T --> A["Merchant A<br/>Private orders · Receiving accounts · Reports"]:::blue
 T --> B["Merchant B<br/>Private orders · Receiving accounts · Reports"]:::blue
 O --> I["Incidents · Trust · Financial oversight"]:::owner
 classDef owner fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
 classDef blue fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
 classDef risk fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
 classDef green fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
 classDef rose fill:#4A1F31,stroke:#FB7185,color:#FFF,stroke-width:2px;
~~~

## Why this separation matters

An ordinary merchant should not be able to inspect another business's receiving details, financial activity or evidence. The owner must be able to supervise access and incidents without reassigning one merchant's payments to another merchant.

### A practical day in the business

A seller creates a ₹750 request. The customer sees the intended amount and receiving UPI account. The seller follows the request in Transactions; if the checkout returns unusual evidence, Vault and risk context are available. If a qualified matching credit is accounted for, the ledger and completed records reflect it. Reporting and export help the business close its books.

[Receiving-account architecture](P2P-P2M-and-Receiving-Accounts.md) · [Records and receipts](Records-Reconciliation-and-Receipts.md) · [Home](Home.md)

## Human-facing identifiers

Merchant and owner views show human-readable payment labels, actual UTR/TR when available, amounts, states and evidence—not generated order, tenant or journal IDs. The backend continues to use immutable internal identifiers for authorization, secure row actions and audit correlation.
