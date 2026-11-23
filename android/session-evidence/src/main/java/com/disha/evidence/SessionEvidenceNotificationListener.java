package com.disha.evidence;

import android.app.Notification;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Base64;
import org.json.JSONObject;
import java.io.BufferedReader;
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
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Forwards allowlisted UPI notification fields only during an active DISHA session. */
public final class SessionEvidenceNotificationListener extends NotificationListenerService {
    private static final String PREFS = "disha_session_evidence";
    private static final String KEY_ALIAS = "disha_session_evidence_p256";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final String[] PACKAGES = {
        "com.google.android.apps.nbu.paisa.user", "com.phonepe.app",
        "net.one97.paytm", "in.org.npci.upiapp"
    };
    private static final Pattern VPA = Pattern.compile("(?i)\\b[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}\\b");
    private static final Pattern AMOUNT = Pattern.compile("(?i)(?:₹|INR\\s*|Rs\\.?\\s*)([0-9,]+(?:\\.[0-9]{1,2})?)");
    private static final Pattern REF = Pattern.compile("(?i)(?:UTR|UPI\\s*(?:REF|REFERENCE)|TRANSACTION\\s*ID|TXN\\s*ID)\\s*[:#-]?\\s*([A-Za-z0-9._:/-]{6,100})");

    public static void openNotificationAccessSettings(Context context) {
        context.startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    /** Invoke only after explicit checkout consent and confirmation of OS access. */
    public static void enroll(Context context, String apiBase, String orderId,
                              String sessionToken, String deviceId) {
        // A late enrollment response must not re-enable observation after stop/revoke.
        if (!SessionEvidenceAccess.hasNotificationAccess(context)) return;
        final String enrollmentId = UUID.randomUUID().toString();
        if (!getPrefs(context).edit().putBoolean("enabled", false)
                .putString("pendingEnrollment", enrollmentId).commit()) return;
        IO.execute(() -> {
            try {
                KeyPair pair = getOrCreateKeyPair();
                String publicPem = "-----BEGIN PUBLIC KEY-----\n" +
                    Base64.encodeToString(pair.getPublic().getEncoded(), Base64.NO_WRAP) +
                    "\n-----END PUBLIC KEY-----";
                JSONObject body = new JSONObject();
                body.put("consent", true);
                body.put("orderId", orderId);
                body.put("token", sessionToken);
                body.put("deviceId", deviceId);
                body.put("publicKeyPem", publicPem);
                JSONObject response = post(apiBase + "/api/session-evidence/authorize",
                    body.toString(), sessionToken);
                if (!enrollmentId.equals(getPrefs(context).getString("pendingEnrollment", "")) ||
                    !SessionEvidenceAccess.hasNotificationAccess(context)) return;
                getPrefs(context).edit().remove("pendingEnrollment")
                    .putString("apiBase", apiBase).putString("orderId", orderId)
                    .putString("token", sessionToken).putString("nonce", response.getString("nonce"))
                    .putString("deviceId", deviceId).putLong("expiresAt", response.getLong("expiresAt"))
                    .putBoolean("enabled", true).apply();
            } catch (Exception ignored) {
                // Fail closed. Do not activate an unenrolled session or log notification data.
            }
        });
    }

    /** Disable local observation synchronously even when the network is unavailable. */
    public static void revokeSession(Context context) {
        android.content.SharedPreferences p = getPrefs(context);
        String apiBase = p.getString("apiBase", "");
        String orderId = p.getString("orderId", "");
        String token = p.getString("token", "");
        p.edit().clear().commit();
        if (apiBase.isEmpty() || orderId.isEmpty() || token.isEmpty()) return;
        IO.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("orderId", orderId);
                body.put("token", token);
                post(apiBase + "/api/session-evidence/revoke", body.toString(), token);
            } catch (Exception ignored) {
                // The local observer is already inactive. Server revocation may be retried.
            }
        });
    }

    public static void stopSession(Context context) {
        getPrefs(context).edit().clear().commit();
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || !isAllowed(sbn.getPackageName())) return;
        android.content.SharedPreferences p = getPrefs(this);
        if (!p.getBoolean("enabled", false) || System.currentTimeMillis() >= p.getLong("expiresAt", 0)) return;
        Notification n = sbn.getNotification();
        if (n == null || n.extras == null) return;
        String text = notificationText(n.extras);
        if (text.isEmpty()) return;

        String amountPaise = parseAmountPaise(text);
        String payee = firstMatch(VPA, text);
        String transactionRef = labelledReference(text);
        String status = classifyStatus(text);
        if (amountPaise == null && payee == null && transactionRef == null && "UNKNOWN".equals(status)) return;

        final String orderId = p.getString("orderId", "");
        final String token = p.getString("token", "");
        final String nonce = p.getString("nonce", "");
        final String deviceId = p.getString("deviceId", "");
        final String apiBase = p.getString("apiBase", "");
        final long postedAt = sbn.getPostTime();
        final String packageName = sbn.getPackageName();
        IO.execute(() -> sendEvidence(apiBase, orderId, token, nonce, deviceId,
            packageName, postedAt, amountPaise, payee, transactionRef, status));
    }

    private void sendEvidence(String apiBase, String orderId, String token, String nonce,
                              String deviceId, String packageName, long postedAt,
                              String amount, String payee, String reference, String status) {
        // Drop queued events when consent is revoked before dispatch.
        if (!getPrefs(this).getBoolean("enabled", false) ||
            !orderId.equals(getPrefs(this).getString("orderId", ""))) return;
        try {
            String eventId = UUID.randomUUID().toString().replace("-", "_");
            String canonical = "{"
                + "\"protocol\":\"DISHA-SESSION-EVIDENCE-V1\""
                + ",\"eventId\":" + quote(eventId)
                + ",\"orderId\":" + quote(orderId)
                + ",\"nonce\":" + quote(nonce)
                + ",\"deviceId\":" + quote(deviceId)
                + ",\"packageName\":" + quote(packageName)
                + ",\"postedAt\":" + postedAt
                + ",\"amountPaise\":" + nullable(amount)
                + ",\"payeeVpa\":" + nullable(payee)
                + ",\"transactionRef\":" + nullable(reference)
                + ",\"status\":" + quote(status) + "}";
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(getOrCreateKeyPair().getPrivate());
            signer.update(canonical.getBytes(StandardCharsets.UTF_8));
            String signature = Base64.encodeToString(signer.sign(),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            JSONObject body = new JSONObject();
            body.put("evidence", new JSONObject(canonical));
            body.put("signature", signature);
            body.put("token", token);
            post(apiBase + "/api/session-evidence/event", body.toString(), token);
        } catch (Exception ignored) {
            // No raw notification is persisted, logged or retried.
        }
    }

    private static JSONObject post(String endpoint, String json, String csrf) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(endpoint).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("X-CSRF-Token", csrf);
        try (OutputStream out = c.getOutputStream()) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        java.io.InputStream stream = code >= 200 && code < 300 ? c.getInputStream() : c.getErrorStream();
        if (stream == null) throw new IllegalStateException("Evidence request rejected");
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line; while ((line = reader.readLine()) != null) result.append(line);
        } finally { c.disconnect(); }
        if (code < 200 || code >= 300) throw new IllegalStateException("Evidence request rejected");
        return new JSONObject(result.toString());
    }

    private static KeyPair getOrCreateKeyPair() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            java.security.PrivateKey privateKey = (java.security.PrivateKey) store.getKey(KEY_ALIAS, null);
            java.security.cert.Certificate cert = store.getCertificate(KEY_ALIAS);
            return new KeyPair(cert.getPublicKey(), privateKey);
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC", "AndroidKeyStore");
        generator.initialize(new android.security.keystore.KeyGenParameterSpec.Builder(KEY_ALIAS,
            android.security.keystore.KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false).build());
        return generator.generateKeyPair();
    }

    private static android.content.SharedPreferences getPrefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
    private static boolean isAllowed(String name) {
        for (String p : PACKAGES) if (p.equals(name)) return true;
        return false;
    }
    private static String notificationText(Bundle extras) {
        CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (text == null) text = extras.getCharSequence(Notification.EXTRA_TEXT);
        String value = (title == null ? "" : title.toString()) + " " + (text == null ? "" : text.toString());
        return value.length() > 2000 ? value.substring(0, 2000) : value;
    }
    private static String firstMatch(Pattern pattern, String text) {
        Matcher m = pattern.matcher(text); return m.find() ? m.group() : null;
    }
    private static String labelledReference(String text) {
        Matcher m = REF.matcher(text); return m.find() ? m.group(1) : null;
    }
    private static String parseAmountPaise(String text) {
        Matcher m = AMOUNT.matcher(text);
        if (!m.find()) return null;
        String raw = m.group(1).replace(",", "");
        try { return new BigDecimal(raw).movePointRight(2).setScale(0, BigDecimal.ROUND_UNNECESSARY).toPlainString(); }
        catch (Exception ignored) { return null; }
    }
    private static String classifyStatus(String text) {
        String t = text.toLowerCase();
        if (t.contains("failed") || t.contains("declined")) return "FAILED";
        if (t.contains("pending") || t.contains("processing")) return "PENDING";
        if (t.contains("successful") || t.contains("success") || t.contains("paid")) return "SUCCESS";
        return "UNKNOWN";
    }
    private static String quote(String s) { return JSONObject.quote(s); }
    private static String nullable(String s) { return s == null ? "null" : quote(s); }
}
