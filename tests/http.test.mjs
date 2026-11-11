/**
 * End-to-end HTTP tests against the production build (`next start`).
 * Uses an in-memory MongoDB and dummy third-party credentials — never real services.
 *
 *   npm run build && node tests/http.test.mjs
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { TEST_ENV, assert, section, summary, validRegistrationFields, hmac, JPEG_BYTES, PDF_BYTES } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "Correct-Horse-Battery-9";

const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
const MONGODB_URI = rs.getUri("jpl_http_test");
const env = {
  ...process.env,
  ...TEST_ENV,
  NODE_ENV: "production",
  MONGODB_URI,
  ADMIN_PASSWORD_HASH: await bcrypt.hash(ADMIN_PASSWORD, 12),
  PORT: String(PORT),
};

/* ── seed historical + new-style data directly ── */
await mongoose.connect(MONGODB_URI);
const players = mongoose.connection.collection("players");
const legacyId = new mongoose.Types.ObjectId();
const rzpId = new mongoose.Types.ObjectId();
const now = new Date();
await players.insertMany([
  {
    _id: legacyId, playerID: 1, playerName: "Legacy Player", playerPhone: "9123456789", dateOfBirth: new Date("1990-01-01"),
    bloodGroup: "O+", fatherName: "Legacy Father", profession: "Doctor", playingStyle: ["Left Arm Batting"], playerType: "Bowler",
    tShirtSize: "M", tShirtNumber: 7, tShirtName: "LEGACY", playerAddress: [{ AddressLine1: "1 Old St", City: "Sangli", State: "MH", PinCode: "416416", Country: "India" }],
    playerPhoto: { url: "https://res.cloudinary.com/x/image/upload/v1/p.jpg", public_id: "p" },
    paymentScreenshot: { url: "https://res.cloudinary.com/x/image/upload/v1/s.jpg", public_id: "s" },
    transactionId: "UTR123456789", status: "approved", playerPool: 3, playerCategory: "Undefined", createdAt: now, updatedAt: now,
  },
  {
    _id: new mongoose.Types.ObjectId(), playerID: 2, playerName: "Old Age Only", playerPhone: "9000000001", Age: 41,
    bloodGroup: "A+", fatherName: "Someone", profession: "Retired", playingStyle: ["Right Arm Batting"], playerType: "Batsman",
    tShirtSize: "XL", tShirtNumber: 10, tShirtName: "OLD", playerPhoto: { url: "u", public_id: "p2" },
    paymentScreenshot: { url: "u2", public_id: "s2" }, transactionId: "UTR000000002", status: "pending", playerPool: 0, createdAt: now, updatedAt: now,
  },
  {
    _id: rzpId, playerID: 3, playerName: "Razorpay Player", playerPhone: "9876543210", dateOfBirth: new Date("1995-06-15"),
    bloodGroup: "B+", fatherName: "Father", profession: "Software Developer", playingStyle: ["Right Arm Batting"], playerType: "Batsman",
    tShirtSize: "L", tShirtNumber: 18, tShirtName: "RZP", playerPhoto: { url: "u3", public_id: "p3" },
    transactionId: "PAY_ABCDEF123456",
    aadhaarFrontImage: { public_id: "cricket_tournament/aadhaar_private/secret-front", format: "jpg", delivery_type: "authenticated" },
    aadhaarBackImage: { public_id: "cricket_tournament/aadhaar_private/secret-back", format: "png", delivery_type: "authenticated" },
    payment: { provider: "razorpay", razorpayOrderId: "order_ABCDEF123456", razorpayPaymentId: "pay_ABCDEF123456", amount: 150000, currency: "INR", status: "captured", method: "upi", paidAt: now },
    status: "pending", playerPool: 0, playerCategory: "Undefined", createdAt: now, updatedAt: now,
  },
]);
await mongoose.connection.collection("playercounters").insertOne({ id: "playerID", seq: 3 });

