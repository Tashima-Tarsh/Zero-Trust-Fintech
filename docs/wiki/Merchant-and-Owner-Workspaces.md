# Merchant and owner workspaces — two different views of the same business reality

DISHA 8.2 separates the day-to-day work of a merchant from the responsibilities of the platform operator. Merchant records are scoped to the signed-in approved business. The owner has a distinct command centre for approvals, oversight and release controls.

## Merchant workspace

| Workspace area | Business purpose |
| --- | --- |
| **Overview** | Understand recorded activity, order volumes and account position without demo turnover |
| **Create payment** | Enter an amount and reference and generate a shareable customer checkout |
| **Transactions** | Inspect recorded requests, recent outcomes, filters and order history |
| **Receiving UPI accounts** | Register personal or merchant bank-issued handles, set the primary account, pause or resume eligible accounts |
| **Bulk account import** | Import several receiving-UPI records in a controlled operation |
| **Vault & evidence** | Review device-return evidence and unverified reference candidates linked to orders |
| **Risk** | View open, expired and completed-request counts and current controls |
| **Reconciliation & ledger** | Understand posted financial records and download available ledger data |
| **Reports & exports** | Review activity over selected periods and export recorded data |
| **Notifications** | See operational messages associated with the workspace |
| **Voice alerts / soundbox** | Announce a recorded completed transaction via the browser interface |
| **Business settings** | Maintain the business identity and contact details |
| **IP directory** | Store business server addresses as a directory; not currently enforced as a payment-API gate |

The interface is designed for desktop and mobile use. All figures should come from actual recorded state, rather than fictitious payments or decorative analytics.

## Owner command centre

The platform owner can review access requests, approve and invite merchants, manage active tenants, examine recorded transactions, inspect evidence and ledger entries, view incidents and platform analytics, and see owner settings and operational release gates. The internal test merchant is intentionally separate from external businesses.

### Access pathway

~~~mermaid
flowchart TD
 A["Business requests access"] --> B["Platform owner reviews application"]
 B --> C{"Approved?"}
 C -->|No| D["No active merchant workspace"]
 C -->|Yes| E["Approved invitation and identity binding"]
 E --> F["Business completes receiving-account setup"]
 F --> G["Merchant creates own orders"]
 G --> H["Only its own records and reports"]
~~~

A successful sign-in is not, by itself, a merchant approval in invite-only mode.

## What account separation means

A merchant should not see another merchant's receiving addresses, order amounts, reports, or private evidence. The active product uses tenant-bound records and controlled identity checks, and the repository includes tenant-isolation tests. External acceptance testing is still necessary before onboarding live customers.

## Everyday merchant example

A shop owner creates a ₹500 payment request. The customer receives a link showing the chosen receiving UPI address and ₹500. The owner can see the pending order in the transaction view, follow available Vault evidence, identify any mismatch and later see a completed record if a qualified credit is accounted for. If the customer simply returns from the UPI app, the merchant does not receive an invented success.

## Product boundaries

The merchant dashboard and owner console exist in the active Node product. Historical Python dashboards or stored workflow files should not be described as additional live environments. Some UI views expose operational information but do not by themselves imply externally integrated automation, actual bank acceptance or active IP enforcement.

Read [the full order journey](End-to-End-Journey.md) and [the milestone plan](Release-Status-and-Roadmap.md).

[Back to the knowledge centre](Home.md)
