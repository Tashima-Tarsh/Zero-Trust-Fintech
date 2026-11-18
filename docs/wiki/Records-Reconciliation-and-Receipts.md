# Financial Intelligence — Order, evidence, reconciliation and receipt

A merchant needs more than payment links. It needs a clear relationship between the customer order, any observations of the payment attempt and the money that can actually be recorded as received.

DISHA maintains these as separate, connected layers.

## Three types of record

| Record family | What it contains | What it tells the merchant |
| --- | --- | --- |
| 🟦 **Order** | Original merchant, recipient, amount, reference and time window | What the business asked the customer to pay |
| 🟪 **Vault evidence** | Authorized handoff, browser return, available reference and discrepancies | What DISHA observed or was told |
| 🟩 **Financial record** | Independently qualified matching credit and balanced accounting entry | What can be recorded as a completed transaction |

**A screenshot belongs to the evidence story, not automatically to the financial story.**

## Financial reconciliation architecture

~~~mermaid
flowchart TB
 A["Original DISHA order<br/>Merchant · Payee · Exact amount"]:::blue
 B["Qualified receiving-account credit record"]:::green
 C["Vault observations<br/>Unverified customer-origin claims"]:::purple
 A --> D["Financial matching<br/>Tenant · Recipient · Amount · Window · Reference"]:::amber
 B --> D
 C -. "Investigation context only" .-> D
 D --> E{"All qualifying fields agree?"}:::amber
 E -->|"Yes"| F["Balanced merchant financial journal"]:::green
 F --> G["Completed transaction"]:::green
 G --> H["Printable and shareable receipt"]:::green
 E -->|"No"| Q["Quarantined financial exception"]:::rose
 Q --> R["Merchant investigation"]:::blue
 classDef blue fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
 classDef purple fill:#30204F,stroke:#C084FC,color:#FFF,stroke-width:2px;
 classDef amber fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
 classDef green fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
 classDef rose fill:#4A1F31,stroke:#FB7185,color:#FFF,stroke-width:2px;
~~~

## What does a balanced ledger accomplish?

A completed financial event is represented as corresponding debit and credit entries attached to the same merchant transaction. The entries balance, and the record can be associated with the specific original order. This reduces inconsistent bookkeeping and makes reporting clearer.

The ledger is the merchant's **accounting record**, not a substitute for the receiving bank's actual statement.

## Customer receipt journey

~~~mermaid
flowchart LR
 A["Qualified credit"]:::green --> B["Exact order match"]:::amber --> C["Financial journal posted"]:::green --> D["Confirmed status"]:::green --> E["Receipt<br/>Print · Share"]:::blue
 classDef blue fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
 classDef amber fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
 classDef green fill:#103C31,stroke:#34D399,color:#FFF,stroke-width:2px;
~~~

A customer receives a completed receipt when an appropriate financial record supports it. A device returning from a UPI application is an observation, not the same event.

## How exceptions are handled

| Situation | DISHA business interpretation |
| --- | --- |
| Customer has opened the app but no qualified credit is available | Keep the order unresolved |
| App returned with a reference candidate | Record and examine the unverified claim |
| Customer returns after the checkout timer expires | Preserve timing context; do not infer that money did or did not move |
| Qualified credit belongs to another receiving account | Hold the discrepancy for review |
| Qualified credit shows a different amount | Investigate the mismatch |
| Same qualified credit is received again | Avoid duplicate posting |
| Qualified credit matches the original merchant order | Post and present the completed financial record |

## What the merchant gets

A consistent transaction timeline, meaningful statuses, qualified ledger entries, evidence views, exception context, reporting and CSV exports. Rather than relying on visual appearances, the business can tell the story of each order from start to finish.

[Fraud intelligence](Fraud-and-Risk-Protection.md) · [Merchant workspaces](Merchant-and-Owner-Workspaces.md) · [Home](Home.md)
