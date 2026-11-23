# DISHA iDebit autoresearch program
Hypothesis: enforceable evidence provenance + strict matching + no-replay controls prevent synthetic forged and misbound receipts from being falsely elevated to verified.

Editable policy: `idebit.js`. Fixed evaluation: `research.test.js`.
For every experiment: record baseline; edit policy; run `node research.test.js`; collect passing count and false acceptance failures; keep only changes with zero security regression; discard otherwise. Prefer simpler implementations at equal correctness. Never edit test assertions to improve the score. Use isolated branches. No real-money testing, no ledger mutation, no claimed bank attestation.

Research question still open: identify an authorized evidence issuer that independently proves both debit and recipient credit without any bank, PSP or network-side data agreement. If none exists, report impossibility under stated inputs rather than inventing one.