/* ── start server ── */
const server = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], {
  cwd: ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/register`, { method: "POST" });
      if (r.status) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start:\n" + serverLog);
}

/* ── tiny cookie jar ── */
function parseSetCookies(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const out = {};
  for (const c of list) {
    const [pair, ...attrs] = c.split(";");
    const idx = pair.indexOf("=");
    out[pair.slice(0, idx).trim()] = { value: pair.slice(idx + 1), attrs: attrs.map((a) => a.trim().toLowerCase()) };
  }
  return out;
}

let ipCounter = 10;
const freshIp = () => `203.0.113.${ipCounter++}`;

async function login(username, password, ip = freshIp()) {
  return fetch(`${BASE}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ username, password }),
  });
}

let exitCode = 0;
try {
  await waitForServer();

  section("Public registration page");
  let res = await fetch(`${BASE}/`);
  let html = await res.text();
  assert(res.status === 200, "home page renders");
  for (const label of ["Full Name", "Mobile Number", "Date of Birth", "Blood Group", "Father&#x27;s Full Name", "Profession", "Previous Team",
    "Address Line 1", "City", "State", "Pin Code", "Upload Player Photo", "T-Shirt Size", "T-Shirt Number (0–9999)"]) {
    assert(html.includes(label), `existing field label present: ${label.replace("&#x27;", "'")}`);
  }
  assert(html.includes("Aadhaar Card Front Image") && html.includes("Aadhaar Card Back Image"), "Aadhaar front/back upload fields present");
  assert(!html.includes("Transaction ID / UTR") && !html.includes("QR.jpeg") && !html.includes("Payment Screenshot"), "old QR / screenshot / transaction ID inputs removed");
  assert(html.includes("₹1500") && html.includes("Razorpay"), "configured fee and Razorpay payment section shown");
  assert(!html.includes(TEST_ENV.RAZORPAY_KEY_SECRET) && !html.includes(TEST_ENV.RAZORPAY_WEBHOOK_SECRET), "no secrets in page HTML");

  section("Admin pages & APIs are inaccessible without authentication");
  res = await fetch(`${BASE}/admin`);
  html = await res.text();
  assert(res.status === 200 && html.includes("Sign in to manage player registrations"), "/admin shows login screen");
  assert(!html.includes("Admin Dashboard"), "dashboard is not rendered for anonymous visitors");
  assert((res.headers.get("x-robots-tag") || "").includes("noindex"), "admin page marked noindex");
  const protectedRequests = [
    ["GET", "/api/players"],
    ["GET", "/api/players?limit=10000"],
    ["GET", "/api/players/stats"],
    ["GET", `/api/players/${legacyId}`],
    ["PATCH", `/api/players/${legacyId}`],
    ["PATCH", `/api/players/${legacyId}/status`],
    ["PATCH", `/api/players/${legacyId}/pool`],
    ["GET", `/api/players/${rzpId}/aadhaar/front`],
    ["GET", `/api/players/${rzpId}/aadhaar/back`],
    ["GET", "/api/proxy-image?url=https://res.cloudinary.com/x/y.jpg"],
    ["GET", "/api/admin/auth/me"],
  ];
  for (const [method, url] of protectedRequests) {
    const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: method === "PATCH" ? "{}" : undefined });
    assert(r.status === 401, `${method} ${url.split("?")[0]} → 401 without session`, r.status);
  }
  for (const [method, url] of protectedRequests) {
    const r = await fetch(BASE + url, {
      method,
      headers: { "Content-Type": "application/json", Cookie: "jpl_admin_session=forged-token-value" },
      body: method === "PATCH" ? '{"status":"rejected"}' : undefined,
    });
    assert(r.status === 401, `${method} ${url.split("?")[0]} → 401 with forged session cookie`, r.status);
  }
  const untouched = await players.findOne({ _id: legacyId });
  assert(untouched.status === "approved" && untouched.playerPool === 3, "no data changed by unauthenticated requests");

  section("Admin login");
  res = await login("admin", "wrong-password");
  let body = await res.json();
  assert(res.status === 401 && body.message === "Invalid username or password.", "incorrect password rejected");
  res = await login("notadmin", ADMIN_PASSWORD);
  assert(res.status === 401, "incorrect username rejected");
  res = await fetch(`${BASE}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
  });
  assert(res.status === 403, "cross-origin login attempt rejected");
  res = await login("admin", ADMIN_PASSWORD);
  body = await res.json();
  const cookies = parseSetCookies(res);
  assert(res.status === 200 && body.success, "correct credentials accepted");
  const sess = cookies.jpl_admin_session;
  const csrf = cookies.jpl_admin_csrf;
  assert(!!sess?.value && sess.value.length >= 40, "session cookie issued");
  assert(sess.attrs.includes("httponly"), "session cookie is HttpOnly");
  assert(sess.attrs.includes("samesite=strict"), "session cookie is SameSite=Strict");
  assert(sess.attrs.includes("secure"), "session cookie is Secure in production");
  assert(sess.attrs.some((a) => a.startsWith("max-age=28800")), "session cookie expires after 8 hours");
  assert(!!csrf?.value && !csrf.attrs.includes("httponly"), "CSRF cookie issued (readable by admin UI)");
  assert(!JSON.stringify(body).includes(sess.value), "session token not exposed in response body");
  const sessionDocs = await mongoose.connection.collection("adminsessions").find().toArray();
  assert(sessionDocs.length === 1 && sessionDocs[0].tokenHash !== sess.value, "session stored server-side as HMAC, not raw token");

  const authed = (extra = {}) => ({ Cookie: `jpl_admin_session=${sess.value}; jpl_admin_csrf=${csrf.value}`, ...extra });

  section("Authenticated admin session");
  res = await fetch(`${BASE}/admin`, { headers: authed() });
  html = await res.text();
  assert(html.includes("Signed in as") && !html.includes("Sign in to manage player registrations"), "/admin renders dashboard shell when logged in");
  res = await fetch(`${BASE}/admin`, { headers: authed() });
  assert((await res.text()).includes("Signed in as"), "session persists across page refresh");
  res = await fetch(`${BASE}/api/admin/auth/me`, { headers: authed() });
  body = await res.json();
  assert(res.status === 200 && body.data.username === "admin", "/api/admin/auth/me returns session");

  section("Historical registrations & listing");
  res = await fetch(`${BASE}/api/players?page=1&limit=20`, { headers: authed() });
  body = await res.json();
  const text = JSON.stringify(body);
  assert(res.status === 200 && body.data.players.length === 3 && body.data.pagination.total === 3, "list returns all records incl. historical");
  const legacyRow = body.data.players.find((p) => p.playerName === "Legacy Player");
  assert(legacyRow.paymentScreenshot.url && legacyRow.transactionId === "UTR123456789" && legacyRow.status === "approved" && legacyRow.playerPool === 3, "legacy record fields intact");
  assert(legacyRow.hasAadhaarFront === false && !legacyRow.payment, "legacy record: no Aadhaar/payment handled gracefully");
  const ageOnly = body.data.players.find((p) => p.playerName === "Old Age Only");
  assert(ageOnly.calculatedAge === 41, "historical Age fallback preserved");
  const rzpRow = body.data.players.find((p) => p.playerName === "Razorpay Player");
  assert(rzpRow.hasAadhaarFront === true && rzpRow.hasAadhaarBack === true, "Aadhaar presence flags for new registrations");
  assert(rzpRow.payment.razorpayPaymentId === "pay_ABCDEF123456" && rzpRow.payment.amount === 150000, "payment details available to admin");
  assert(!text.includes("secret-front") && !text.includes("secret-back") && !text.includes("aadhaarFrontImage"), "Aadhaar storage references never included in list API");
  res = await fetch(`${BASE}/api/players/${rzpId}`, { headers: authed() });
  assert(!(await res.text()).includes("secret-front"), "Aadhaar storage references never included in detail API");

  res = await fetch(`${BASE}/api/players?search=${encodeURIComponent("legacy")}`, { headers: authed() });
  assert((await res.json()).data.players.length === 1, "search by name works");
  res = await fetch(`${BASE}/api/players?search=7`, { headers: authed() });
  assert((await res.json()).data.players.some((p) => p.tShirtNumber === 7), "numeric search (jersey #) works");
  res = await fetch(`${BASE}/api/players?search=${encodeURIComponent("UTR1234")}`, { headers: authed() });
  assert((await res.json()).data.players.length === 1, "search by transaction id works");
  res = await fetch(`${BASE}/api/players?search=${encodeURIComponent("pay_ABCDEF")}`, { headers: authed() });
  assert((await res.json()).data.players.length === 1, "search by Razorpay payment id works");
  res = await fetch(`${BASE}/api/players?search=${encodeURIComponent("(((")}`, { headers: authed() });
  assert(res.status === 200, "regex special characters in search no longer cause a 500", res.status);
  res = await fetch(`${BASE}/api/players?status=approved`, { headers: authed() });
  assert((await res.json()).data.players.length === 1, "status filter works");
  res = await fetch(`${BASE}/api/players?playerPool=3`, { headers: authed() });
  assert((await res.json()).data.players.length === 1, "pool filter works");
  res = await fetch(`${BASE}/api/players?page=abc&limit=-5`, { headers: authed() });
  assert(res.status === 200 && (await res.json()).data.pagination.limit === 20, "invalid pagination params fall back to defaults");

  section("Dashboard statistics");
  res = await fetch(`${BASE}/api/players/stats`, { headers: authed() });
  body = await res.json();
  assert(JSON.stringify(body.data.stats) === JSON.stringify({ total: 3, pending: 2, approved: 1, rejected: 0 }), "aggregated stats correct", body.data.stats);

  section("CSRF protection on state-changing admin requests");
  res = await fetch(`${BASE}/api/players/${legacyId}/status`, {
    method: "PATCH", headers: authed({ "Content-Type": "application/json" }), body: JSON.stringify({ status: "rejected" }),
  });
  assert(res.status === 403, "PATCH without CSRF header rejected");
  res = await fetch(`${BASE}/api/players/${legacyId}/status`, {
    method: "PATCH", headers: authed({ "Content-Type": "application/json", "x-csrf-token": "wrong" }), body: JSON.stringify({ status: "rejected" }),
  });
  assert(res.status === 403, "PATCH with wrong CSRF token rejected");
  res = await fetch(`${BASE}/api/players/${legacyId}/status`, {
    method: "PATCH", headers: authed({ "Content-Type": "application/json", "x-csrf-token": csrf.value, Origin: "https://evil.example" }), body: JSON.stringify({ status: "rejected" }),
  });
  assert(res.status === 403, "PATCH from foreign origin rejected");
  assert((await players.findOne({ _id: legacyId })).status === "approved", "status unchanged by rejected requests");

  section("Regression: existing status & pool updation logic");
  const csrfHeaders = authed({ "Content-Type": "application/json", "x-csrf-token": csrf.value });
  res = await fetch(`${BASE}/api/players/${legacyId}/status`, { method: "PATCH", headers: csrfHeaders, body: JSON.stringify({ status: "rejected" }) });
  body = await res.json();
  assert(res.status === 200 && body.data.player.status === "rejected" && body.message === "Player status updated successfully.", "status update works (approved → rejected)");
  assert((await players.findOne({ _id: legacyId })).status === "rejected", "status persisted");
  res = await fetch(`${BASE}/api/players/${legacyId}/status`, { method: "PATCH", headers: csrfHeaders, body: JSON.stringify({ status: "banana" }) });
  body = await res.json();
  assert(res.status === 400 && body.message === "Invalid status. Must be one of: pending, approved, rejected", "invalid status rejected with original message");
  res = await fetch(`${BASE}/api/players/${rzpId}/status`, { method: "PATCH", headers: csrfHeaders, body: JSON.stringify({ status: "approved" }) });
  assert(res.status === 200 && (await players.findOne({ _id: rzpId })).status === "approved", "status update works on Razorpay registration");
  res = await fetch(`${BASE}/api/players/${rzpId}/pool`, { method: "PATCH", headers: csrfHeaders, body: JSON.stringify({ playerPool: 5 }) });
  body = await res.json();
  assert(res.status === 200 && body.data.player.playerPool === 5 && body.message === "Player pool updated successfully.", "pool update works");
  const afterPool = await players.findOne({ _id: rzpId });
  assert(afterPool.playerPool === 5 && afterPool.status === "approved", "pool persisted, status untouched by pool update");
  assert(afterPool.aadhaarFrontImage?.public_id && afterPool.payment?.razorpayPaymentId, "Aadhaar & payment data untouched by pool update");
  res = await fetch(`${BASE}/api/players/${legacyId}/pool`, { method: "PATCH", headers: csrfHeaders, body: JSON.stringify({ playerPool: 1 }) });
  assert(res.status === 200 && (await players.findOne({ _id: legacyId })).playerPool === 1, "pool update works on legacy record");
  res = await fetch(`${BASE}/api/players/${legacyId}`, { method: "PATCH", headers: csrfHeaders, body: JSON.stringify({ tShirtName: "newname" }) });
  body = await res.json();
  assert(res.status === 200 && body.data.player.tShirtName === "NEWNAME", "player edit works (existing uppercase rule)");
  const legacyAfter = await players.findOne({ _id: legacyId });
  assert(legacyAfter.paymentScreenshot.url && legacyAfter.transactionId === "UTR123456789", "editing a legacy record keeps historical payment data");
  res = await fetch(`${BASE}/api/players/stats`, { headers: authed() });
  body = await res.json();
  assert(JSON.stringify(body.data.stats) === JSON.stringify({ total: 3, pending: 1, approved: 1, rejected: 1 }), "stats reflect updates immediately", body.data.stats);

  section("Aadhaar document endpoint");
  res = await fetch(`${BASE}/api/players/${legacyId}/aadhaar/front`, { headers: authed() });
  assert(res.status === 404, "historical record without Aadhaar → 404 (handled gracefully)");
  res = await fetch(`${BASE}/api/players/${rzpId}/aadhaar/side`, { headers: authed() });
  assert(res.status === 404, "invalid side rejected");
  res = await fetch(`${BASE}/api/players/not-an-id/aadhaar/front`, { headers: authed() });
  assert(res.status === 404, "invalid id rejected");

  section("Public payment & upload endpoints");
  res = await fetch(`${BASE}/api/register`, { method: "POST" });
  assert(res.status === 410, "old /api/register (QR workflow) retired → 410");
  const fd = new FormData();
  for (const [k, v] of Object.entries(validRegistrationFields({ mobile: "123" }))) fd.append(k, v);
  fd.append("playerPhoto", new File([JPEG_BYTES], "p.jpg", { type: "image/jpeg" }));
  res = await fetch(`${BASE}/api/payment/create-order`, { method: "POST", body: fd, headers: { "x-forwarded-for": freshIp() } });
  body = await res.json();
  assert(res.status === 400 && /Invalid Indian mobile number/.test(body.message), "create-order validates fields over HTTP");
  const fd2 = new FormData();
  for (const [k, v] of Object.entries(validRegistrationFields())) fd2.append(k, v);
  fd2.append("playerPhoto", new File([JPEG_BYTES], "p.jpg", { type: "image/jpeg" }));
  res = await fetch(`${BASE}/api/payment/create-order`, { method: "POST", body: fd2, headers: { "x-forwarded-for": freshIp() } });
  body = await res.json();
  assert(res.status === 400 && body.message === "Aadhaar card front image is required.", "create-order requires Aadhaar uploads");
  res = await fetch(`${BASE}/api/payment/create-order`, { method: "POST", body: fd2, headers: { Origin: "https://evil.example" } });
  assert(res.status === 403, "cross-origin create-order rejected");

  const up = async (bytes, name, type, side = "front") => {
    const f = new FormData();
    if (side) f.append("side", side);
    f.append("file", new File([bytes], name, { type }));
    const r = await fetch(`${BASE}/api/registration/aadhaar-upload`, { method: "POST", body: f, headers: { "x-forwarded-for": "198.51.100.7" } });
    return { status: r.status, body: await r.json() };
  };
  let u = await up(PDF_BYTES, "a.pdf", "application/pdf");
  assert(u.status === 400 && /JPG, JPEG, or PNG/.test(u.body.message), "Aadhaar upload: PDF rejected");
  u = await up(PDF_BYTES, "a.jpg", "image/jpeg");
  assert(u.status === 400 && /not a valid JPG or PNG/.test(u.body.message), "Aadhaar upload: disguised file rejected by content check");
  u = await up(JPEG_BYTES, "a.webp", "image/webp");
  assert(u.status === 400, "Aadhaar upload: WebP rejected");
  u = await up(Buffer.concat([JPEG_BYTES, Buffer.alloc(4 * 1024 * 1024)]), "big.jpg", "image/jpeg");
  assert(u.status === 400 && /exceeds/.test(u.body.message), "Aadhaar upload: >4 MB rejected");
  u = await up(JPEG_BYTES, "a.jpg", "image/jpeg", "");
  assert(u.status === 400 && /side/.test(u.body.message), "Aadhaar upload: missing side rejected");
  u = await up(JPEG_BYTES, "../../etc/passwd.jpg", "image/jpeg", "middle");
  assert(u.status === 400, "Aadhaar upload: invalid side value rejected");

  const rawWebhook = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_X0000001", order_id: "order_Unknown000001", amount: 1, currency: "INR" } } } });
  res = await fetch(`${BASE}/api/payment/webhook`, { method: "POST", body: rawWebhook, headers: { "x-razorpay-signature": "0".repeat(64) } });
  assert(res.status === 400, "webhook with invalid signature → 400");
  res = await fetch(`${BASE}/api/payment/webhook`, { method: "POST", body: rawWebhook });
  assert(res.status === 400, "webhook without signature → 400");
  res = await fetch(`${BASE}/api/payment/webhook`, {
    method: "POST", body: rawWebhook,
    headers: { "x-razorpay-signature": hmac(TEST_ENV.RAZORPAY_WEBHOOK_SECRET, rawWebhook), "x-razorpay-event-id": "evt_http_1" },
  });
  assert(res.status === 200, "correctly signed webhook (raw body) accepted");
  res = await fetch(`${BASE}/api/payment/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ razorpay_order_id: "order_ABCDEF123456", razorpay_payment_id: "pay_ABCDEF123456", razorpay_signature: "a".repeat(64), clientToken: "x" }),
  });
  assert(res.status === 400, "verify with forged signature → 400");

  section("Logout invalidates the session");
  res = await fetch(`${BASE}/api/admin/auth/logout`, { method: "POST", headers: authed() });
  assert(res.status === 403, "logout requires CSRF token");
  res = await fetch(`${BASE}/api/admin/auth/logout`, { method: "POST", headers: authed({ "x-csrf-token": csrf.value }) });
  const cleared = parseSetCookies(res);
  assert(res.status === 200 && cleared.jpl_admin_session?.value === "" && cleared.jpl_admin_session.attrs.includes("max-age=0"), "logout clears cookies");
  res = await fetch(`${BASE}/api/players`, { headers: authed() });
  assert(res.status === 401, "old session cookie rejected after logout (server-side invalidation)");
  res = await fetch(`${BASE}/admin`, { headers: authed() });
  assert((await res.text()).includes("Sign in to manage player registrations"), "/admin shows login again after logout");

  section("Brute-force protection");
  const attackerIp = "192.0.2.50";
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await login("admin", `guess-${i}`, attackerIp)).status);
  assert(statuses.every((s) => s === 401), "first 5 wrong attempts → 401");
  res = await login("admin", "guess-6", attackerIp);
  assert(res.status === 429 && res.headers.get("retry-after"), "6th attempt from same IP → 429 with Retry-After");
  res = await login("admin", ADMIN_PASSWORD, attackerIp);
  assert(res.status === 429, "even the correct password is blocked while locked out");
  res = await login("admin", ADMIN_PASSWORD, freshIp());
  assert(res.status === 200, "other IPs unaffected by a per-IP lockout");
  // Distributed attack → global limit (50 failures / 15 min)
  let globalBlocked = false;
  for (let i = 0; i < 60 && !globalBlocked; i++) {
    const r = await login("admin", `spray-${i}`, freshIp());
    if (r.status === 429) globalBlocked = true;
  }
  assert(globalBlocked, "distributed guessing hits the global failure limit");
  assert(!/Correct-Horse|ADMIN_PASSWORD_HASH|\$2[aby]\$/.test(serverLog), "no password / hash in server logs");
  assert(!serverLog.includes("secret-front") && !serverLog.includes("aadhaar_private/"), "no Aadhaar references in server logs");
} catch (err) {
  console.error("HTTP test run crashed:", err);
  console.error(serverLog.slice(-3000));
  exitCode = 1;
} finally {
  const failedCount = summary("HTTP tests");
  if (failedCount) {
    exitCode = 1;
    console.log("\n--- server log (tail) ---\n" + serverLog.slice(-4000));
  }
  server.kill();
  await mongoose.disconnect();
  await rs.stop();
  process.exit(exitCode);
}
