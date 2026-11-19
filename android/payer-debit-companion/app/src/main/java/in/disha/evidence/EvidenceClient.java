package in.disha.evidence;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;

/** First-party HTTPS; never transmits raw notifications, OTP, PIN or SMS. */
final class EvidenceClient {
 static final String SERVER="https://disha8-2.thenitishkr.in";
 private static final String KEY_ALIAS="disha_payer_debit_signer_v1";
 static SharedPreferences prefs(Context c){return c.getSharedPreferences("disha_payer_debit",Context.MODE_PRIVATE);}
 static void unpair(Context c){prefs(c).edit().clear().apply();}
 static boolean active(Context c){SharedPreferences p=prefs(c);return p.contains("pairId")&&
   System.currentTimeMillis()<p.getLong("expiresAt",0);}
 static boolean allowed(Context c,String pkg){
  try{JSONArray a=new JSONArray(prefs(c).getString("allowedPackages","[]"));
   for(int i=0;i<a.length();i++)if(pkg.equals(a.optString(i)))return true;
  }catch(Exception ignored){}
  return false;
 }
 static JSONObject post(String endpoint,JSONObject payload)throws Exception{
  HttpsURLConnection c=(HttpsURLConnection)new URL(SERVER+endpoint).openConnection();
  c.setRequestMethod("POST");c.setConnectTimeout(8000);c.setReadTimeout(8000);
  c.setInstanceFollowRedirects(false);c.setDoOutput(true);
  c.setRequestProperty("Content-Type","application/json; charset=utf-8");
  try{
   try(OutputStream out=c.getOutputStream()){out.write(payload.toString().getBytes(StandardCharsets.UTF_8));}
   int status=c.getResponseCode();
   InputStream input=status>=200&&status<300?c.getInputStream():c.getErrorStream();
   if(input==null)throw new IOException("HTTP "+status);
   ByteArrayOutputStream buffer=new ByteArrayOutputStream();
   try(InputStream in=input){byte[] b=new byte[1024];int n;while((n=in.read(b))!=-1)buffer.write(b,0,n);}
   JSONObject result=new JSONObject(buffer.toString("UTF-8"));
   if(status<200||status>=300)throw new IOException(result.optString("error","HTTP "+status));
   return result;
  }finally{c.disconnect();}
 }
 static KeyPair signer()throws Exception{
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(!store.containsAlias(KEY_ALIAS)){
   KeyPairGenerator g=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
   g.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_SIGN)
     .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
     .setDigests(KeyProperties.DIGEST_SHA256).build());
   return g.generateKeyPair();
  }
  return new KeyPair(store.getCertificate(KEY_ALIAS).getPublicKey(),
                     (PrivateKey)store.getKey(KEY_ALIAS,null));
 }
 static String b64(byte[] bytes){return Base64.encodeToString(bytes,Base64.NO_WRAP);}
 static String canonical(JSONObject ev){
  String[] keys={"pairId","eventId","sourcePackage","postedAt","amount","utrCandidate","payeeCandidate","signal"};
  StringBuilder b=new StringBuilder();
  for(int i=0;i<keys.length;i++){if(i>0)b.append('|');b.append(ev.optString(keys[i],""));}
  return b.toString();
 }
 static String signature(JSONObject ev)throws Exception{
  Signature s=Signature.getInstance("SHA256withECDSA");s.initSign(signer().getPrivate());
  s.update(canonical(ev).getBytes(StandardCharsets.UTF_8));return b64(s.sign());
 }
}
