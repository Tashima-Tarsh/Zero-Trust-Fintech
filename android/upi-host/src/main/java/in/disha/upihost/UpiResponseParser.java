package in.disha.upihost;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Parses only fields explicitly returned by the UPI application. */
final class UpiResponseParser {
    private UpiResponseParser() {}
    static Map<String,String> parse(Intent intent) {
        Map<String,String> values = new HashMap<>();
        if (intent == null) return values;
        Bundle extras = intent.getExtras();
        if (extras != null) for (String key : extras.keySet()) {
            Object value = extras.get(key);
            if (value instanceof CharSequence || value instanceof Number) values.put(key.toLowerCase(Locale.ROOT), String.valueOf(value));
        }
        String response = first(values, "response", "upi_response", "result");
        if (response != null) parseQuery(response, values);
        Uri data = intent.getData();
        if (data != null) for (String key : data.getQueryParameterNames()) {
            String value = data.getQueryParameter(key);
            if (value != null) values.put(key.toLowerCase(Locale.ROOT), value);
        }
        return values;
    }
    private static void parseQuery(String raw, Map<String,String> values) {
        String query = raw.trim();
        int question = query.indexOf('?');
        if (question >= 0) query = query.substring(question + 1);
        for (String pair : query.split("&")) {
            if (pair.isEmpty()) continue;
            int equals = pair.indexOf('=');
            if (equals <= 0) continue;
            values.put(Uri.decode(pair.substring(0,equals)).toLowerCase(Locale.ROOT),
                Uri.decode(pair.substring(equals+1)));
        }
    }
    static String first(Map<String,String> values, String... keys) {
        for (String key : keys) {
            String value = values.get(key.toLowerCase(Locale.ROOT));
            if (value != null && !value.trim().isEmpty()) return value.trim();
        }
        return null;
    }
    static String status(Map<String,String> values) {
        String status = first(values,"status"), code = first(values,"responsecode","rescode");
        if ("00".equals(code) || "SUCCESS".equalsIgnoreCase(status)) return "SUCCESS";
        if ("08".equals(code) || "SUBMITTED".equalsIgnoreCase(status) || "PENDING".equalsIgnoreCase(status)) return "PENDING";
        if ("FAILURE".equalsIgnoreCase(status) || "FAILED".equalsIgnoreCase(status) || "FAIL".equalsIgnoreCase(status)) return "FAILED";
        return "UNKNOWN";
    }
}
