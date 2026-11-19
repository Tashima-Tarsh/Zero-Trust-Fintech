package in.disha.evidence;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Settings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Pairing requires user action, device passkey in browser, and explicit listener permission. */
public final class MainActivity extends Activity {
 private final ExecutorService executor=Executors.newSingleThreadExecutor();
 private final Handler main=new Handler(Looper.getMainLooper());
 private TextView status;
 @Override public void onCreate(Bundle b){super.onCreate(b);ui();onPairIntent(getIntent());}
 @Override protected void onNewIntent(Intent i){super.onNewIntent(i);setIntent(i);onPairIntent(i);}
 private void ui(){
  LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
  root.setPadding(30,36,30,24);
  TextView title=new TextView(this);title.setText("DISHA · Debit evidence");title.setTextSize(23);root.addView(title);
  TextView intro=new TextView(this);
  intro.setText("\nOptional payer-side evidence. Notification access is a broad Android permission that only you can enable. " +
    "While a payment is paired, DISHA examines allowlisted payment-app notifications and sends extracted " +
    "amount, reference, receiver, time and source—not the raw message, OTP or PIN.\n");
  intro.setTextSize(14);root.addView(intro);
  status=new TextView(this);status.setTextSize(15);
  status.setText(EvidenceClient.active(this)?"Paired for an active checkout.":"Not paired. Open DISHA checkout to authorize Vault first.");
  root.addView(status);
  Button grant=new Button(this);grant.setText("Enable notification access in Android Settings");
  grant.setOnClickListener(v->startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
  root.addView(grant);
  Button back=new Button(this);back.setText("Back to DISHA checkout");
  back.setOnClickListener(v->startActivity(new Intent(Intent.ACTION_VIEW,
    android.net.Uri.parse(EvidenceClient.SERVER+"/choose-payment"))));
  root.addView(back);
  Button cancel=new Button(this);cancel.setText("Stop collecting / unpair");
  cancel.setOnClickListener(v->{EvidenceClient.unpair(this);status.setText("Unpaired. Evidence collection stopped.");});
  root.addView(cancel);setContentView(root);
 }
 private void onPairIntent(Intent intent){
  if(intent==null||intent.getData()==null)return;
  android.net.Uri u=intent.getData();
  if(!"disha-evidence".equals(u.getScheme())||!"pair".equals(u.getHost()))return;
  String pairId=u.getQueryParameter("pairId"),code=u.getQueryParameter("code");
  if(pairId==null||code==null||!pairId.matches("pd_[a-f0-9]{24}")||!code.matches("[a-f0-9]{64}")){
   status.setText("Invalid pairing link. Request a fresh link from checkout.");return;
  }
  status.setText("Pairing with DISHA Vault…");
  executor.execute(()->{
   try{
    JSONObject request=new JSONObject().put("pairId",pairId).put("code",code)
      .put("publicKey",EvidenceClient.b64(EvidenceClient.signer().getPublic().getEncoded()));
    JSONObject response=EvidenceClient.post("/api/payer-debit/activate",request);
    SharedPreferences.Editor editor=EvidenceClient.prefs(this).edit();
    editor.putString("pairId",pairId)
      .putString("expectedAmount",response.getString("expectedAmount"))
      .putString("expectedPayee",response.getString("expectedPayee"))
      .putString("allowedPackages",response.getJSONArray("allowedPackages").toString())
      .putLong("expiresAt",response.getLong("expiresAt")).apply();
    main.post(()->status.setText("Vault pairing active.\nExpected amount: ₹"+
      response.optString("expectedAmount")+"\nReceiving UPI ID: "+response.optString("expectedPayee")+
      "\nEnable notification access, then return to your original checkout to pay."));
   }catch(Exception ex){main.post(()->status.setText("Pairing error: "+ex.getMessage()));}
  });
 }
 @Override protected void onDestroy(){super.onDestroy();executor.shutdown();}
}
