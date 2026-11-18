# Product release status and delivery milestones

**As of 19 November 2026: NO-GO for unmonitored external real-money merchant onboarding.**

This is the repository's **product management release view**, based on the active checkout, merchant code, owner controls, Vault evidence and the production assessment current at the time of documentation. It is not a prediction about a future launch date.

## Product maturity

| Capability | Current assessment | What is required to call it launch-ready |
| --- | --- | --- |
| Merchant-facing checkout, dynamic QR and three-minute timer | **Built in active product** | Real-device checkout and bank-app confirmation |
| Correct personal P2P intent construction | **Built / acceptance outstanding** | Live personal UPI receiving-account test |
| Bank-issued P2M order creation | **Built / acceptance outstanding** | Merchant eligibility, true merchant category and live app test |
| Invite-only merchant onboarding and owner approvals | **Built** | Full external pilot and owner acceptance |
| Merchant orders, receiving UPIs, exports and workspace | **Built** | Cross-tenant and resilience acceptance |
| DISHA Vault device evidence | **Built with constraints** | Real-device coverage, durable challenge scaling and provenance review |
| Customer-claim fraud safeguards | **Built with follow-up tests** | Measurement, adversarial and independent review |
| Qualified credit matching, quarantine and balanced ledger | **Built but source not connected** | Authenticated actual credit source and live ₹1 financial-cycle test |
| Live money-credited-to-receipt journey | **Not end-to-end verified** | Prove credit, ledger, status and receipt on live accounts |
| n8n workflow orchestration | **Workflow assets stored, runtime unverified** | Validated production installation, source and monitoring if used |
| Release certification | **Not complete** | Owner GO decision backed by full acceptance evidence |

The repository contains both the actively deployed root Node product and a separate Python implementation; only the active product is counted in the statuses above.

## Roadmap and milestone tracking

Each phase is tracked as a concrete GitHub issue with checkboxes. They are **milestone tracking issues**, not GitHub's native Milestones objects, which require a separate publishing action.

| Phase | Outcome and exit criterion | Tracking |
| --- | --- | --- |
| **01 · P2P acceptance** | A real ₹1 personal UPI payment reaches PIN and beneficiary credit; cancellation/failure matrix passes | [Issue #51](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/issues/51) |
| **02 · P2M eligibility** | Bank-issued merchant VPA/MCC accepted; no pre-PIN rejection or classification downgrade | [Issue #52](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/issues/52) |
| **03 · Financial truth** | Verified credit-to-order matching, idempotent ledger and receipt proven with live bank data | [Issue #53](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/issues/53) |
| **04 · Vault and fraud confidence** | Real-device evidence coverage, accurate exception handling, measured error rates | [Issue #54](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/issues/54) |
| **05 · Operating resilience** | Merchant isolation, backup/restore, monitoring and independent acceptance pass | [Issue #55](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/issues/55) |
| **06 · Controlled commercial release** | Licensing, merchant handover, support model and signed launch checklist complete | [Issue #56](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/issues/56) |

A prior open issue, [#32 — customer-supplied receipt confidence must not create a completed ledger entry](https://github.com/Tashima-Tarsh/Zero-Trust-Fintech/issues/32), remains a tracked acceptance concern. Later safeguards in code need to be assessed against that acceptance condition rather than automatically treating an open issue as a newly verified bug.

## High-level sequence

~~~mermaid
flowchart LR
 A["01 · Live P2P"] --> C["03 · Qualified credit and receipt"]
 B["02 · Live P2M"] --> C
 C --> D["04 · Vault and fraud validation"]
 D --> E["05 · Production operations"]
 E --> F["06 · Controlled launch"]
~~~

Some workstreams may proceed concurrently, but a product-level GO requires all critical release criteria to pass.

## Explicit GO / NO-GO decision points

A release owner should refuse external real-money onboarding if any of the following remains unresolved:

- A bank-app refuses an otherwise valid P2P or registered P2M payment before the expected PIN stage.
- The merchant account has not been confirmed as eligible for its chosen P2M classification.
- There is no trusted real-world source of financial credit evidence driving the final reconciliation.
- A customer-origin success claim can cause an unconditional paid receipt or ledger entry.
- A mismatch or replay can create a second completed financial record.
- Merchant data isolation, recoverability, incident monitoring or owner approval has not passed acceptance.
- The merchant has not received a clear explanation of unresolved payment handling and operational responsibilities.

## What was already accomplished in source

The current product has moved beyond prototypes in several important ways: owner-controlled onboarding, persistent merchant-specific records, order-bound payee/account classification, a three-minute expiry, device handoff evidence, honest status polling, non-authoritative UTR candidate handling, tenant-aware financial matching and an explicit owner release-gate view.

Those implementation achievements are real—but passing code tests is not the same as real-money bank acceptance.

## Ownership and reporting

The product owner should maintain each tracking issue with dated acceptance evidence, unresolved blocker, accountable owner and final sign-off. Leave phases open until their acceptance checks are demonstrated. Avoid attaching arbitrary dates or completion percentages without evidence.

After all gates pass, the owner may record a **GO** for a defined, limited merchant cohort and device/account matrix. Broader scale requires its own measured operational review.

**Source basis:** root server and checkout code, merchant workspace and platform control, financial reconciliation/Vault modules, and repository production assessments dated 18–19 November 2026.

[Return to knowledge centre](Home.md)
