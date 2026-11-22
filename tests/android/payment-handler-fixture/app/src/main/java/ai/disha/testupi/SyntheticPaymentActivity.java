package ai.disha.testupi;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import org.json.JSONObject;

/** No payment SDK or network call. Activated only by the lab debug manifest. */
public final class SyntheticPaymentActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        Intent request = getIntent();
        String id = request.getStringExtra("paymentRequestId");
        ArrayList<String> methods = request.getStringArrayListExtra("methodNames");
        String method;
        try {
            method = getPackageManager().getActivityInfo(getComponentName(), PackageManager.GET_META_DATA)
                    .metaData.getString("org.chromium.default_payment_method_name");
        } catch (PackageManager.NameNotFoundException e) {
            finish();
            return;
        }
        if (!"org.chromium.intent.action.PAY".equals(request.getAction()) ||
                id == null || !id.matches("[A-Za-z0-9-]{16,64}") ||
                method == null || methods == null || methods.size() != 1 || !methods.contains(method)) {
            finish();
            return;
        }
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        TextView label = new TextView(this);
        label.setText("Synthetic DISHA transport test. No money moves.");
        panel.addView(label);
        Button success = new Button(this);
        success.setText("Return synthetic response");
        success.setOnClickListener(v -> {
            String details = "{\"requestId\":" + JSONObject.quote(id) +
                    ",\"synthetic\":true,\"outcome\":\"TRANSPORT_OK\"}";
            setResult(RESULT_OK, new Intent().putExtra("methodName", method).putExtra("details", details));
            finish();
        });
        panel.addView(success);
        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setOnClickListener(v -> finish());
        panel.addView(cancel);
        setContentView(panel);
    }
}
