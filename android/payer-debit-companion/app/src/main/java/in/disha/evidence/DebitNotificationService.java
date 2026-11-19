package in.disha.evidence;

import android.app.Notification;
import android.content.SharedPreferences;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;
import java.util.UUID;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Never reads SMS APIs or logs/transmits raw notification text. */
public final class DebitNotificationService extends NotificationListenerService {
 private final ExecutorService executor=Executors.newSingleThreadExecutor();
 private static final Pattern DEBIT=Pattern.compile("(?i)\\b(debit(?:ed)?|spent|paid|sent|transferred)\\b");
 private static final Pattern UNSAFE=Pattern.compile("(?i)\\b(credited|reversed|refunded|refund|otp|password|collect request)\\b");
 private static final Pattern AMOUNT=Pattern.compile("(?i)(?:₹|\\bRs\\.?|\\bINR\\b)\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)");
 private static final Pattern UTR=Pattern.compile("(?i)\\b(?:upi\\s*(?:ref(?:erence)?|transaction)|utr|rrn|txn\\s*(?:id|ref)|ref(?:erence)?\\s*(?:no|id))\\s*[:#-]?\\s*(\\d{12})\\b");
 private static final Pattern VPA=Pattern.compile("(?i)\\b[a-z0-9._-]{2,100}@[a-z][a-z0-9]{1,39}\\b");
 @Override public void onNotificationPosted(StatusBarNotification sbn){
  if(sbn==null||!EvidenceClient.active(this)||!EvidenceClient.allowed(this,sbn.getPackageName()))return;
  final SharedPreferences p=EvidenceClient.prefs(this);
  final long postedAt=sbn.getPostTime();
  if(postedAt<=0||postedAt>p.getLong("expiresAt",0))return;
  Notification n=sbn.getNotification();if(n==null||n.extras==null)return;
  String text=String.valueOf(n.extras.getCharSequence(Notification.EXTRA_TITLE,""))+" "+
     String.valueOf(n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT,
                          n.extras.getCharSequence(Notification.EXTRA_TEXT,"")));
  if(text.length()>1024)text=text.substring(0,1024);
  if(!DEBIT.matcher(text).find()||UNSAFE.matcher(text).find())return;
  Matcher a=AMOUNT.matcher(text);if(!a.find())return;
  final String amount=a.group(1).replace(",","");
  if(!amount.equals(p.getString("expectedAmount","")))return;
  Matcher utrMatcher=UTR.matcher(text),payeeMatcher=VPA.matcher(text);
  final String utr=utrMatcher.find()?utrMatcher.group(1):"";
  final String payee=payeeMatcher.find()?payeeMatcher.group().toLowerCase(Locale.ROOT):"";
  if(!payee.isEmpty()&&!payee.equalsIgnoreCase(p.getString("expectedPayee","")))return;
  String seen=p.getString("pairId","")+":"+sbn.getKey()+":"+postedAt;
  if(seen.equals(p.getString("lastSeen","")))return;
  p.edit().putString("lastSeen",seen).apply();
  final String pairId=p.getString("pairId",""),source=sbn.getPackageName();
  executor.execute(()->{
   try{
    JSONObject evidence=new JSONObject()
     .put("pairId",pairId)
     .put("eventId","pd_event_"+UUID.randomUUID().toString().replace("-",""))
     .put("sourcePackage",source).put("postedAt",postedAt).put("amount",amount)
     .put("utrCandidate",utr).put("payeeCandidate",payee).put("signal","DEBIT");
    EvidenceClient.post("/api/payer-debit/report",
      new JSONObject().put("evidence",evidence).put("signature",EvidenceClient.signature(evidence)));
   }catch(Exception ignored){/* fail closed: the checkout remains awaiting evidence */ }
  });
 }
 @Override public void onDestroy(){super.onDestroy();executor.shutdown();}
}
