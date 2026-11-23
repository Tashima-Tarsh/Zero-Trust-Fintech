# DISHA iDebit Autoresearch (isolated experiment)
Adapted from https://github.com/karpathy/autoresearch 's **fixed evaluation, hypothesis, keep/discard** methodology, NOT its GPU training code.

Run: `node experiments/idebit-autoresearch/research.test.js` (Node >=18). No dependencies or real payments.

This research policy validates strict schemas, Ed25519 issuer signatures, amount/payee/session bindings, bounded timestamps, payer-and-payee finality *claims*, and replay protection. The test issuer is synthetic; the authorityVerified registry flag must NEVER be enabled for a source without independently established contractual and technical authority to report both payer debit and payee credit finality.

**Never connect this experiment to ledger success, crediting, settlement or production callbacks.** `VERIFIED_IN_TEST` is not actual payment verification. In-memory replay tracking is only a test model; production must use atomic durable unique constraints, issuer lifecycle governance, reconciliation, and handling of reversals and late evidence.

This does not create a no-bank UPI proof oracle. Browser JavaScript cannot observe genuine private bank ledgers, and any merely self-signed or customer-controlled debit claim remains unverified.

Research: https://github.com/karpathy/autoresearch
