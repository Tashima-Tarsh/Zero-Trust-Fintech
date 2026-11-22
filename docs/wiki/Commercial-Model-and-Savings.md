# The economics of owning the payment software

**A one-time DISHA software and implementation relationship — not a DISHA percentage deducted from each payment.**

The product's commercial philosophy is straightforward: a business should be able to own its checkout experience and payment intelligence as software, while continuing to use eligible UPI receiving accounts and the existing banking network.

## What the business acquires

The proposed commercial scope can bring together the branded customer checkout, DISHA Vault evidence, receiving-account management, fraud-oriented exception analysis, merchant reporting, financial record views, and a controlled platform operating environment.

The precise license, implementation work, ongoing support and operational responsibilities belong in a written agreement; they are not implied by a marketing table.

## Where economic value can arise

~~~mermaid
flowchart LR
 A["Merchant's current payment operations"]:::blue --> B["Avoidable external platform costs"]:::amber
 A --> C["Manual reconciliation workload"]:::amber
 A --> D["Fragmented order information"]:::amber
 B --> E["DISHA software ownership model"]:::purple
 C --> E
 D --> E
 E --> F["Potential business value<br/>Less avoidable cost · Clearer records"]:::green
 classDef blue fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
 classDef amber fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
 classDef purple fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
 classDef green fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
~~~

### Illustrative savings — based on an avoidable fee

| Eligible monthly payment volume | Hypothetically avoidable charge | Potential gross monthly reduction |
| ---: | ---: | ---: |
| ₹10 lakh | 0.5% | ₹5,000 |
| ₹50 lakh | 0.5% | ₹25,000 |
| ₹1 crore | 1.0% | ₹1,00,000 |
| ₹10 crore | 1.0% | ₹10,00,000 |

These are **arithmetic scenarios**, not claims about actual merchant bills or universal UPI MDR. Some eligible UPI transactions already carry no such fee, and a zero-fee existing arrangement offers no additional MDR saving.

## What to include in a real business comparison

**Potential recurring value** = demonstrably avoidable platform charges + demonstrably reduced operating costs.

**Total ownership cost** = one-time software and implementation price + eligible bank/provider costs + hosting + maintenance + support + internal operations.

**Net commercial result** = recurring value − total applicable costs over the comparison period.

A business should compare DISHA with its own invoices, transaction mix and operating process. Savings are meaningful only where an existing expense can truly be removed or reduced.

## Why non-custodial software matters

DISHA is not proposing to hold customers' funds as a separate wallet. The existing UPI network and participating banks manage the money transfer to an eligible receiving account. DISHA offers software for the request, trust context and accounting record around that transfer.

## Licensing and commercial access

DISHA 8.2 is **source-available under Business Source License 1.1**, with commercial use requiring appropriate terms. The public repository is not an unrestricted commercial-use grant. The applicable software and support agreement should spell out what the merchant receives and which costs remain external.

**[Discuss your business requirements](mailto:nitish@thenitishkr.in)** · [Explore the product](Product-Vision-and-Value.md) · [Home](Home.md)
