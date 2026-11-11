# 🏏 JPL 2026 — Cricket Tournament Registration System

Player registration with **Razorpay** payments, **private Aadhaar document uploads**, and a
**password-protected admin portal**. Built with Next.js 14 (App Router), MongoDB (Mongoose),
Cloudinary and Tailwind CSS.

---

## 🚀 Quick start (local development)

```bash
npm install
cp .env.example .env.local      # then fill in the values (see below)
npm run hash-password           # generates ADMIN_PASSWORD_HASH + ADMIN_SESSION_SECRET
npm run dev                     # http://localhost:3000   (admin: /admin)
```

> ⚠️ Use **Razorpay Test Mode** keys (`rzp_test_…`) and a **non-production database** for development.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB Atlas connection string |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | ✅ | Player photos + private Aadhaar documents |
| `RAZORPAY_KEY_ID` | ✅ | Public key — the **only** Razorpay value sent to the browser |
| `RAZORPAY_KEY_SECRET` | ✅ | Server only. Used for orders, payment lookups and checkout-signature verification |
| `RAZORPAY_WEBHOOK_SECRET` | ✅ | Server only. The secret you type when creating the webhook in Razorpay |
| `REGISTRATION_FEE` | – | Whole rupees, default `1500`. The charged amount is **always** computed on the server from this value |
| `ADMIN_USERNAME` | ✅ | Admin login name |
| `ADMIN_PASSWORD_HASH` | ✅ | bcrypt hash from `npm run hash-password` |
| `ADMIN_SESSION_SECRET` | ✅ | ≥ 32 random characters (printed by `npm run hash-password`) |
| `APP_BASE_URL` | – | Public site URL (for your reference when configuring the webhook) |

Environment problems are reported at server start (`instrumentation.js`). Each feature also
**fails closed**: without Razorpay keys no order can be created; without admin variables the
portal stays locked.

### Admin password hash

```bash
npm run hash-password
```

It prompts for the password (min 12 characters, hidden input) and prints two forms:

* **`.env` / `.env.local` files** — every `$` is escaped as `\$`
  (`ADMIN_PASSWORD_HASH=\$2b\$12\$...`). This is required: Next.js expands `$NAME`
  inside `.env` files *even inside quotes*, which would silently corrupt the hash.
* **Vercel / hosting dashboard** — paste the raw hash with no backslashes.

To change the password, generate a new hash, update the variable and redeploy. To force-logout
all admins, also change `ADMIN_SESSION_SECRET` (or delete the `adminsessions` collection).

---

## 💳 Payment workflow (Razorpay)

```
Form + photo ─┐
Aadhaar front ┼─ uploaded independently (POST /api/registration/aadhaar-upload) → opaque uploadId
Aadhaar back ─┘
      │
Review modal → POST /api/payment/create-order   (validates everything, uploads photo,
      │                                          creates Razorpay order for the SERVER fee,
      │                                          stores a RegistrationOrder)
Razorpay Checkout (UPI / card / netbanking / wallet)
      │
POST /api/payment/verify ──────┐     POST /api/payment/webhook (payment.captured / order.paid)
      │  HMAC signature check   │           │  HMAC of raw body
      ▼                         ▼           ▼
            finalizeRegistrationOrder()  — idempotent, shared by all paths
            • re-fetches the payment from Razorpay's API (status, order_id, amount, currency)
            • captures "authorized" payments
            • atomic "paid" transition + lease lock + unique indexes
            • creates the Player with the EXISTING defaults (status "pending", pool 0,
              category "Undefined", playerID from the existing counter hook)
```

* A frontend success callback is never treated as proof of payment.
* Repeated verifications, duplicate/replayed webhooks and webhook-vs-checkout races all return
  the same single registration (unique partial indexes on `payment.razorpayOrderId` and
  `payment.razorpayPaymentId` are the final guard).
* If the browser closes after paying, the webhook (or the status poll on return) completes the
  registration.
* Failed / cancelled payments keep the form data; the same order is reused on retry when
  nothing changed.
* Abandoned orders and uploads are cleaned up automatically after 24 h (after re-checking with
  Razorpay that nothing was paid).
* The old `/api/register` QR/screenshot endpoint is retired (returns `410`) so it cannot be used
  to bypass payment. Historical registrations are untouched.

### Razorpay dashboard configuration (manual)

1. **API keys** — *Account & Settings → API Keys*. Generate Test keys for development and Live
   keys for production. Put them in `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
2. **Webhook** — *Account & Settings → Webhooks → Add New Webhook*
   * URL: `https://<your-domain>/api/payment/webhook`
   * Secret: a long random string → same value in `RAZORPAY_WEBHOOK_SECRET`
   * Active events: **`payment.captured`**, **`payment.failed`**, **`order.paid`**
   * Create it separately in Test mode and Live mode (they have separate webhooks).
3. **Payment capture** — *Account & Settings → Payment Capture*: **Automatic capture** is
   recommended. (If payments are left "authorized", the server captures them during
   verification.)
4. Make sure your site domain is whitelisted / your website is approved for Live mode.

### Testing with Razorpay Test Mode

Use the test cards / UPI IDs from Razorpay's docs (e.g. UPI `success@razorpay` / `failure@razorpay`).
For webhooks on localhost, expose your dev server with a tunnel (e.g. `ngrok http 3000`) and
register the tunnel URL as a Test-mode webhook.

---

## 🪪 Aadhaar documents

