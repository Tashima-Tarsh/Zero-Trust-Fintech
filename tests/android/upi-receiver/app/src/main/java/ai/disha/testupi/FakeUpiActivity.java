package ai.disha.testupi;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;

public final class FakeUpiActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        Uri uri = getIntent().getData();
        final String pa = uri == null ? "" : uri.getQueryParameter("pa");
        final String pn = uri == null ? "" : uri.getQueryParameter("pn");
        final String am = uri == null ? "" : uri.getQueryParameter("am");
        final String cu = uri == null ? "" : uri.getQueryParameter("cu");
        final String mc = uri == null ? null : uri.getQueryParameter("mc");
        final String tr = uri == null ? null : uri.getQueryParameter("tr");
        final String tn = uri == null ? null : uri.getQueryParameter("tn");
        Log.i("DISHA_UPI_TEST", "RECEIVED pa="+pa+" pn="+pn+" am="+am+" cu="+cu+
            " mc="+mc+" tr="+tr+" tn="+tn);

        LinearLayout card = new LinearLayout(this);
        card.setBackgroundColor(Color.WHITE);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER);
        card.setPadding(32, 60, 32, 32);
        title(card, "DISHA TEST RECEIVER", 24);
        title(card, "NO MONEY MOVES", 20);
        title(card, "Payee: "+pa, 18);
        title(card, "Name: "+pn, 18);
        title(card, "Amount: "+am+" "+cu, 18);
        title(card, "MCC: "+(mc==null?"not present":mc), 16);
        Button cancel = new Button(this);
        cancel.setText("Cancel and return");
        cancel.setContentDescription("Cancel and return");
        cancel.setOnClickListener(v -> {
            Log.i("DISHA_UPI_TEST", "CANCELLED_NO_PAYMENT");
            setResult(Activity.RESULT_CANCELED, new Intent());
            finish();
        });
        card.addView(cancel);
        setContentView(card);
    }
    private void title(LinearLayout root, String content, int size) {
        TextView line = new TextView(this);
        line.setText(content);
        line.setTextSize(size);
        line.setTextColor(Color.rgb(24,42,75));
        line.setPadding(0,12,0,12);
        line.setGravity(Gravity.CENTER);
        root.addView(line);
    }
}
