package ai.disha.dndep;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/** Proposed AOSP collector's pure-Java policy core. No SMS/notification access in this module. */
public final class DebitObservationCore {
  public record Challenge(String origin,String orderId,String nonce,String amountPaise,
    String payeeVpa,long issuedAtMs,long expiresAtMs) {}
  public record Consent(long grantedAtMs,boolean systemAuthenticated,String origin,
    String orderId,boolean explicitlyGranted) {}
  public record Source(String kind,String identity,String certificateSha256,int uid,
    boolean obtainedByPlatform) {}
  public record Event(String id,String direction,String amountPaise,String payeeVpa,
    String reference,long observedAtMs,Source source) {}
  public record Result(boolean accepted,String code,Event event) {}
  public static final class Window {
    final Challenge c; final Consent consent; final AtomicBoolean revoked=new AtomicBoolean();
    final Set<String> events=ConcurrentHashMap.newKeySet();
    /** Caller MUST verify authentic server challenge signature before constructing. */
    public Window(Challenge c,Consent consent,boolean serverSignatureVerified){
      if(c==null||consent==null||!serverSignatureVerified)throw new SecurityException("CHALLENGE_UNTRUSTED");
      if(!"https://disha8-2.thenitishkr.in".equals(c.origin())||
         c.orderId()==null||c.orderId().isBlank()||
         c.nonce()==null||!c.nonce().matches("[a-f0-9]{64}")||
         c.amountPaise()==null||!c.amountPaise().matches("[1-9][0-9]{0,12}")||
         c.payeeVpa()==null||!c.payeeVpa().matches("[a-z0-9._-]+@[a-z0-9._-]+")||
         c.issuedAtMs()<=0||c.expiresAtMs()-c.issuedAtMs()!=180000)
        throw new SecurityException("CHALLENGE_INVALID");
      if(!consent.systemAuthenticated()||!consent.explicitlyGranted()||
         !c.origin().equals(consent.origin())||!c.orderId().equals(consent.orderId())||
         consent.grantedAtMs()<c.issuedAtMs()||consent.grantedAtMs()>=c.expiresAtMs())
        throw new SecurityException("CONSENT_REQUIRED");
      this.c=c;this.consent=consent;
    }
    public void revoke(){revoked.set(true);}
    /** Source metadata must be supplied by an authenticated platform adapter, not JavaScript. */
    public Result observe(Event e,long now){
      if(revoked.get())return new Result(false,"REVOKED",null);
      if(now<c.issuedAtMs()||now>=c.expiresAtMs())return new Result(false,"EXPIRED",null);
      if(e==null||e.source()==null||!e.source().obtainedByPlatform()||
         e.source().uid()<0||e.source().identity()==null||e.source().identity().isBlank())
        return new Result(false,"SOURCE_UNTRUSTED",null);
      if(!"sms".equals(e.source().kind())&&!"notification".equals(e.source().kind()))
        return new Result(false,"SOURCE_KIND",null);
      if("notification".equals(e.source().kind())&&
         (e.source().certificateSha256()==null||!e.source().certificateSha256().matches("[a-f0-9]{64}")))
        return new Result(false,"SOURCE_CERT",null);
      if(e.observedAtMs()<consent.grantedAtMs()||e.observedAtMs()>now||
         e.observedAtMs()>=c.expiresAtMs())return new Result(false,"EVENT_TIME",null);
      if(!"DEBIT".equals(e.direction())||!c.amountPaise().equals(e.amountPaise())||
         !c.payeeVpa().equals(e.payeeVpa())||e.reference()==null||
         !e.reference().matches("[A-Za-z0-9._:/-]{6,100}")||
         e.id()==null||!e.id().matches("[A-Za-z0-9_-]{12,120}"))
        return new Result(false,"NO_EXACT_DEBIT_MATCH",null);
      if(!events.add(e.id()))return new Result(false,"REPLAY",null);
      return new Result(true,"DEBIT_EVIDENCE_OBSERVED",e);
    }
  }
}