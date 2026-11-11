/**
 * Payment / registration integration tests.
 * Runs the REAL service code against an in-memory MongoDB replica set, with the
 * Razorpay API and Cloudinary replaced by in-process fakes.
 *
 *   npx tsx tests/payment-flow.test.mjs
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  TEST_ENV, assert, section, summary, file, validRegistrationFields, hmac, createFakeRazorpay,
  JPEG_BYTES, PNG_BYTES, PDF_BYTES, EXE_BYTES,
} from "./helpers.mjs";

const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
Object.assign(process.env, TEST_ENV, { MONGODB_URI: rs.getUri("jpl_test") });

const { default: connectDB } = await import("../lib/mongodb.js");
const { default: mongoose } = await import("mongoose");
const { default: Player } = await import("../models/Player.js");
const { default: PlayerCounter } = await import("../models/PlayerCounter.js");
const { default: RegistrationOrder } = await import("../models/RegistrationOrder.js");
const { default: PendingUpload } = await import("../models/PendingUpload.js");
const { default: WebhookEvent } = await import("../models/WebhookEvent.js");
const { default: cloudinary } = await import("../lib/cloudinary.js");
const razorpayLib = await import("../lib/razorpay.js");
const svc = await import("../lib/registration/paymentService.js");
const { runCleanup } = await import("../lib/registration/cleanup.js");
const { validateAadhaarFile, detectImageType } = await import("../lib/privateDocuments.js");

await connectDB();
await Promise.all([Player.init(), RegistrationOrder.init(), PendingUpload.init(), WebhookEvent.init()]);

/* ── fakes ── */
const fake = createFakeRazorpay();
const rzp = razorpayLib.getRazorpay();
rzp.orders.create = fake.api.orders.create;
rzp.orders.fetchPayments = fake.api.orders.fetchPayments;
rzp.payments.fetch = fake.api.payments.fetch;
rzp.payments.capture = fake.api.payments.capture;

const cloud = { uploads: [], destroyed: [] };
cloudinary.uploader.upload_stream = (opts, cb) => ({
  end(buffer) {
    const public_id = `${opts.folder}/${opts.public_id || "photo_" + cloud.uploads.length}`;
    cloud.uploads.push({ public_id, type: opts.type || "upload", bytes: buffer.length });
    setImmediate(() =>
      cb(null, { public_id, secure_url: `https://res.cloudinary.com/test-cloud/image/upload/${public_id}.jpg`, format: "jpg", bytes: buffer.length }),
    );
  },
});
cloudinary.uploader.destroy = async (public_id, opts = {}) => {
  cloud.destroyed.push({ public_id, type: opts.type || "upload" });
  return { result: "ok" };
};

const KEY_SECRET = TEST_ENV.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = TEST_ENV.RAZORPAY_WEBHOOK_SECRET;