* Two mandatory uploads: **front** and **back**, JPG/JPEG/PNG, **max 4 MB each** (each upload is
  its own request so it stays under Vercel's 4.5 MB body limit; the UI shows progress).
* Server validates MIME type, extension **and file signature (magic bytes)**; executables,
  PDFs and disguised files are rejected. Filenames are random UUIDs (no path traversal).
* Stored in Cloudinary as **`authenticated`** (private) assets under
  `cricket_tournament/aadhaar_private/`. No public URL is stored or returned.
* Admins view them via `GET /api/players/:id/aadhaar/front|back`, which checks the admin session,
  creates a 60-second signed download URL server-side and streams the image with
  `Cache-Control: no-store`.
* Never included in any list/detail API (`select: false` in the schema + projection stripping).
* Only Aadhaar **images** are collected — no Aadhaar number.

---

## 🔐 Admin portal

* `/admin` shows a login screen unless a valid session exists (checked server-side in
  `app/admin/layout.js`).
* Sessions: random 256-bit token in an **HttpOnly, SameSite=Strict, Secure (prod)** cookie,
  8-hour lifetime. Only an HMAC of the token is stored in MongoDB (`adminsessions`, TTL-expired).
* **Every** admin API (`/api/players*`, `/api/proxy-image`, `/api/admin/*`) re-validates the
  session; state-changing requests also require the CSRF token header (`x-csrf-token`) and a
  same-origin `Origin`.
* Login rate limiting (MongoDB-backed, works on serverless): 5 failures / 15 min per IP and
  50 failures / 15 min globally.
* Logout deletes the server-side session.

---

## 🔌 API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/registration/aadhaar-upload` | public, rate-limited | Upload one Aadhaar side → `{ uploadId }` |
| DELETE | `/api/registration/aadhaar-upload?uploadId=` | uploadId | Discard a replaced/removed upload |
| POST | `/api/payment/create-order` | public, rate-limited | Validate registration, create Razorpay order |
| POST | `/api/payment/verify` | client token | Verify checkout signature + payment, finalize registration |
| POST | `/api/payment/status` | client token | Poll / reconcile an order |
| POST | `/api/payment/webhook` | Razorpay signature | Webhook receiver |
| POST | `/api/register` | – | **Retired** (410) |
| POST | `/api/admin/auth/login` | – | Admin login |
| POST | `/api/admin/auth/logout` | admin + CSRF | Logout |
| GET | `/api/admin/auth/me` | admin | Current session |
| GET | `/api/players` | admin | Paginated list / search / filters (unchanged contract) |
| GET | `/api/players/stats` | admin | Status counts (aggregation) |
| GET / PATCH | `/api/players/:id` | admin (+CSRF) | Detail / edit (unchanged) |
| PATCH | `/api/players/:id/status` | admin + CSRF | Status update (unchanged logic) |
| PATCH | `/api/players/:id/pool` | admin + CSRF | Pool update (unchanged logic) |
| GET | `/api/players/:id/aadhaar/:side` | admin | Stream private Aadhaar image |
| GET | `/api/proxy-image` | admin | Image proxy (now admin-only) |

---

## 🗄️ Database changes

**Player** (existing collection — only additions; historical documents untouched)

* `aadhaarFrontImage`, `aadhaarBackImage`: `{ public_id, format, bytes, delivery_type, uploadedAt }`, `select: false`
* `payment`: `{ provider: "razorpay", razorpayOrderId, razorpayPaymentId, receipt, amount (paise), currency, status, method, paidAt, verifiedVia }`
* `paymentScreenshot.url/public_id` are now required **only for non-Razorpay (legacy)** records
* `transactionId` (unchanged rules) now stores the verified Razorpay payment ID for new registrations
* New indexes: unique partial `payment.razorpayOrderId`, unique partial `payment.razorpayPaymentId`,
  `{ createdAt: -1, _id: -1 }` (stable pagination sort)

**New collections:** `registrationorders`, `pendinguploads`, `webhookevents` (30-day TTL),
`adminsessions` (TTL), `ratelimits` (TTL).

Mongoose creates the new indexes automatically on startup (`autoIndex`). On a large production
collection you may prefer to create them manually in Atlas first.

---

## 🧪 Tests

```bash
npm run build
npm test            # payment-flow suite (tsx) + HTTP end-to-end suite (next start)
node tests/perf.mjs # performance / explain() report with 5,000 seeded players
```

All suites use an **in-memory MongoDB** (`mongodb-memory-server`) and fakes / dummy
credentials for Razorpay and Cloudinary — they never touch real services or your database.

---

## ☁️ Production deployment (Vercel)

1. Set all environment variables in *Project → Settings → Environment Variables* (Production),
   using **Live** Razorpay keys and the raw (unescaped) `ADMIN_PASSWORD_HASH`.
2. Deploy; check the function logs for `[config] Environment configuration OK`.
3. Create the **Live-mode** webhook pointing at `https://<domain>/api/payment/webhook`.
4. Do a real ₹1 test (temporarily set `REGISTRATION_FEE=1`) or a full-fee payment you refund,
   and confirm the registration appears in the admin portal with payment details.
5. Monitor logs for `MANUAL_ACTION_REQUIRED` — it flags the rare cases that need a human
   (e.g. a payment on an expired order, or a duplicate payment that should be refunded).

---

## 🛠️ Tech stack

Next.js 14 · Tailwind CSS · MongoDB Atlas / Mongoose · Cloudinary · Razorpay Node SDK ·
bcryptjs · react-hot-toast · Axios
