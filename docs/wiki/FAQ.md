# DISHA 8.2 — Frequently Asked Questions

## What is DISHA 8.2?

DISHA is merchant-owned payment intelligence software around direct UPI checkout, device evidence, risk decisions, merchant operations and financial records. It is not a new UPI network or bank.

## What is the principal benefit?

Every payment request can have a consistent story: what the merchant asked for, what the customer attempted, what the checkout observed and what can be financially recorded.

## Does the customer need a DISHA wallet or mobile app?

No new DISHA wallet is required. On supported devices, a customer can open a familiar UPI application from the checkout; a QR alternative is provided.

## What is DISHA Vault?

A device-authorized, order-specific observation system. It can record the checkout's permitted browser handoff and return information. [See the full architecture](Vault-Architecture.md).

## Does the Vault read my UPI PIN or private bank screen?

No. Those remain inside the customer's bank/payment application. The Vault observes the first-party browser's own journey and any permitted return parameters.

## What happens if a customer closes the UPI app before paying?

DISHA does not equate opening or closing the app with a completed payment. The order retains the observations and its actual financial status.

## Can a UTR alone confirm a payment?

A reference is useful, but a customer-supplied or browser-exposed reference alone does not prove that funds reached the intended receiving account. Financial completion depends on qualified matching credit evidence.

## How does DISHA respond to a fake receipt?

It keeps customer-origin receipts or references at the evidence level. They can be compared with the order and flagged, but they do not themselves create completed accounting entries.

## What fraud controls does DISHA use?

Order and recipient consistency, exact amount checks, temporal screening, conflicting-reference detection, duplicate-event controls, qualified-credit matching and financial exception review. [Explore fraud intelligence](Fraud-and-Risk-Protection.md).

## Can a merchant choose several receiving UPI addresses?

Yes. The merchant workspace supports multiple receiving accounts, primary selection and eligible account-management controls. A payment request retains its original payee details.

## Does DISHA support P2P and P2M?

It distinguishes personal UPI receiving accounts from bank-issued merchant receiving accounts. A merchant classification must be legitimate; DISHA does not create merchant eligibility by renaming an account.

## What is the three-minute timer?

The order-specific checkout has a defined 180-second payment request window. It helps manage validity and timing context but does not itself establish whether a bank credit exists.

## Does DISHA hold customer funds?

DISHA's software model is non-custodial. Actual UPI money movement happens through the applicable existing banking system.

## What happens when a payment is confirmed?

When a qualified financial record matches the original order, the transaction can be accounted for in the balanced ledger, and the checkout can present a completed receipt.

## What can the merchant see?

Orders, receiving UPI accounts, recorded statuses, Vault evidence, risk-oriented views, reports, notifications, financial ledger records and exports, all within the business's workspace.

## What can the platform owner see?

Access applications, merchant approvals, separate tenants, overall transaction oversight, incidents and platform financial/evidence reporting, subject to owner access controls.

## How is DISHA priced?

The proposed commercial relationship is one-time software licensing and implementation rather than a DISHA percentage of payment volume. Specific terms, hosting, bank charges, maintenance and support are agreed separately.

## Does DISHA remove every UPI fee?

No. The real financial benefit depends on the merchant's current arrangement and which specific platform charges are avoidable. Many UPI payment categories do not incur the same fee structure.

## Is the source unrestricted open source?

No. The source is publicly accessible under Business Source License 1.1 with restrictions on commercial use. An appropriate agreement is required for commercial deployment.

## Where can I explore DISHA?

Visit the [DISHA 8.2 website](https://disha8-2.thenitishkr.in/), [product architecture](Platform-Architecture.md), [knowledge centre](Home.md), or [request access](https://disha8-2.thenitishkr.in/request-access).

[Back to the knowledge centre](Home.md)