/* ── helpers ── */
async function makeUpload(side, overrides = {}) {
  const uploadId = `up_${side}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.padEnd(24, "x");
  await PendingUpload.create({
    uploadId,
    side,
    public_id: `cricket_tournament/aadhaar_private/${uploadId}`,
    format: "jpg",
    bytes: 1000,
    expiresAt: new Date(Date.now() + 3600e3),
    ...overrides,
  });
  return uploadId;
}

async function makeFormData(fieldOverrides = {}, { front, back, photo } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(validRegistrationFields(fieldOverrides))) {
    if (v !== undefined && v !== null) fd.append(k, v);
  }
  fd.append("playerPhoto", photo === undefined ? file(JPEG_BYTES, "me.jpg", "image/jpeg") : photo);
  const f = front === undefined ? await makeUpload("front") : front;
  const b = back === undefined ? await makeUpload("back") : back;
  if (f) fd.append("aadhaarFrontUploadId", f);
  if (b) fd.append("aadhaarBackUploadId", b);
  return fd;
}

async function newOrder(fieldOverrides = {}) {
  const res = await svc.createRegistrationOrder(await makeFormData(fieldOverrides));
  if (res.status !== 201) throw new Error("order creation failed: " + JSON.stringify(res.body));
  return res.body.data;
}

const checkoutResponse = (orderId, payment) => ({
  razorpay_order_id: orderId,
  razorpay_payment_id: payment.id,
  razorpay_signature: hmac(KEY_SECRET, `${orderId}|${payment.id}`),
});

function webhookFor(event, payment, eventId = `evt_${Math.random().toString(36).slice(2)}`) {
  const body = JSON.stringify({ entity: "event", event, payload: { payment: { entity: payment } } });
  const headers = new Headers({ "x-razorpay-signature": hmac(WEBHOOK_SECRET, body), "x-razorpay-event-id": eventId });
  return { body, headers, eventId };
}

const countPlayersForOrder = (orderId) => Player.countDocuments({ "payment.razorpayOrderId": orderId });

let exitCode = 0;
try {
  /* ───────────────── Aadhaar content validation ───────────────── */
  section("Aadhaar image validation (type, content, size)");
  assert(detectImageType(JPEG_BYTES) === "jpg", "JPEG signature detected");
  assert(detectImageType(PNG_BYTES) === "png", "PNG signature detected");
  assert((await validateAadhaarFile(file(JPEG_BYTES, "a.jpg", "image/jpeg"), "Front")).format === "jpg", "valid .jpg accepted");
  assert((await validateAadhaarFile(file(JPEG_BYTES, "a.jpeg", "image/jpeg"), "Front")).format === "jpg", "valid .jpeg accepted");
  assert((await validateAadhaarFile(file(PNG_BYTES, "a.png", "image/png"), "Front")).format === "png", "valid .png accepted");
  assert(!!(await validateAadhaarFile(file(PDF_BYTES, "a.jpg", "image/jpeg"), "Front")).error, "PDF renamed to .jpg rejected (content check)");
  assert(!!(await validateAadhaarFile(file(EXE_BYTES, "a.png", "image/png"), "Front")).error, "executable renamed to .png rejected");
  assert(!!(await validateAadhaarFile(file(PNG_BYTES, "a.jpg", "image/jpeg"), "Front")).error, "PNG content declared as JPEG rejected");
  assert(!!(await validateAadhaarFile(file(JPEG_BYTES, "a.webp", "image/webp"), "Front")).error, "WebP type rejected for Aadhaar");
  assert(!!(await validateAadhaarFile(file(JPEG_BYTES, "a.pdf", "application/pdf"), "Front")).error, "application/pdf rejected");
  assert(!!(await validateAadhaarFile(file(Buffer.alloc(0), "a.jpg", "image/jpeg"), "Front")).error, "empty file rejected");
  const big = Buffer.concat([JPEG_BYTES, Buffer.alloc(4 * 1024 * 1024)]);
  assert(/exceeds/.test((await validateAadhaarFile(file(big, "a.jpg", "image/jpeg"), "Front")).error || ""), "oversized (>4 MB) file rejected");
  assert(/required/.test((await validateAadhaarFile(null, "Front")).error || ""), "missing file rejected");

  /* ───────────────── create-order validation ───────────────── */
  section("create-order: existing field validation preserved + Aadhaar required");
  let r = await svc.createRegistrationOrder(await makeFormData({ mobile: "5123456789" }));
  assert(r.status === 400 && r.body.message === "Invalid Indian mobile number. Must be 10 digits starting with 6, 7, 8, or 9.", "invalid mobile → original message", r.body.message);
  r = await svc.createRegistrationOrder(await makeFormData({ profession: "Astronaut" }));
  assert(r.status === 400 && r.body.message === "Please select a valid profession from the predefined options.", "invalid profession → original message");
  r = await svc.createRegistrationOrder(await makeFormData({ profession: "Other", professionOther: "" }));
  assert(r.status === 400 && /specify your profession/.test(r.body.message), "'Other' without detail rejected");
  r = await svc.createRegistrationOrder(await makeFormData({ playingStyle: JSON.stringify(["Right Arm Batting", "Left Arm Batting", "Left Arm Balling"]) }));
  assert(r.status === 400 && r.body.message === "Select 1 to 2 playing styles.", "3 playing styles rejected");
  r = await svc.createRegistrationOrder(await makeFormData({ tShirtNumber: "10000" }));
  assert(r.status === 400 && /between 0 and 9999/.test(r.body.message), "T-shirt number range enforced (0–9999)");
  r = await svc.createRegistrationOrder(await makeFormData({ name: "" }));
  assert(r.status === 400 && /Missing required fields: name/.test(r.body.message), "missing name rejected");
  r = await svc.createRegistrationOrder(await makeFormData({}, { photo: file(PDF_BYTES, "x.pdf", "application/pdf") }));
  assert(r.status === 400 && /Player photo must be a valid image/.test(r.body.message), "player photo rules unchanged (PDF rejected)");
  r = await svc.createRegistrationOrder(await makeFormData({}, { front: null }));
  assert(r.status === 400 && r.body.message === "Aadhaar card front image is required.", "missing Aadhaar front rejected");
  r = await svc.createRegistrationOrder(await makeFormData({}, { back: null }));
  assert(r.status === 400 && r.body.message === "Aadhaar card back image is required.", "missing Aadhaar back rejected");
  const frontAsBack = await makeUpload("front");
  r = await svc.createRegistrationOrder(await makeFormData({}, { back: frontAsBack }));
  assert(r.status === 400 && /back image/.test(r.body.message), "front upload cannot be used as back");
  const expired = await makeUpload("front", { expiresAt: new Date(Date.now() - 1000) });
  r = await svc.createRegistrationOrder(await makeFormData({}, { front: expired }));
  assert(r.status === 400 && /expired/.test(r.body.message), "expired Aadhaar upload rejected");
  r = await svc.createRegistrationOrder(await makeFormData({}, { front: "nonexistent_upload_id_123456" }));
  assert(r.status === 400, "unknown Aadhaar upload id rejected");
  assert((await Player.countDocuments()) === 0, "no Player created by any rejected request");

  section("create-order: success, amount is server-side only");
  const fdAmount = await makeFormData();
  fdAmount.append("amount", "1"); // tampering attempt
  r = await svc.createRegistrationOrder(fdAmount);
  assert(r.status === 201, "valid registration → order created", r.body);
  const o1 = r.body.data;
  assert(o1.amount === 150000 && o1.currency === "INR", "amount = configured fee ₹1500 (150000 paise), client 'amount' ignored", o1.amount);
  assert(o1.keyId === TEST_ENV.RAZORPAY_KEY_ID, "only public key id returned");
  assert(!JSON.stringify(r.body).includes(KEY_SECRET) && !JSON.stringify(r.body).includes(WEBHOOK_SECRET), "no secrets in response");
  assert(typeof o1.clientToken === "string" && o1.clientToken.length >= 24, "client token issued");
  const storedOrder = await RegistrationOrder.findOne({ razorpayOrderId: o1.orderId }).lean();
  assert(storedOrder.status === "created" && storedOrder.registration.name === "Test Player", "order bound to validated registration data");
  assert(storedOrder.clientTokenHash !== o1.clientToken, "client token stored hashed");
  assert((await Player.countDocuments()) === 0, "no Player before payment");

  /* ───────────────── successful payment ───────────────── */
  section("Successful payment via checkout verification");
  const counterBefore = (await PlayerCounter.findOne({ id: "playerID" }).lean())?.seq || 0;
  const pay1 = fake.pay(o1.orderId);
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o1.orderId, pay1), clientToken: o1.clientToken });
  assert(r.status === 201 && r.body.data.state === "completed", "verify → 201 completed", r);
  const p1 = await Player.findById(r.body.data.player.id).select("+aadhaarFrontImage +aadhaarBackImage").lean();
  assert(!!p1, "Player created");
  assert(p1.status === "pending", "existing default status 'pending' used");
  assert(p1.playerPool === 0, "existing default pool 0 used");
  assert(p1.playerCategory === "Undefined", "existing default category 'Undefined' used");
  assert(p1.playerID === counterBefore + 1, "playerID assigned by existing counter hook", p1.playerID);
  assert(p1.transactionId === pay1.id.toUpperCase(), "transactionId = verified payment id (existing uppercase rule)");
  assert(p1.payment.razorpayOrderId === o1.orderId && p1.payment.razorpayPaymentId === pay1.id, "payment ids stored");
  assert(p1.payment.amount === 150000 && p1.payment.status === "captured" && p1.payment.method === "upi", "amount/status/method stored");
  assert(p1.payment.verifiedVia === "checkout", "verifiedVia=checkout");
  assert(!!p1.aadhaarFrontImage?.public_id && !!p1.aadhaarBackImage?.public_id, "Aadhaar front & back associated with registration");
  assert(!p1.paymentScreenshot?.url, "no payment screenshot required for Razorpay registration");
  const plain = await Player.findById(p1._id).lean();
  assert(plain.aadhaarFrontImage === undefined && plain.aadhaarBackImage === undefined, "Aadhaar refs excluded from default queries (select:false)");
  const doneOrder = await RegistrationOrder.findOne({ razorpayOrderId: o1.orderId }).lean();
  assert(doneOrder.status === "completed" && !doneOrder.registration, "order completed, temporary personal data removed");
  assert(!doneOrder.aadhaarFront?.public_id, "duplicate Aadhaar reference removed from order");
  const usedUploads = await PendingUpload.find({ uploadId: { $in: [doneOrder.aadhaarFront.uploadId, doneOrder.aadhaarBack.uploadId] } }).lean();
  assert(usedUploads.length === 2 && usedUploads.every((u) => u.status === "used"), "uploads marked used");

  section("Repeated verification / replay");
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o1.orderId, pay1), clientToken: o1.clientToken });
  assert(r.status === 200 && r.body.data.alreadyProcessed === true && String(r.body.data.player.id) === String(p1._id), "repeat verify returns existing registration");
  assert((await countPlayersForOrder(o1.orderId)) === 1, "still exactly one registration");

  section("Forged / invalid responses");
  const o2 = await newOrder();
  const pay2 = fake.pay(o2.orderId);
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o2.orderId, pay2), razorpay_signature: "0".repeat(64), clientToken: o2.clientToken });
  assert(r.status === 400 && (await countPlayersForOrder(o2.orderId)) === 0, "invalid signature rejected, no registration");
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o2.orderId, pay2), razorpay_signature: hmac("wrong-secret", `${o2.orderId}|${pay2.id}`), clientToken: o2.clientToken });
  assert(r.status === 400, "signature with wrong secret rejected");
  r = await svc.verifyCheckoutPayment({ razorpay_order_id: o2.orderId, razorpay_payment_id: pay2.id, clientToken: o2.clientToken });
  assert(r.status === 400, "missing signature rejected");
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o2.orderId, pay2), clientToken: "not-the-token" });
  assert(r.status === 404 && (await countPlayersForOrder(o2.orderId)) === 0, "wrong client token rejected");
  // Payment from o1 replayed against o2 (signature computed as if Razorpay had issued it)
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o2.orderId, pay1), clientToken: o2.clientToken });
  assert(r.status === 400 && r.body.state === "rejected" && (await countPlayersForOrder(o2.orderId)) === 0, "payment of another order cannot finalize this order (order_id mismatch)");
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse("order_DoesNotExist01", pay2), clientToken: o2.clientToken });
  assert(r.status === 404, "unknown order id rejected");
  // now the genuine one still works
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o2.orderId, pay2), clientToken: o2.clientToken });
  assert(r.status === 201, "genuine verification afterwards succeeds");

  section("Incorrect amount / currency");
  const o3 = await newOrder();
  const payLow = fake.pay(o3.orderId, { amount: 100 });
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o3.orderId, payLow), clientToken: o3.clientToken });
  assert(r.status === 400 && (await countPlayersForOrder(o3.orderId)) === 0, "underpaid amount rejected");
  const payUsd = fake.pay(o3.orderId, { currency: "USD" });
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o3.orderId, payUsd), clientToken: o3.clientToken });
  assert(r.status === 400 && (await countPlayersForOrder(o3.orderId)) === 0, "wrong currency rejected");

  section("Failed payment, then retry on the same order");
  const o4 = await newOrder();
  const payFail = fake.pay(o4.orderId, { status: "failed" });
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o4.orderId, payFail), clientToken: o4.clientToken });
  assert(r.status === 402 && r.body.state === "failed", "failed payment → 402", r.status);
  assert((await RegistrationOrder.findOne({ razorpayOrderId: o4.orderId }).lean()).status === "failed", "order marked failed");
  assert((await countPlayersForOrder(o4.orderId)) === 0, "no registration for failed payment");
  const payRetry = fake.pay(o4.orderId);
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o4.orderId, payRetry), clientToken: o4.clientToken });
  assert(r.status === 201 && (await countPlayersForOrder(o4.orderId)) === 1, "retry on same order succeeds");

  section("Pending / authorized payments");
  const o5 = await newOrder();
  const payPending = fake.pay(o5.orderId, { status: "authorized", captureShouldFail: true });
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o5.orderId, payPending), clientToken: o5.clientToken });
  assert(r.status === 202 && r.body.data.state === "pending" && (await countPlayersForOrder(o5.orderId)) === 0, "authorized-but-uncaptured payment treated as pending");
  const payCreated = fake.pay(o5.orderId, { status: "created" });
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o5.orderId, payCreated), clientToken: o5.clientToken });
  assert(r.status === 202 && (await countPlayersForOrder(o5.orderId)) === 0, "'created' payment treated as pending");
  const o6 = await newOrder();
  const payAuth = fake.pay(o6.orderId, { status: "authorized" });
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o6.orderId, payAuth), clientToken: o6.clientToken });
  assert(r.status === 201 && fake.payments.get(payAuth.id).status === "captured", "authorized payment captured server-side then registered");

  section("Razorpay API outage during verification");
  const o7 = await newOrder();
  const pay7 = fake.pay(o7.orderId);
  fake.failNext.fetch = 1;
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o7.orderId, pay7), clientToken: o7.clientToken });
  assert(r.status === 503 && r.body.retryable && (await countPlayersForOrder(o7.orderId)) === 0, "outage → 503 retryable, nothing created");
  r = await svc.getOrderStatus({ orderId: o7.orderId, clientToken: o7.clientToken });
  assert(r.status === 201 && r.body.data.state === "completed", "status polling reconciles once Razorpay is reachable");

  /* ───────────────── webhooks ───────────────── */
  section("Webhook: signature, payment without frontend callback, duplicates");
  const o8 = await newOrder();
  const pay8 = fake.pay(o8.orderId);
  let wh = webhookFor("payment.captured", pay8);
  r = await svc.handleRazorpayWebhook(wh.body, new Headers({ "x-razorpay-signature": "f".repeat(64) }));
  assert(r.status === 400 && (await countPlayersForOrder(o8.orderId)) === 0, "webhook with invalid signature rejected");
  r = await svc.handleRazorpayWebhook(wh.body + " ", wh.headers);
  assert(r.status === 400, "tampered webhook body rejected");
  r = await svc.handleRazorpayWebhook(wh.body, wh.headers);
  assert(r.status === 200 && (await countPlayersForOrder(o8.orderId)) === 1, "payment.captured webhook finalizes registration (browser closed)");
  const p8 = await Player.findOne({ "payment.razorpayOrderId": o8.orderId }).lean();
  assert(p8.payment.verifiedVia === "webhook" && p8.status === "pending", "webhook registration uses same defaults");
  r = await svc.handleRazorpayWebhook(wh.body, wh.headers);
  assert(r.status === 200 && r.body.data.duplicate === true, "duplicate delivery (same event id) acknowledged as duplicate");
  const wh8b = webhookFor("order.paid", pay8);
  r = await svc.handleRazorpayWebhook(wh8b.body, wh8b.headers);
  assert(r.status === 200 && (await countPlayersForOrder(o8.orderId)) === 1, "order.paid after payment.captured does not duplicate");
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(o8.orderId, pay8), clientToken: o8.clientToken });
  assert(r.status === 200 && r.body.data.alreadyProcessed && String(r.body.data.player.id) === String(p8._id), "frontend verification after webhook returns existing registration");

  section("Webhook arriving after frontend verification");
  const o9 = await newOrder();
  const pay9 = fake.pay(o9.orderId);
  await svc.verifyCheckoutPayment({ ...checkoutResponse(o9.orderId, pay9), clientToken: o9.clientToken });
  wh = webhookFor("payment.captured", pay9);
  r = await svc.handleRazorpayWebhook(wh.body, wh.headers);
  assert(r.status === 200 && (await countPlayersForOrder(o9.orderId)) === 1, "late webhook does not duplicate");

  section("Webhook with forged payment data is re-verified with Razorpay API");
  const o10 = await newOrder();
  const forged = { id: "pay_ForgedPayment01", entity: "payment", order_id: o10.orderId, amount: 150000, currency: "INR", status: "captured" };
  wh = webhookFor("payment.captured", forged);
  r = await svc.handleRazorpayWebhook(wh.body, wh.headers);
  assert(r.status !== 200 || (await countPlayersForOrder(o10.orderId)) === 0, "signed webhook for a payment Razorpay doesn't know → no registration");
  assert((await countPlayersForOrder(o10.orderId)) === 0, "still no registration");

  section("payment.failed webhook + unknown orders");
  const o11 = await newOrder();
  const pay11 = fake.pay(o11.orderId, { status: "failed" });
  wh = webhookFor("payment.failed", pay11);
  r = await svc.handleRazorpayWebhook(wh.body, wh.headers);
  const o11doc = await RegistrationOrder.findOne({ razorpayOrderId: o11.orderId }).lean();
  assert(r.status === 200 && o11doc.status === "failed" && o11doc.lastPaymentError.description === "Payment declined by bank", "failure recorded");
  assert((await countPlayersForOrder(o11.orderId)) === 0, "no registration on payment.failed");
  wh = webhookFor("payment.captured", { id: "pay_OtherIntegration1", order_id: "order_NotOurs0000001", amount: 1, currency: "INR", status: "captured" });
  r = await svc.handleRazorpayWebhook(wh.body, wh.headers);
  assert(r.status === 200 && r.body.data.ignored, "webhook for unknown order ignored safely");

  section("Concurrency: webhook and checkout verification racing");
  const racers = [];
  for (let i = 0; i < 6; i++) racers.push(await newOrder({ name: `Racer ${i}` }));
  await Promise.all(
    racers.flatMap((o) => {
      const pay = fake.pay(o.orderId);
      const w1 = webhookFor("payment.captured", pay);
      const w2 = webhookFor("order.paid", pay);
      const body = { ...checkoutResponse(o.orderId, pay), clientToken: o.clientToken };
      return [
        svc.verifyCheckoutPayment(body),
        svc.verifyCheckoutPayment(body),
        svc.handleRazorpayWebhook(w1.body, w1.headers),
        svc.handleRazorpayWebhook(w1.body, w1.headers),
        svc.handleRazorpayWebhook(w2.body, w2.headers),
        svc.getOrderStatus({ orderId: o.orderId, clientToken: o.clientToken }),
      ];
    }),
  );
  // Retry anything that was told to retry (as Razorpay / the browser would)
  for (const o of racers) await svc.getOrderStatus({ orderId: o.orderId, clientToken: o.clientToken });
  const counts = await Promise.all(racers.map((o) => countPlayersForOrder(o.orderId)));
  assert(counts.every((c) => c === 1), "exactly one registration per order under concurrent processing", counts);
  const ids = await Player.find({ "payment.razorpayOrderId": { $in: racers.map((o) => o.orderId) } }).distinct("playerID");
  assert(ids.length === racers.length, "unique playerIDs assigned");

  section("Database-level duplicate protection");
  let dupErr = null;
  try {
    const existing = await Player.findOne({ "payment.razorpayOrderId": o1.orderId }).lean();
    await Player.collection.insertOne({ ...existing, _id: new mongoose.Types.ObjectId(), playerID: 999999, transactionId: "SOMETHING_ELSE" });
  } catch (e) {
    dupErr = e;
  }
  assert(dupErr?.code === 11000, "unique index blocks a second Player for the same Razorpay order");

  /* ───────────────── status polling ───────────────── */
  section("Status polling (browser reload / lost callback)");
  const o12 = await newOrder();
  r = await svc.getOrderStatus({ orderId: o12.orderId, clientToken: o12.clientToken });
  assert(r.status === 200 && r.body.data.state === "awaiting_payment", "no payment yet → awaiting_payment");
  fake.pay(o12.orderId);
  r = await svc.getOrderStatus({ orderId: o12.orderId, clientToken: o12.clientToken });
  assert(r.status === 201 && r.body.data.state === "completed", "payment made, callback lost → reconciled via status");
  r = await svc.getOrderStatus({ orderId: o12.orderId, clientToken: "bad" });
  assert(r.status === 404, "status requires client token");

  /* ───────────────── cleanup ───────────────── */
  section("Abandoned payment cleanup");
  const abandoned = await newOrder({ name: "Abandoned Player" });
  const paidLate = await newOrder({ name: "Paid Late" });
  fake.pay(paidLate.orderId); // paid, but neither callback nor webhook arrived
  await RegistrationOrder.updateMany(
    { razorpayOrderId: { $in: [abandoned.orderId, paidLate.orderId] } },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  );
  const abandonedDoc = await RegistrationOrder.findOne({ razorpayOrderId: abandoned.orderId }).lean();
  const orphan = await makeUpload("front", { expiresAt: new Date(Date.now() - 1000) });
  await PendingUpload.updateMany(
    { uploadId: { $in: [abandonedDoc.aadhaarFront.uploadId, abandonedDoc.aadhaarBack.uploadId] } },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  );
  const destroyedBefore = cloud.destroyed.length;
  const sum1 = await runCleanup();
  const aDoc = await RegistrationOrder.findOne({ razorpayOrderId: abandoned.orderId }).lean();
  assert(aDoc.status === "expired" && !aDoc.registration, "abandoned order expired, personal data removed", aDoc.status);
  assert(cloud.destroyed.slice(destroyedBefore).some((d) => d.public_id === abandonedDoc.playerPhoto.public_id), "abandoned player photo deleted");
  assert((await countPlayersForOrder(paidLate.orderId)) === 1, "expired order that WAS paid gets finalized, not deleted");
  assert((await PendingUpload.countDocuments({ uploadId: orphan })) === 0, "orphan Aadhaar upload deleted");
  assert(cloud.destroyed.some((d) => d.public_id.endsWith(orphan) && d.type === "authenticated"), "orphan Aadhaar asset deleted from private storage");
  const sum2 = await runCleanup();
  assert((await PendingUpload.countDocuments({ uploadId: abandonedDoc.aadhaarFront.uploadId })) === 0, "abandoned order's Aadhaar uploads deleted once order is expired", { sum1, sum2 });
  const late = fake.pay(abandoned.orderId);
  r = await svc.verifyCheckoutPayment({ ...checkoutResponse(abandoned.orderId, late), clientToken: abandoned.clientToken });
  assert(r.status === 410 && (await countPlayersForOrder(abandoned.orderId)) === 0, "payment on expired order is flagged, not registered");

  /* ───────────────── schema backward compatibility ───────────────── */
  section("Schema backward compatibility");
  const legacy = new Player({
    playerName: "Legacy Player", playerPhone: "9123456789", dateOfBirth: new Date("1990-01-01"), bloodGroup: "O+",
    fatherName: "Legacy Father", profession: "Doctor", playingStyle: ["Left Arm Batting"], playerType: "Bowler",
    tShirtSize: "M", tShirtNumber: 7, tShirtName: "LEGACY", playerPhoto: { url: "https://x/y.jpg", public_id: "p" },
    transactionId: "UTR123456",
  });
  const legacyErr = legacy.validateSync();
  assert(!!legacyErr?.errors?.["paymentScreenshot.url"], "legacy (non-Razorpay) registration still requires a payment screenshot");
  legacy.paymentScreenshot = { url: "https://x/s.jpg", public_id: "s" };
  assert(!legacy.validateSync(), "legacy registration with screenshot valid (no Aadhaar/payment needed)");
} catch (err) {
  console.error("Test run crashed:", err);
  exitCode = 1;
} finally {
  const failedCount = summary("Payment flow tests");
  if (failedCount) exitCode = 1;
  await mongoose.disconnect();
  await rs.stop();
  process.exit(exitCode);
}
