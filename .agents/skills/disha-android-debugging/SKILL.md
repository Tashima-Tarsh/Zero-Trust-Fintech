---
name: disha-android-debugging
description: Evidence-based diagnosis of DISHA Android UPI Intent P2P/P2M handoff using real device, Chrome and Android test receiver.
---
# DISHA Android debugging

Use for app-launch, pre-PIN return, app refusal, activity lifecycle or wrong receiving-account classification.

- No fix before root cause or at least a demonstrated incorrect boundary is found. Record observed vs inferred.
- Determine the **exact active receiving app** from `dumpsys activity activities`; do not confuse a package (e.g. Slice) with a user-expected app (e.g. Google Pay).
- Keep browser `intent://`, Android WebView `upi://pay`, and cross-phone QR scanning as three distinct journeys.
- For each run, capture one short time window: user tap, ActivityTaskManager launch, app screen, any app-specific error, return to checkout; never log PIN, credentials, or full personal VPA.
- Reproduce independently for P2P and P2M; for P2M compare the exact request parameters with the receiving bank's issued merchant QR rather than inventing MCC or merchant classification.
- A backend HTTP 200 proves only session/ledger endpoint availability. An app opening proves only Intent routing. Neither proves payment acceptance.
- Make the smallest change preserving financial state; add one focused regression. Remove temporary diagnostics before shipping.
- Three unproductive fixes trigger review of the architecture and test assumptions rather than further speculative changes.

Grounding: user-supplied Android Debugging SKILL.md; Google `android/skills` (android-intent-security, testing-setup); Ponytail `DietrichGebert/ponytail`.
