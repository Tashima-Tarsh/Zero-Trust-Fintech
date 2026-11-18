# DISHA Fraud Intelligence — Trust the relationship, not the screenshot

DISHA 8.2 approaches fraud resistance by analyzing the **connection between an order and the evidence surrounding it**. Instead of awarding a successful outcome because an image looks genuine, the product asks a sequence of precise questions about recipient, amount, order identity, timing, duplicate references and the source of financial evidence.

## A layered decision architecture

~~~mermaid
flowchart TD
 A["ORIGINAL PAYMENT ORDER<br/>Payee · Amount · Reference · Expiry"]:::blue
 B["VAULT OBSERVATIONS<br/>Authorized handoff · Return · Candidate reference"]:::purple
 A --> C["IDENTITY CHECK<br/>Right payee and order?"]:::amber
 B --> C
 C --> D["VALUE CHECK<br/>Exact amount down to the paise?"]:::amber
 D --> E["TEMPORAL CHECK<br/>Within intended order window?"]:::amber
 E --> F["REPLAY CHECK<br/>Reference or event already seen?"]:::amber
 F --> G{"Evidence consistent?"}:::amber
 G -->|"No"| X["FLAG FOR REVIEW<br/>Conflicting or late observation"]:::rose
 G -->|"Yes"| H["CORRELATED OBSERVATION<br/>Useful, but not bank-credit proof"]:::purple
 H --> I["SEPARATE QUALIFIED CREDIT MATCH"]:::green
 I --> J{"Merchant · Recipient · Amount · Reference match?"}:::amber
 J -->|"No"| Q["QUARANTINE FINANCIAL EXCEPTION"]:::rose
 J -->|"Yes"| K["BALANCED LEDGER & CONFIRMED RECEIPT"]:::green
 classDef blue fill:#103453,stroke:#38BDF8,stroke-width:2px,color:#FFF;
 classDef purple fill:#30204F,stroke:#C084FC,stroke-width:2px,color:#FFF;
 classDef amber fill:#472D18,stroke:#FBBF24,stroke-width:2px,color:#FFF;
 classDef green fill:#103C31,stroke:#34D399,stroke-width:2px,color:#FFF;
 classDef rose fill:#4A1F31,stroke:#FB7185,stroke-width:2px,color:#FFF;
~~~

## What DISHA checks

| Protection | Question answered | Why it matters |
| --- | --- | --- |
| **Recipient consistency** | Is the UPI address the account selected for this order? | Helps identify misdirected or incorrectly attributed payment claims |
| **Exact-value matching** | Does the amount match the order, including paise? | Separates correct orders from altered or short payments |
| **Pony-tail temporal analysis** | Was the observation early, within the expected window or late? | Gives suspicious timing a defined business context |
| **Reference collision** | Has a claimed twelve-digit reference appeared on another order? | Surfaces replay and conflict patterns |
| **Device-context analysis** | What authorized handoff and browser return were recorded? | Adds context beyond a customer-supplied screenshot |
| **Financial source integrity** | Does a qualified credit belong to the same account and original order? | Supports legitimate accounting completion |
| **Idempotent accounting** | Has the same credit already been posted? | Prevents counting a matched credit twice |
| **Quarantine** | Do material financial fields disagree? | Keeps unresolved financial events out of completed records |

## Pony-tail — the time-window concept

The current checkout request lasts **180 seconds**. Its evidence policy distinguishes an initial observation period from the main observation window and events that arrive after the defined session period.

~~~mermaid
flowchart LR
 A["0–15 seconds<br/>Early observation"]:::blue --> B["15–180 seconds<br/>Expected observation window"]:::amber --> C["After expiry<br/>Late observation"]:::rose
 classDef blue fill:#103453,stroke:#38BDF8,color:#FFF,stroke-width:2px;
 classDef amber fill:#472D18,stroke:#FBBF24,color:#FFF,stroke-width:2px;
 classDef rose fill:#4A1F31,stroke:#FB7185,color:#FFF,stroke-width:2px;
~~~

**Timing is a risk signal, not a payment-success probability.** An event arriving inside the window is not proof of funds; a late return does not by itself prove that no transfer occurred.

## Four common fraud and error scenarios

### Copied success receipt

A screenshot or receipt text may look authentic, but its customer-origin content is not inherently an account-credit record. DISHA keeps it at the evidence level.

### UTR shared across orders

A candidate reference linked to two different orders is a conflict. DISHA records that conflict for review rather than letting the first customer claim determine who paid.

### Correct-looking amount, wrong recipient

The original payee is preserved with the order. A discrepancy between that recipient and the available evidence is visible for investigation.

### A financial event that cannot be matched

Even a signed credit event must agree with the merchant, receiving address, exact amount, original order and permitted matching context. Conflicting financial events belong in an exception path.

## Fraud protection is also an operations decision

Good controls give merchants the information needed to decide what to investigate, not a fictional promise that all risk vanishes. DISHA presents uncertainty explicitly: **observed, unverified, conflicting, late, qualified or completed**.

[Vault architecture](Vault-Architecture.md) · [Complete platform architecture](Platform-Architecture.md) · [Home](Home.md)
