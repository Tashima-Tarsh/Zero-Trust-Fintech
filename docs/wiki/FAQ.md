# Frequently asked questions — DISHA 8.2

## Is DISHA a new payment app or digital wallet?

No. Customers use their existing supported UPI apps. DISHA provides merchant-owned checkout software, evidence capture, risk review, account management and financial-record workflows around those payments.

## Does DISHA hold customers' funds?

Its product concept is non-custodial: funds move through the existing UPI participants to the intended receiving account rather than into a DISHA wallet.

## Does the buyer have to install DISHA?

No separate DISHA consumer wallet installation is required. The checkout can offer installed UPI apps on a supported phone or a QR alternative.

## What exactly is DISHA Vault?

An order-bound, passkey-authorized observation trail for a customer's checkout handoff and browser return. It records what the first-party browser can observe; it is not a bank account reader or proof of funds.

## Can DISHA automatically discover the UTR inside PhonePe or Google Pay?

A normal browser cannot inspect another app's private transaction details. It can record permitted return details *if* the app exposes them. Some returns have no UTR and should be recorded honestly as such.

## Does a 12-digit UTR prove payment success?

No. A UTR can appear on pending or unsuccessful transfers. It is useful as a candidate reference, but a qualifying account credit is needed for a financially completed record.

## What happens if a customer closes the UPI app without paying?

The checkout should not claim that the merchant received money. The order can remain unresolved or expire, and any observed return can be recorded as evidence.

## Can DISHA protect against fake screenshots and replay?

It includes controls that keep unverified screenshots and customer-origin reference claims from becoming completed financial records on their own, and it checks conflicts and duplicates. It cannot promise zero fraud.

## Does DISHA offer both P2P and P2M?

The repository distinguishes personal receiving accounts from bank-issued merchant accounts. A merchant account requires authentic bank/acquirer classification; DISHA does not create it simply by labelling a payment P2M.

## Does the merchant receive funds instantly?

The applicable banking system determines transfer and settlement outcomes. DISHA cannot guarantee instantaneous credit merely because the UPI app shows a response. A completed DISHA accounting record depends on an appropriately qualified credit.

## Does DISHA charge 0% MDR?

The proposed DISHA software arrangement does not deduct a DISHA percentage from each transaction. That does **not** mean all banks, external payment products or merchant transaction categories have zero fees. The applicable charges depend on the actual arrangement.

## How is the product priced?

The proposal is one-time software licensing and implementation, with the written scope defining any support, hosting or third-party costs. No universal price is established in this repository.

## Can a merchant import many receiving UPI IDs?

The merchant workspace includes managed additional receiving accounts and controlled bulk import. Bank eligibility, contractual restrictions and account acceptance still apply.

## Are all receiving-account rotation and n8n health workflows live?

No such claim can be made from workflow files alone. The repository includes stored orchestration definitions and active receiving-account management, but the 19 November assessment did not establish a running end-to-end n8n bank-credit workflow.

## What is on the merchant dashboard?

Order creation and tracking, transaction history, receiving UPI accounts, reports, exports, evidence, ledger views, notifications, settings and operational controls. The platform owner has a separate approval and oversight console.

## When does the customer get a payment receipt?

When DISHA has a completed financial record supported by an appropriate matching credit. A browser return or customer screenshot alone must not generate a paid receipt.

## Is it ready for live merchant onboarding?

Not for unmonitored external real-money use as of the documented 19 November 2026 release assessment. The live P2P/P2M bank acceptance, independently sourced credit and complete operations/sign-off remain open release gates.

## Is the repository open-source?

The code is publicly visible, but the actual Business Source License 1.1 terms restrict commercial use and require licensing. It is more accurate to call it **source-available** than unrestricted open source.

## How can I review the product and track readiness?

See the [main product page](../../README.md), the [complete journey](End-to-End-Journey.md), the [release roadmap](Release-Status-and-Roadmap.md), and [the website](https://disha8-2.thenitishkr.in/).

[Back to the knowledge centre](Home.md)
