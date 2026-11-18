# DISHA 8.2 — merchant onboarding and live test

## Where a merchant starts
1. Open `https://disha8-2.thenitishkr.in/signup`.
2. Create an account with Clerk. The account belongs to the signed-in Clerk user, not a merchant ID supplied by the browser.
3. Open `/dashboard`. A new account shows **Complete Merchant Account Setup**. Enter the business name and the bank UPI ID receiving payments.
4. Choose **Personal / P2P** for a personal receiving UPI or **Bank-issued Merchant / P2M** when your bank issued a merchant handle and its actual 4-digit merchant category code (MCC). The system validates formatting and uses the correct UPI intent fields. It does **not independently verify that the user controls the bank account**.
5. Save the workspace. Navigate to **UPI Accounts** to add another receiving handle, pause/resume non-primary accounts and change the primary active handle.
6. Under **Create Payment**, enter the amount, reference and description. The PostgreSQL transaction creates a real `sessions` entry and a tenant-owned `saas_merchant_orders` entry; it does **not create a completed payment**.
7. Use **Copy payment link** to share the generated `/merchant-checkout.html?orderId=...&token=...` link with the customer. The link is scoped to the unguessable session token, and displays the business name, amount, payee UPI, QR, mobile app intent and recorded status. It expires after 180 seconds.
8. View **Transactions**, **Overview**, **Reports** and **Notifications**. Transactions are read from PostgreSQL and scoped to the Clerk identity. Exports are CSV and not populated with demo entries.

## First merchant acceptance test
- Sign up as a new merchant. Confirm there are **zero** sample payments, turnover and settlements.
- Complete the business setup with an actual receiving UPI ID owned by the merchant. Avoid entering a dummy VPA.
- Create an inexpensive payment request (e.g., ₹1) and confirm the exact amount and payee on the checkout link, QR and UPI application.
- Check the recorded order starts **PENDING**, and that the same order appears in the merchant transaction list and its CSV export.
- Test payment settlement status only with an actual authenticated financial transaction and the supported verification path. The merchant UI does not manufacture a successful payment on an app return or a user click.
- Sign in as a **second** merchant and confirm the first merchant's payments, receiving UPIs, reports and IP directory are not visible.
- Check mobile navigation, filters, CSV, primary-VPA switching, logout and browser refresh.

## Auth and production architecture
- Cloudflare Pages serves static CSS and JS while proxying `/login`, `/signup`, `/dashboard`, `/auth-config.js` and all `/api/*` requests to Railway.
- Clerk manages sign-in and signup. Sensitive merchant APIs verify Clerk identity server-side using `getAuth(req)`; frontend bearer token is sent with `X-CSRF-Token` on state-changing calls. A caller cannot choose their own merchant ID.
- Railway runs Express + PostgreSQL, with production database authority `DB_BACKEND=postgres`. `merchant-api.js` adds `saas_*` tables without dropping or rewriting existing sessions, UTRs, ledger or VPA pool.
- The default payment cap is ₹1 lakh, overrideable by `MERCHANT_PAYMENT_MAX_RUPEES` where appropriate; the existing UPI intent builder also enforces this.
- No preview mode, simulated transactions or fake balances exist in the merchant console. The simulation API is unavailable in `NODE_ENV=production`.
- The per-merchant IP directory currently stores permitted integration addresses but **does not enforce** those addresses on public payment APIs. Do not market this as an active allowlist enforcement without adding a secured merchant-specific integration boundary.

## Validation boundaries
GitHub CI uses a disposable PostgreSQL server and explicitly synthetic Clerk subjects for **tests only**. It verifies merchant onboarding, tenant isolation, VPA setup, payment request creation, payment link and UPI URI, read-only customer status, transaction reports, notifications, security filters and data state transitions. It does not create a real bank payment or validate a real Clerk signup in the user's browser. A merchant-run acceptance test is required before claiming actual live-payment end-to-end success.

## Non-negotiables
Do not delete old PostgreSQL tables, the preserved SQLite migration archive, Redis or Railway variables to clean the UI. Do not seed merchant demo records. Do not accept arbitrary merchant IDs from requests.
