package ai.disha.dndep;
import ai.disha.dndep.DebitObservationCore.*;
/** Synthetic fixtures, never a genuine Android debit acquisition test. */
public final class DebitObservationCoreTest {
 static final long T=1763758800000L; static int n;
 static Challenge c(){return new Challenge("https://disha8-2.thenitishkr.in","order123456",
   "a".repeat(64),"50000","recipient@upi",T,T+180000);}
 static Consent consent(){return new Consent(T+500,true,c().origin(),c().orderId(),true);}
 static Window w(){return new Window(c(),consent(),true);}
 static Event e(){return new Event("event123456789","DEBIT","50000","recipient@upi",
   "123456789012",T+1000,new Source("notification","com.phonepe.app","a".repeat(64),2001,true));}
 static void eq(Object a,Object b){if(!b.equals(a))throw new AssertionError(b+" != "+a);n++;}
 static void throwsSecurity(Runnable r){try{r.run();throw new AssertionError("Expected rejection");}
   catch(SecurityException expected){n++;}}
 public static void main(String[] args){
   eq(w().observe(e(),T+1100).code(),"DEBIT_EVIDENCE_OBSERVED");
   throwsSecurity(()->new Window(c(),consent(),false));
   throwsSecurity(()->new Window(c(),new Consent(T+500,false,c().origin(),c().orderId(),true),true));
   throwsSecurity(()->new Window(c(),new Consent(T+500,true,"https://evil.example",c().orderId(),true),true));
   throwsSecurity(()->new Window(c(),new Consent(T+500,true,c().origin(),c().orderId(),false),true));
   Window revoked=w();revoked.revoke();eq(revoked.observe(e(),T+1100).code(),"REVOKED");
   eq(w().observe(e(),T+180000).code(),"EXPIRED");
   Event e=e();
   eq(w().observe(new Event(e.id(),e.direction(),"50001",e.payeeVpa(),e.reference(),e.observedAtMs(),e.source()),T+1100).code(),"NO_EXACT_DEBIT_MATCH");
   eq(w().observe(new Event(e.id(),e.direction(),e.amountPaise(),"thief@upi",e.reference(),e.observedAtMs(),e.source()),T+1100).code(),"NO_EXACT_DEBIT_MATCH");
   eq(w().observe(new Event(e.id(),e.direction(),e.amountPaise(),e.payeeVpa(),e.reference(),T+400,e.source()),T+1100).code(),"EVENT_TIME");
   eq(w().observe(new Event(e.id(),e.direction(),e.amountPaise(),e.payeeVpa(),e.reference(),T+1200,e.source()),T+1100).code(),"EVENT_TIME");
   eq(w().observe(new Event(e.id(),e.direction(),e.amountPaise(),e.payeeVpa(),e.reference(),e.observedAtMs(),new Source("notification","com.phonepe.app","a".repeat(64),2001,false)),T+1100).code(),"SOURCE_UNTRUSTED");
   eq(w().observe(new Event(e.id(),e.direction(),e.amountPaise(),e.payeeVpa(),e.reference(),e.observedAtMs(),new Source("notification","com.phonepe.app",null,2001,true)),T+1100).code(),"SOURCE_CERT");
   Window single=w();eq(single.observe(e(),T+1100).accepted(),true);eq(single.observe(e(),T+1100).code(),"REPLAY");
   System.out.println("D-NDEP portable Android collector core: "+n+" synthetic checks PASS");
 }
}