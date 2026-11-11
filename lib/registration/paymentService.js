/**
 * Payment service — request handling logic for the /api/payment/* routes.
 * Each function returns { status, body } so routes stay thin and the logic is testable.
 */
import crypto from "crypto";
import RegistrationOrder from "../../models/RegistrationOrder";
import PendingUpload from "../../models/PendingUpload";
import WebhookEvent from "../../models/WebhookEvent";
import { uploadPlayerPhoto, deleteFromCloudinary } from "../cloudinary";
import {
  getRazorpay,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  describeRazorpayError,
  ORDER_ID_RE,
} from "../razorpay";
import { getRazorpayConfig, getRegistrationAmountPaise, isConfigured } from "../env";
import { randomToken, sha256Hex, safeEqual } from "../security";
import { parseAndValidateRegistration } from "./validateRegistration";
import { finalizeRegistrationOrder, FinalizeCode } from "./finalizeOrder";
import { runCleanupIfDue } from "./cleanup";

export const ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const CURRENCY = "INR";
const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{20,64}$/;

const ok = (status, data, message = "Success") => ({ status, body: { success: true, message, data } });
const fail = (status, message, extra = {}) => ({ status, body: { success: false, message, ...extra } });

function newReceipt() {
  // Razorpay receipt max length is 40
  return `JPL26_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

/** Map a finalize result to an HTTP response. */
function finalizeToResponse(result, orderId) {
  switch (result.code) {
    case FinalizeCode.OK:
      return ok(
        result.alreadyProcessed ? 200 : 201,
        { state: "completed", player: result.player, alreadyProcessed: !!result.alreadyProcessed },
        "Payment verified. Registration successful! Your application is under review.",
      );
    case FinalizeCode.PAYMENT_PENDING:
    case FinalizeCode.PROCESSING:
      return ok(
        202,
        { state: "pending", orderId },
        "Your payment is being confirmed. Please do not pay again.",
      );
    case FinalizeCode.PAYMENT_FAILED:
      return fail(402, result.message || "Payment failed. Please try again.", { state: "failed" });
    case FinalizeCode.PAYMENT_MISMATCH:
      return fail(400, result.message || "Payment verification failed.", { state: "rejected" });
    case FinalizeCode.EXPIRED:
      return fail(410, result.message || "This registration session has expired.", { state: "expired" });
    case FinalizeCode.ORDER_NOT_FOUND:
      return fail(404, "Registration order not found.");
    default:
      return fail(
        503,
        result.message || "We could not confirm your registration yet. Please do not pay again.",
        { state: "pending", orderId, retryable: true },
      );
  }
}

async function loadOrderForClient(orderId, clientToken) {
  if (!ORDER_ID_RE.test(orderId || "") || typeof clientToken !== "string" || clientToken.length > 200) {
    return { error: fail(400, "Invalid payment reference.") };
  }
  const order = await RegistrationOrder.findOne({ razorpayOrderId: orderId }).lean();
  if (!order || !safeEqual(sha256Hex(clientToken), order.clientTokenHash)) {
    return { error: fail(404, "Registration order not found.") };
  }
  return { order };
}

/* ──────────────────────────── create-order ──────────────────────────── */

export async function createRegistrationOrder(formData) {
  if (!isConfigured("razorpay") || !isConfigured("cloudinary")) {
    console.error("[payment] create-order: Razorpay or Cloudinary is not configured.");
    return fail(503, "Online payment is temporarily unavailable. Please try again later.");
  }

  // 1. Validate all registration fields with the existing rules
  const parsed = parseAndValidateRegistration(formData);
  if (parsed.error) return fail(parsed.error.status, parsed.error.message);

  // 2. Validate the two mandatory Aadhaar uploads
  const frontId = String(formData.get("aadhaarFrontUploadId") || "");
  const backId = String(formData.get("aadhaarBackUploadId") || "");
  if (!UPLOAD_ID_RE.test(frontId)) return fail(400, "Aadhaar card front image is required.");
  if (!UPLOAD_ID_RE.test(backId)) return fail(400, "Aadhaar card back image is required.");
  if (frontId === backId) return fail(400, "Please upload different images for Aadhaar front and back.");

  const now = new Date();
  const [front, back] = await Promise.all([
    PendingUpload.findOne({ uploadId: frontId, side: "front", status: "pending" }).lean(),
    PendingUpload.findOne({ uploadId: backId, side: "back", status: "pending" }).lean(),
  ]);
  if (!front || front.expiresAt <= now) {
    return fail(400, "Aadhaar card front image has expired or is missing. Please upload it again.", { field: "aadhaarFront" });
  }
  if (!back || back.expiresAt <= now) {
    return fail(400, "Aadhaar card back image has expired or is missing. Please upload it again.", { field: "aadhaarBack" });
  }

  // Opportunistic cleanup of abandoned orders / uploads (bounded, rate-limited)
  await runCleanupIfDue();

  // 3. Amount comes ONLY from server configuration
  const amount = getRegistrationAmountPaise();
  const receipt = newReceipt();

  // 4. Upload the player photo (existing upload logic)
  let photo;
  try {
    photo = await uploadPlayerPhoto(parsed.playerPhoto);
  } catch (err) {
    console.error("[payment] Player photo upload failed:", err?.message);
    return fail(500, `Player photo upload failed: ${err?.message || "please try again"}`);
  }

  // 5. Create the Razorpay order server-side
  let rzpOrder;
  try {
    rzpOrder = await getRazorpay().orders.create({
      amount,
      currency: CURRENCY,
      receipt,
      notes: { purpose: "JPL 2026 player registration", receipt },
    });
  } catch (err) {
    console.error(`[payment] Razorpay order creation failed: ${describeRazorpayError(err)}`);
    await deleteFromCloudinary(photo.public_id).catch(() => {});
    return fail(502, "Could not start the payment. Please try again.");
  }
  if (!rzpOrder?.id || Number(rzpOrder.amount) !== amount || rzpOrder.currency !== CURRENCY) {
    console.error("[payment] Razorpay returned an unexpected order payload.");
    await deleteFromCloudinary(photo.public_id).catch(() => {});
    return fail(502, "Could not start the payment. Please try again.");
  }

  // 6. Persist the order ↔ registration binding
  const clientToken = randomToken(24);
  const expiresAt = new Date(Date.now() + ORDER_TTL_MS);
  try {
    await RegistrationOrder.create({
      razorpayOrderId: rzpOrder.id,
      receipt,
      amount,
      currency: CURRENCY,
      status: "created",
      clientTokenHash: sha256Hex(clientToken),
      registration: parsed.data,
      playerPhoto: photo,
      aadhaarFront: { uploadId: front.uploadId, public_id: front.public_id, format: front.format, bytes: front.bytes },
      aadhaarBack: { uploadId: back.uploadId, public_id: back.public_id, format: back.format, bytes: back.bytes },
      expiresAt,
    });
    // Keep the uploads alive at least as long as the order
    await PendingUpload.updateMany(
      { uploadId: { $in: [front.uploadId, back.uploadId] }, status: "pending", expiresAt: { $lt: expiresAt } },
      { $set: { expiresAt } },
    );
  } catch (err) {
    console.error("[payment] Failed to save registration order:", err?.message);
    await deleteFromCloudinary(photo.public_id).catch(() => {});
    return fail(500, "Could not start the payment. Please try again.");
  }

  return ok(
    201,
    {
      orderId: rzpOrder.id,
      amount,
      currency: CURRENCY,
      keyId: getRazorpayConfig().keyId, // public key only
      clientToken,
      receipt,
      expiresAt,
      prefill: { name: parsed.data.name, contact: parsed.data.mobile },
    },
    "Order created.",
  );
}

/* ──────────────────────────── verify ──────────────────────────── */

export async function verifyCheckoutPayment(body) {
  if (!isConfigured("razorpay")) return fail(503, "Online payment is temporarily unavailable.");
  const orderId = body?.razorpay_order_id;
  const paymentId = body?.razorpay_payment_id;
  const signature = body?.razorpay_signature;

  // 1. Signature (forged / tampered responses are rejected here)
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
    console.warn("[payment] Invalid checkout signature received");
    return fail(400, "Payment verification failed. If money was deducted, it will be confirmed automatically or refunded.", { state: "rejected" });
  }

  // 2. Order must exist and belong to this browser session
  const { order, error } = await loadOrderForClient(orderId, body?.clientToken);
  if (error) return error;

  // 3. Server-side confirmation + idempotent finalization
  const result = await finalizeRegistrationOrder({
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: paymentId,
    source: "checkout",
  });
  return finalizeToResponse(result, order.razorpayOrderId);
}

/* ──────────────────────────── status / reconcile ──────────────────────────── */

export async function getOrderStatus(body) {
  const { order, error } = await loadOrderForClient(body?.orderId, body?.clientToken);
  if (error) return error;

  if (order.status === "completed") {
    const result = await finalizeRegistrationOrder({ razorpayOrderId: order.razorpayOrderId, source: "reconciliation" });
    return finalizeToResponse(result, order.razorpayOrderId);
  }
  if (order.status === "expired") return fail(410, "This registration session has expired.", { state: "expired" });
  if (!isConfigured("razorpay")) return ok(202, { state: "pending", orderId: order.razorpayOrderId }, "Pending.");

  // Reconcile with Razorpay (covers a lost checkout callback)
  const result = await finalizeRegistrationOrder({ razorpayOrderId: order.razorpayOrderId, source: "reconciliation" });
  if (result.code === FinalizeCode.PAYMENT_PENDING && ["created", "attempted", "failed"].includes(order.status)) {
    return ok(200, { state: "awaiting_payment", orderId: order.razorpayOrderId }, "Awaiting payment.");
  }
  return finalizeToResponse(result, order.razorpayOrderId);
}

/* ──────────────────────────── webhook ──────────────────────────── */

/**
 * @param {string} rawBody exact request body (required for signature verification)
 * @param {Headers} headers
 */
export async function handleRazorpayWebhook(rawBody, headers) {
  if (!isConfigured("razorpay")) return fail(503, "Not configured.");

  const signature = headers.get("x-razorpay-signature");
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[webhook] Invalid Razorpay webhook signature");
    return fail(400, "Invalid signature.");
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return fail(400, "Invalid payload.");
  }

  const eventId = headers.get("x-razorpay-event-id") || `sha256:${sha256Hex(rawBody)}`;
  const eventName = String(event?.event || "");
  const paymentEntity = event?.payload?.payment?.entity;
  const orderEntity = event?.payload?.order?.entity;
  const orderId = paymentEntity?.order_id || orderEntity?.id;

  // Replay / duplicate delivery protection
  const existing = await WebhookEvent.findOne({ eventId }).lean();
  if (existing?.status === "processed") {
    return ok(200, { duplicate: true }, "Already processed.");
  }
  if (!existing) {
    try {
      await WebhookEvent.create({ eventId, event: eventName, razorpayOrderId: orderId });
    } catch (err) {
      if (err?.code !== 11000) throw err; // concurrent duplicate delivery — continue idempotently
    }
  }

  const markProcessed = (result) =>
    WebhookEvent.updateOne({ eventId }, { $set: { status: "processed", result, processedAt: new Date() } });

  if (!orderId || !ORDER_ID_RE.test(orderId)) {
    await markProcessed("ignored:no-order");
    return ok(200, { ignored: true }, "Ignored.");
  }

  const order = await RegistrationOrder.findOne({ razorpayOrderId: orderId }).select("_id status").lean();
  if (!order) {
    // Not created by this application (e.g. another integration on the same account)
    await markProcessed("ignored:unknown-order");
    return ok(200, { ignored: true }, "Ignored.");
  }

  if (eventName === "payment.failed") {
    await RegistrationOrder.updateOne(
      { _id: order._id, status: { $in: ["created", "attempted", "failed"] } },
      {
        $set: {
          status: "failed",
          lastPaymentError: {
            code: paymentEntity?.error_code,
            description: paymentEntity?.error_description,
            reason: paymentEntity?.error_reason,
            at: new Date(),
          },
        },
      },
    );
    await markProcessed("payment-failed-recorded");
    return ok(200, { recorded: true }, "Recorded.");
  }

  if (eventName === "payment.captured" || eventName === "order.paid") {
    // The webhook is only a trigger — finalize() re-confirms the payment via the Razorpay API.
    const result = await finalizeRegistrationOrder({
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentEntity?.id,
      source: "webhook",
    });
    const transient = [FinalizeCode.PROCESSING, FinalizeCode.ERROR, FinalizeCode.PAYMENT_PENDING].includes(result.code);
    if (transient) {
      // Non-2xx makes Razorpay retry later
      return fail(503, "Temporarily unable to process; please retry.");
    }
    await markProcessed(result.code);
    return ok(200, { result: result.code }, "Processed.");
  }

  await markProcessed("ignored:event");
  return ok(200, { ignored: true }, "Ignored.");
}
