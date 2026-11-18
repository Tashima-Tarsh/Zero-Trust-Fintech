# DISHA Receiving Accounts — P2P, P2M and intelligent selection

A business's receiving account is central to its payment experience. DISHA distinguishes personal UPI accounts from genuine merchant-classified accounts and keeps each customer's original recipient attached to the order.

## P2P and P2M are not interchangeable

| | Personal receiving UPI — **P2P** | Bank-issued merchant receiving UPI — **P2M** |
| --- | --- | --- |
| Recipient | Eligible personal UPI address | Bank/acquirer-issued merchant UPI address |
| Classification | Personal account | Merchant status established by issuing institution |
| Customer experience | Familiar UPI app or QR | Familiar UPI app or QR |
| DISHA order | Preserves the specific personal payee and amount | Preserves merchant payee, bank-issued category and amount |
| Bank role | Determines payment acceptance | Determines merchant eligibility and payment acceptance |
| Product distinction | Does not attach merchant-only identity fields | Uses merchant-specific payment details, not a synthetic conversion |

A four-digit merchant category code is part of a legitimate merchant-account configuration. Merely typing one into a software form does **not** turn a personal account into an approved merchant account.

## Receiving-account architecture

~~~mermaid
flowchart TB
 A["Merchant's own eligible receiving UPI accounts"]:::blue --> B{"Account type"}:::amber
 B -->|"Personal"| P["P2P account record"]:::blue
 B -->|"Bank-issued merchant"| M["P2M account record<br/>Merchant classification"]:::green
 P --> H["Eligible account selection<br/>Health · Load · Availability"]:::purple
 M --> H
 H --> O["Order with fixed payee and amount"]:::blue
 O --> C["Customer checkout<br/>QR and app choice"]:::blue
 C --> U["Existing UPI network and banks"]:::gray
 classDef blue fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
 classDef purple fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
 classDef amber fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
 classDef green fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
 classDef gray fill:#293241,stroke:#CBD5E1,color:#FFF,stroke-width:2px;
~~~

## Multiple account management

A merchant can register several eligible receiving UPI addresses, designate a primary account, pause or resume secondary accounts and import a controlled set of additional records. The product also maintains per-account activity and health indicators.

### Five-factor account selection

When DISHA chooses among eligible receiving accounts, its selection logic considers:

| Factor | Business meaning |
| --- | --- |
| **Health** | Prefer accounts that meet available health criteria |
| **Cooldown** | Consider how recently an account was selected |
| **Daily load** | Respect configured daily activity and volume limits |
| **Preferred time slot** | Consider the receiving account's configured activity period |
| **Diversity factor** | Add a balancing input rather than always favoring one account |

The router also considers recent selection history. These are **software routing and availability controls**, not authorization to circumvent bank rules, per-account limits or risk screening.

## Preserve the recipient chosen at order creation

One important DISHA design principle is **immutable payee intent**. When a merchant creates a payment request, its receiving address, payee name and account classification are saved with that order. Later changes to the merchant's primary UPI address must not rewrite the original customer's link.

## The three most important account decisions

**Can this account receive the intended payment?** The bank and UPI application determine that, not the appearance of a QR.

**Is this the correct type of account?** DISHA treats personal and merchant recipients differently and preserves that distinction.

**Is this the intended recipient for this order?** Every payment request retains its own specific payee, preventing unintended substitution.

[Customer journey](End-to-End-Journey.md) · [Platform architecture](Platform-Architecture.md) · [Home](Home.md)
