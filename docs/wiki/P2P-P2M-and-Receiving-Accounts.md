# Personal and merchant UPI — P2P, P2M and receiving-account operations

An account's classification matters because banking applications and acquiring institutions do not treat all UPI payment requests identically. DISHA records the account type and preserves it for the life of the order.

## Two payment types

| | Personal receiving UPI (P2P) | Bank-issued merchant receiving UPI (P2M) |
| --- | --- | --- |
| Intended recipient | An eligible personal UPI address | A bank/acquirer-registered merchant address |
| Who authorizes eligibility | The applicable account bank/provider | The issuing bank/acquirer and applicable merchant rules |
| What DISHA shows | Personal receiving account | Merchant receiving account |
| What DISHA preserves | Payee and amount for that order | Merchant identity, payee, amount and the bank-issued merchant classification |
| Can DISHA convert it into the other type? | **No** | **No** |
| Status in code | Different construction path and validation | Requires a real merchant category value and correct classification |
| Live launch evidence | Real bank/app P2P acceptance pending | Bank-issued merchant eligibility and P2M acceptance pending |

The **merchant category code (MCC)** is a banking classification, not a marketing choice. Entering a four-digit value into software cannot create bank-approved merchant status.

## How a merchant manages receiving accounts

The approved business adds its own receiving UPI address, account holder name and applicable bank/category details. It can set a primary account, register more addresses, pause or resume eligible accounts and use a controlled bulk import. The platform records account status, activity and health-related indicators.

When a new order is created, its intended payee details are kept with the order. Changing the merchant's primary UPI account later must not silently redirect an already-shared link.

~~~mermaid
flowchart TD
 A["Merchant owns eligible receiving accounts"] --> B["Choose correct P2P or P2M classification"]
 B --> C["DISHA checks required account details"]
 C --> D["Create order with fixed receiving details"]
 D --> E["Generate checkout and QR"]
 E --> F["Existing UPI app decides whether the request is accepted"]
 F --> G["Observe and reconcile separately"]
~~~

## Multiple receiving accounts and account health

The active product includes account lists, a primary-account setting, per-account activity indicators and routing/availability controls. These can help the merchant manage configured receiving accounts and avoid selecting an account that has been paused or is otherwise unavailable.

The repository also contains a larger VPA routing engine and stored n8n workflows for health and quarantine. Their presence does not establish that a bank has approved any account rotation, that bank restrictions can be evaded or that all workflow automation is operating in the production service.

## Common failure situations

**The UPI app fails before PIN.** This can be caused by app support, receiving account eligibility, an invalid merchant classification or other bank-side rejection. It is not proof the customer entered the wrong PIN or that the merchant received money.

**An account is personal but declared merchant.** DISHA is designed to reject inconsistent classification rather than quietly downgrading it to a personal transfer.

**The merchant edits the primary receiving account.** A previously issued order should remain bound to the originally recorded recipient.

**A QR opens but the bank refuses the recipient.** Producing a syntactically valid QR does not certify that a bank accepts the account.

## Live acceptance required

Before external merchants accept real money, an actual personal VPA and an actual bank-issued merchant VPA need separate on-device tests, including a small successful payment, incorrect PIN, cancellation, expiry and app refusal. A qualifying financial credit must be established separately from the appearance of the UPI app.

[End-to-end journey](End-to-End-Journey.md) · [Product roadmap](Release-Status-and-Roadmap.md) · [Home](Home.md)
