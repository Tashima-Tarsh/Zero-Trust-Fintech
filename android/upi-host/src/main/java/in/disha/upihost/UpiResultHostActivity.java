package in.disha.upihost;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.Gravity;
import android.widget.TextView;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class UpiResultHostActivity extends ComponentActivity {
    private static final String PREFS = "disha_upi_host";
    private static final String KEY_ALIAS_PREFIX = "disha_upi_session_";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final String[] ALLOWED_UPI_PACKAGES = {
        "com.google.android.apps.nbu.paisa.user", "com.phonepe.app",
        "net.one97.paytm", "in.org.npci.upiapp"
    };

    private ActivityResultLauncher<Intent> upiLauncher;
    private TextView statusView;
    private String apiBase, orderId, token, upiUri, upiPackage, returnUrl, nonce, deviceId;
    private boolean launched;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        statusView = new TextView(this);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(32, 32, 32, 32);
        statusView.setText("DISHA is preparing your session-bound UPI handoff…");
        setContentView(statusView);
        upiLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), this::onUpiResult);
        if (!readLaunch(getIntent())) {
            show("Invalid or incomplete DISHA payment handoff. Return to checkout.");
            return;
        }
        enrollThenLaunch();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!launched && readLaunch(intent)) enrollThenLaunch();
    }

    private boolean readLaunch(Intent source) {
        Uri link = source == null ? null : source.getData();
        if (link == null || !"disha".equals(link.getScheme()) || !"pay".equals(link.getHost())) return false;
        apiBase = link.getQueryParameter("apiBase");
        orderId = link.getQueryParameter("orderId");
        token = link.getQueryParameter("token");
        upiUri = link.getQueryParameter("upiUri");
        upiPackage = link.getQueryParameter("upiPackage");
        returnUrl = link.getQueryParameter("returnUrl");
        if (!validApiBase(apiBase) || !validId(orderId) || token == null ||
            !token.matches("(?i)^[a-f0-9]{24,64}$") || !allowedPackage(upiPackage) ||
            upiUri == null || returnUrl == null || !validReturnUrl(returnUrl)) return false;
        Uri payment = Uri.parse(upiUri);
        if (!"upi".equals(payment.getScheme()) || !"pay".equals(payment.getHost())) return false;
        String payee = payment.getQueryParameter("pa");
        String amount = payment.getQueryParameter("am");
        return payee != null && payee.matches("(?i)^[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}$") &&
            amount != null && amount.matches("^[0-9]+\\.[0-9]{2}$") &&
            "INR".equalsIgnoreCase(payment.getQueryParameter("cu"));
    }

    private void enrollThenLaunch() {
        if (launched) return;
        launched = true;
        show("Preparing a one-session device key. No notification or other device permissions are used.");
        IO.execute(() -> {
            try {
                KeyPair pair = keyPair();
                String deviceKey = "deviceId_" + orderId;
                deviceId = getSharedPreferences(PREFS, MODE_PRIVATE).getString(deviceKey, null);
                if (deviceId == null) {
                    deviceId = UUID.randomUUID().toString().replace("-", "_");
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(deviceKey, deviceId).apply();
                }
                String publicPem = "-----BEGIN PUBLIC KEY-----\\n" +
                    Base64.encodeToString(pair.getPublic().getEncoded(), Base64.NO_WRAP) +
                    "\\n-----END PUBLIC KEY-----";
                JSONObject request = new JSONObject();
                request.put("consent", true);
                request.put("orderId", orderId);
                request.put("token", token);
                request.put("deviceId", deviceId);
                request.put("publicKeyPem", publicPem);
                JSONObject response = post(apiBase + "/api/session-evidence/authorize", request, token);
                nonce = response.getString("nonce");
                if (!nonce.matches("(?i)^[a-f0-9]{40}$")) throw new IllegalStateException("Invalid session nonce");
                runOnUiThread(this::launchUpi);
            } catch (Exception error) {
                runOnUiThread(() -> show("DISHA could not authorize this checkout session. No payment was launched."));
            }
        });
    }

    private void launchUpi() {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(upiUri));
        intent.setPackage(upiPackage);
        try {
            show("Opening your selected UPI app. Complete the payment there.");
            upiLauncher.launch(intent);
        } catch (ActivityNotFoundException error) {
            show("The selected UPI app is not installed. Returning to checkout.");
            returnToCheckout("app-not-installed");
        } catch (Exception error) {
            show("The UPI app could not be opened. Returning to checkout.");
            returnToCheckout("launch-failed");
        }
    }

    private void onUpiResult(ActivityResult result) {
        Map<String,String> fields = UpiResponseParser.parse(result.getData());
        String txnId = UpiResponseParser.first(fields, "txnid", "txid", "utr", "rrn");
        String approvalRef = UpiResponseParser.first(fields, "approvalrefno");
        String responseCode = UpiResponseParser.first(fields, "responsecode", "rescode");
        String status = UpiResponseParser.status(fields);
        String amountPaise = toPaise(UpiResponseParser.first(fields, "am", "amount"));
        String payee = UpiResponseParser.first(fields, "tovpa", "pa");

        if (txnId == null && approvalRef == null && responseCode == null && "UNKNOWN".equals(status)) {
            show("UPI app returned without a structured transaction response. DISHA has not invented or submitted a UTR.");
            returnToCheckout("missing");
            return;
        }

        final String reference = txnId != null ? txnId : approvalRef;
        final String finalStatus = status;
        final String finalAmountPaise = amountPaise;
        final String finalPayee = payee;
        IO.execute(() -> {
            try {
                JSONObject evidence = new JSONObject();
                evidence.put("protocol", "DISHA-SESSION-EVIDENCE-V1");
                evidence.put("eventId", UUID.randomUUID().toString().replace("-", "_"));
                evidence.put("orderId", orderId);
                evidence.put("nonce", nonce);
                evidence.put("deviceId", deviceId);
                evidence.put("packageName", upiPackage);
                evidence.put("postedAt", System.currentTimeMillis());
                evidence.put("amountPaise", finalAmountPaise == null ? JSONObject.NULL : finalAmountPaise);
                evidence.put("payeeVpa", finalPayee == null ? JSONObject.NULL : finalPayee);
                evidence.put("transactionRef", reference == null ? JSONObject.NULL : reference);
                evidence.put("status", finalStatus);

                Signature signer = Signature.getInstance("SHA256withECDSA");
                signer.initSign(keyPair().getPrivate());
                signer.update(canonicalEvidence(evidence).getBytes(StandardCharsets.UTF_8));
                String signed = Base64.encodeToString(signer.sign(),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
                JSONObject body = new JSONObject();
                body.put("evidence", evidence);
                body.put("signature", signed);
                body.put("token", token);
                JSONObject server = post(apiBase + "/api/session-evidence/event", body, token);
                runOnUiThread(() -> {
                    show("UPI response received. Reference: " +
                        (reference == null ? "not returned" : reference) +
                        ". DISHA decision: " + server.optString("decisionState", "received") + ".");
                    returnToCheckout("received");
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    show("UPI response was received but DISHA could not submit it. Checkout remains pending.");
                    returnToCheckout("upload-failed");
                });
            }
        });
    }

    private String canonicalEvidence(JSONObject e) throws Exception {
        return "{"
            + "\\"protocol\\":\\"DISHA-SESSION-EVIDENCE-V1\\""
            + ",\\"eventId\\":" + JSONObject.quote(e.getString("eventId"))
            + ",\\"orderId\\":" + JSONObject.quote(e.getString("orderId"))
            + ",\\"nonce\\":" + JSONObject.quote(e.getString("nonce"))
            + ",\\"deviceId\\":" + JSONObject.quote(e.getString("deviceId"))
            + ",\\"packageName\\":" + JSONObject.quote(e.getString("packageName"))
            + ",\\"postedAt\\":" + e.getLong("postedAt")
            + ",\\"amountPaise\\":" + nullable(e, "amountPaise")
            + ",\\"payeeVpa\\":" + nullable(e, "payeeVpa")
            + ",\\"transactionRef\\":" + nullable(e, "transactionRef")
            + ",\\"status\\":" + JSONObject.quote(e.getString("status")) + "}";
    }

    private String nullable(JSONObject object, String key) throws Exception {
        Object value = object.get(key);
        return value == JSONObject.NULL ? "null" : JSONObject.quote(String.valueOf(value));
    }

    private JSONObject post(String endpoint, JSONObject body, String csrf) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("X-CSRF-Token", csrf);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder responseText = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) responseText.append(line);
            }
        }
        connection.disconnect();
        JSONObject response = new JSONObject(responseText.toString());
        if (code < 200 || code >= 300) throw new IllegalStateException(response.optString("error", "Server rejected request"));
        return response;
    }

    private String keyAlias() throws Exception {
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(orderId.getBytes(StandardCharsets.UTF_8));
        return KEY_ALIAS_PREFIX + Base64.encodeToString(digest,
            Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private KeyPair keyPair() throws Exception {
        String alias = keyAlias();
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(alias)) {
            java.security.PrivateKey privateKey = (java.security.PrivateKey) store.getKey(alias, null);
            return new KeyPair(store.getCertificate(alias).getPublicKey(), privateKey);
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC", "AndroidKeyStore");
        generator.initialize(new android.security.keystore.KeyGenParameterSpec.Builder(alias,
            android.security.keystore.KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false).build());
        return generator.generateKeyPair();
    }

    private static String toPaise(String amount) {
        if (amount == null) return null;
        try {
            return new BigDecimal(amount.replace(",", "")).movePointRight(2)
                .setScale(0, java.math.RoundingMode.UNNECESSARY).toPlainString();
        } catch (Exception ignored) { return null; }
    }

    private static boolean allowedPackage(String value) {
        if (value == null) return false;
        for (String allowed : ALLOWED_UPI_PACKAGES) if (allowed.equals(value)) return true;
        return false;
    }
    private static boolean validId(String value) {
        return value != null && value.matches("^[A-Za-z0-9_-]{6,150}$");
    }
    private static boolean validApiBase(String value) {
        if (value == null) return false;
        Uri uri = Uri.parse(value);
        return "https".equals(uri.getScheme()) &&
            ("disha8-2.thenitishkr.in".equals(uri.getHost()) || "thenitishkr.in".equals(uri.getHost())) &&
            (uri.getPath() == null || uri.getPath().isEmpty());
    }
    private static boolean validReturnUrl(String value) {
        Uri uri = Uri.parse(value);
        return "https".equals(uri.getScheme()) &&
            ("disha8-2.thenitishkr.in".equals(uri.getHost()) || "thenitishkr.in".equals(uri.getHost()));
    }
    private void returnToCheckout(String result) {
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            String alias = keyAlias();
            if (store.containsAlias(alias)) store.deleteEntry(alias);
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove("deviceId_" + orderId).apply();
            Uri target = Uri.parse(returnUrl).buildUpon().appendQueryParameter("dishaNative", result).build();
            startActivity(new Intent(Intent.ACTION_VIEW, target));
            finish();
        } catch (Exception ignored) {}
    }
    private void show(String message) {
        if (statusView != null) statusView.setText(message);
    }
}
