package in.thenitishkr.disha.debitbridgelab;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;

/** Synthetic-only Android payment return. No payments, SMS, or account access. */
public final class SyntheticDebitHandlerActivity extends Activity {
    private static final String METHOD =
        "https://disha8-2.thenitishkr.in/labs/disha-debit-bridge-method";
    private JSONObject session;

    private void cancel() {
        setResult(Activity.RESULT_CANCELED);
        finish();
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!"org.chromium.intent.action.PAY".equals(getIntent().getAction())) {
            cancel();
            return;
        }
        try {
            // Chrome's 'data' shape is version dependent; fail closed until
            // real Chrome 145 and REA confirm this contract on the lab AVD.
            String input = getIntent().getStringExtra("data");
            if (input == null || input.length() > 4096) throw new Exception();
            JSONObject candidate = new JSONObject(input);
            String nonce = candidate.optString("nonce", "");
            String orderId = candidate.optString("orderId", "");
            String amount = candidate.optString("amountPaise", "");
            String vpa = candidate.optString("payeeVpa", "");
            if (!"DISHA-DEBIT-BRIDGE-LAB-V1".equals(candidate.optString("protocol"))
                || !nonce.matches("[a-fA-F0-9]{32,64}")
                || !orderId.matches("[A-Za-z0-9_-]{6,150}")
                || !amount.matches("[1-9][0-9]{0,8}")
                || !vpa.matches("(?i)[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}"))
                throw new Exception();
            session = candidate;
        } catch (Exception ignored) {
            cancel();
            return;
        }
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 32, 32, 32);
        TextView title = new TextView(this);
        title.setText("DISHA SYNTHETIC DEBIT LAB\nNo money moves. No bank transaction is verified.");
        layout.addView(title);
        Button submit = new Button(this);
        submit.setText("Return synthetic event");
        submit.setOnClickListener((View v) -> returnSynthetic());
        layout.addView(submit);
        Button deny = new Button(this);
        deny.setText("Cancel");
        deny.setOnClickListener((View v) -> cancel());
        layout.addView(deny);
        setContentView(layout);
    }

    private void returnSynthetic() {
        try {
            JSONObject evidence = new JSONObject();
            evidence.put("protocol", "DISHA-DEBIT-BRIDGE-LAB-V1");
            evidence.put("kind", "SYNTHETIC_DEBIT_EVENT");
            evidence.put("orderId", session.getString("orderId"));
            evidence.put("amountPaise", session.getString("amountPaise"));
            evidence.put("payeeVpa", session.getString("payeeVpa"));
            evidence.put("nonce", session.getString("nonce"));
            evidence.put("observedAt", System.currentTimeMillis());
            Intent result = new Intent();
            result.putExtra("methodName", METHOD);
            result.putExtra("details", evidence.toString());
            // Chromium version mapping is an explicit emulator test gate.
            result.putExtra("instrumentDetails", evidence.toString());
            setResult(Activity.RESULT_OK, result);
            finish();
        } catch (Exception ignored) {
            cancel();
        }
    }
}
