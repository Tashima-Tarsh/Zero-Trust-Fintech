# Reusable Android UPI Intent bridge

The Java code under this module is **not a bank API**. It uses only Android's
public \`ACTION_VIEW\` intent mechanism. It validates the \`upi://pay\` scheme
and required recipient/amount/currency fields, then returns dispatch/return
observations to the enclosing Android application.

A native DISHA wrapper can use \`DishaUpiIntentBridge.launch(activity, uri, 8202)\`
from its WebViewClient, then call \`DishaUpiIntentBridge.classify(...)\` from
\`onActivityResult\` to obtain an \`Evidence\` result. It must not interpret the
\`APP_REPORTED_OK\` classification or reported \`Status=SUCCESS\` as money received.
Bank and PSP apps can cancel, omit Activity results, or return inconsistent data.

The Android 35/37 test host compiles this **same Java source file** using a
Gradle \`sourceSets\` link. Its fake receiver is CI-only and never moves money.

On Android Chrome, this Java class is **not installed by the website**, and
Chrome's own \`intent://\` handling applies instead. To collect native result
evidence in a production checkout, users would need an installed native wrapper.
The native OS does not give an ordinary Chrome website access to another
application's private payment status, SMS, financial ledger or UPI PIN.
