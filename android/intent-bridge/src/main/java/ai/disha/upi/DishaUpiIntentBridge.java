package ai.disha.upi;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;

/**
 * Reusable native UPI Intent bridge. No bank API, UPI Collect or gateway SDK.
 *
 * The caller must handle activity lifecycle, app absence and browser fallback.
 * The returned Intent is untrusted data; NEVER use it to mark a payment paid.
 */
public final class DishaUpiIntentBridge {
    private DishaUpiIntentBridge() {}

    public static boolean isPaymentUri(Uri uri) {
        return uri != null
            && "upi".equalsIgnoreCase(uri.getScheme())
            && "pay".equalsIgnoreCase(uri.getHost())
            && uri.getQueryParameter("pa") != null
            && uri.getQueryParameter("am") != null
            && uri.getQueryParameter("cu") != null
            && "INR".equalsIgnoreCase(uri.getQueryParameter("cu"));
    }

    public static long launch(Activity host, Uri uri, int requestCode) {
        if (!isPaymentUri(uri)) {
            throw new IllegalArgumentException("INVALID_UPI_PAYMENT_URI");
        }
        // Native receiver selection is delegated to Android's public intent
        // resolver. Do not inspect other app storage, accessibility trees or PIN.
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        host.startActivityForResult(intent, requestCode);
        return SystemClock.elapsedRealtime();
    }

    public static Evidence classify(int resultCode, Intent response, long startedMs) {
        String classification = resultCode == Activity.RESULT_OK ? "APP_REPORTED_OK"
            : resultCode == Activity.RESULT_CANCELED ? "CANCELLED" : "OTHER";
        String raw = response == null ? null : response.getStringExtra("Status");
        String reported = raw != null && raw.equalsIgnoreCase("SUCCESS") ? "SUCCESS"
            : raw != null && raw.equalsIgnoreCase("FAILURE") ? "FAILURE" : "UNAVAILABLE";
        long ms = startedMs <= 0 ? -1 : Math.max(0, SystemClock.elapsedRealtime() - startedMs);
        return new Evidence(classification, reported, ms);
    }

    public static final class Evidence {
        public final String classification;
        public final String appReportedStatus;
        public final long elapsedMs;
        public final boolean bankVerified = false;
        private Evidence(String classification, String reportedStatus, long elapsedMs) {
            this.classification = classification;
            this.appReportedStatus = reportedStatus;
            this.elapsedMs = elapsedMs;
        }
    }
}
