# DISHA 8.2 — UTR-first hypothesis evaluation (18 November 2026)

## Vision and constraints

DISHA is a self-hosted, direct P2P UPI SaaS platform. It does not require an
aggregator, payment gateway or bank API. This evaluation retains that product
scope. **Testing evidence is not an instruction to integrate a bank API.**

## What can be established without a bank API?

| Observation in DISHA | Can it be established? | What it actually proves |
|---|---|---|
| A 12-digit UTR appeared in an app or receipt | Yes | A *reference was supplied*, not that funds arrived |
| Same UTR associated with two orders | Yes | Reference reuse against this platform's orders |
| UTR amount matches challenge | Sometimes | Stated amount matches expected amount |
| UTR appears in a claimed-success receipt | Yes | The receipt says success; text can be fabricated |
| Correct receiving UPI ID appears | Yes | Payee details in the supplied data match the request |
| Money was credited to recipient's account | Not from the above alone | Requires a trustworthy credit-status observation |
| Final payee credit can be inferred with 100% certainty from UTR syntax | No | Invalid implication: the reference identifies the transaction, not its terminal state |

## Current-code verification

Run `node tests/test-utr-hypothesis.js`. It executes the **actual** receipt
extractor from `server.js` and the real `utils/trust-score.js`. It exercises
the following synthetic scenarios entirely locally, without payment traffic:

1. A bare UTR with no payee detail.
2. UTR associated with `FAILED`.
3. UTR associated with `PENDING`.
4. UTR with wrong VPA.
5. UTR with incorrect amount.
6. Reused UTR.
7. Incorrectly formatted reference.
8. Completely fabricated receipt text stating success must NOT score `HIGH`.
9. Source-level CFC route must NOT post a completed ledger entry from a UTR
   and checkout-token binding.

**Expected after #34:** scenarios 1–7 are rejected by relevant guards;
scenario 8 is restricted below HIGH and cannot release money; scenario 9
records the UTR without a ledger posting. A passing diagnostic confirms these
specific controls, not actual bank-credit confirmation.

## No-bank-API benchmark to test the proposed innovation

To establish a statistically meaningful claim, a controlled independent
observer should label 1,000 or more attempts using separate evidence of the
actual funds received. This is a **test oracle**, not an API integration
required by the production product.

Create a consented dataset covering: genuine completed credits; genuine
PENDING, timeout and FAILED transactions that display a UTR; duplicate UTR
across orders; amounts off by ₹0.01; wrong recipient; canceled UPI intents;
screenshot forgery; a stolen valid UTR; payments outside TTL; retries; delayed
credit; and reversals. Keep personal UPI and account identifiers redacted.

Measure:
- False positive rate = orders marked SUCCESS with no verified payee credit
  divided by all non-credited attempts.
- False negative rate = credited orders left unconfirmed divided by credited
  attempts.
- Median and p99 confirmation time.
- UTR replay acceptance rate (target zero).
- Amount/payee mismatch acceptance rate (target zero).
- Availability and recovery across device families and UPI apps.

This benchmark may validate the utility of DISHA's correlation and automation,
but cannot turn a text reference into an authenticated final transaction status.

## Public evidence

- NPCI UPI HELP: a successful transaction requires successful debit *and*
  receiver credit; pending means final confirmation is unavailable.
- Punjab National Bank / BHIM FAQ: pending transaction history can contain
  a UTR or bank reference number.
- Paytm UPI reference explanation (2026): pending and failed transactions can
  have UTRs as well.
- Competing self-hosted UPI projects exist, including YouPI-PG and local
  screenshot/statement-based ProofCheck. Thus no global #1 uniqueness claim
  can responsibly be inferred from repo structure.

## Release result

The premise **UTR exists ⇒ payee credited** is falsified by documented
real-world pending/failed transactions with reference numbers. In the current
code, verification of a reference's *shape* and *non-reuse* is real; proving
an account credit is a separate property. Keep them distinct in merchant
status and financial accounting. Do not market a false-positive as settlement.

This file is a research/test artifact only: no payment route, no credentials,
no bank API, no production data and no merchant record is modified.
