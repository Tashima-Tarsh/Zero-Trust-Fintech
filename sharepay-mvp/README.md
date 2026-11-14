# ⚡ SharePay

> **Pay with your favorite UPI app. Confirm in one tap. Zero gateway fees. Zero fake receipts.**

SharePay is a seamless, peer-to-peer UPI checkout experience designed for creators, local merchants, and modern online stores. 

It lets customers pay directly into the seller's bank account using Google Pay, PhonePe, Paytm, or BHIM—and verifies the payment in under one second simply by tapping **"Share Receipt"** on Android.

---

## 💡 The Problem SharePay Solves

Accepting payments online today usually leaves sellers with two painful choices:

1. **Traditional Payment Gateways** charge a 2% to 3% cut on every single transaction, hold your funds for days, and require complicated merchant registrations.
2. **Direct UPI QR Codes** save money, but verifying them is a nightmare. Sellers have to manually ask for screenshots, check bank SMS alerts, and constantly battle fraud—including fake payment apps, screenshot spoofing, and scammers recycling old receipts.

**SharePay fixes both.** Sellers keep 100% of their revenue with instant bank settlement, and buyers get a smooth, trustworthy checkout without typing card numbers or installing special apps.

---

## ✨ How It Works (The 3-Step Experience)

Shopping with SharePay feels natural, fast, and completely effortless:

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  1. Tap to Pay  │ ───►  │  2. Enter PIN   │ ───►  │ 3. One-Tap Share│
│  on the Website │       │ in your UPI App │       │  Auto-Confirmed │
└─────────────────┘       └─────────────────┘       └─────────────────┘
```

1. **Click "Pay with UPI"**: On checkout, the customer sees their total with an instant checkout discount and taps to pay.
2. **Pay in Any UPI App**: The customer's preferred UPI app (GPay, PhonePe, Paytm, BHIM, CRED) opens automatically with the exact payment details filled in.
3. **One-Tap Verification**: After entering their UPI PIN, the customer taps **"Share Receipt"** on the payment success screen and picks **SharePay**.
4. **Instantly Verified**: The checkout page confirms the order in real time. Done!

---

## 🌟 The Hallmark Features

### 🚀 0% Gateway Commissions, 100% Direct Settlement
Money moves directly from the customer’s bank account to the seller’s bank account over NPCI’s official UPI rail. No middleman holds your money, and no transaction fees eat into your margins.

### 🪄 The Native Share Sheet Magic
No need to ask customers to upload blurry screenshots, read SMS codes, or grant intrusive device permissions. SharePay turns Android’s built-in OS Share menu into a secure, instant payment verification pipeline.

### 🛡️ Immune to Fake Screenshots & Recycled Receipts
SharePay eliminates receipt fraud through a multi-layered verification design:
* **Unique Challenge Matching**: Every order features a micro-adjusted dynamic amount (like ₹99.43 instead of a flat ₹100.00). An attacker cannot pay a round number or recycle an old receipt.
* **Timestamp & Freshness Verification**: Receipts must be born in the current transaction window. A receipt from yesterday, last week, or even earlier today is automatically recognized and rejected.
* **Single-Use Guarantee**: Each 12-digit transaction reference (UTR) can only ever be used once. Attempting to claim the same payment twice is blocked immediately.
* **3-Minute Session Window**: Payments are bound to live checkout sessions. Delayed sharing or stale attempts automatically expire.

### 📱 Zero Apps to Download
SharePay is a Progressive Web App (PWA). Customers don't need to download anything from the Play Store or register an account. It runs instantly in the mobile browser.

### ⚡ Real-Time Checkout Sync
Whether the customer is checking out on their laptop or mobile phone, the screen updates the split-second the receipt is shared.

---

## 👤 Who is SharePay for?

* **Digital Creators & Indie Hackers**: Sell ebooks, courses, SaaS tools, and templates without giving 2–3% to payment aggregators.
* **Direct-to-Consumer (D2C) Brands**: Streamline COD-to-prepaid conversion with instant UPI discounts.
* **Community Leaders & Event Organizers**: Collect ticket fees and membership dues directly to your UPI ID with automated verification.
* **Local Businesses & Services**: Offer a contactless, modern checkout experience on invoices and storefronts.

---

## 🛠️ Developer Quickstart

For developers setting up a local demo or running tests:

```bash
# 1. Clone repository & navigate to sharepay-mvp
cd sharepay-mvp

# 2. Run the automated fraud attack matrix test suite
npm test

# 3. Start local development server
npm install
npm run dev
```

* Checkout page runs on: `http://localhost:3000`
* Test suite verifies 8 fraud vectors including duplicate replay, old Julian day mismatch, hourly expiration, and amount tampering.
