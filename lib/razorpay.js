/**
 * Razorpay server-side client (official SDK) + signature verification.
 * The key secret and webhook secret never leave the server.
 */
import Razorpay from "razorpay";
import { getRazorpayConfig, isConfigured } from "./env";
import { hmacSha256Hex, safeEqual } from "./security";

let client = null;

export function getRazorpay() {
  if (!isConfigured("razorpay")) {
    throw new Error("Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET).");
  }
  if (!client) {
    const { keyId, keySecret } = getRazorpayConfig();
    client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return client;
}

export const ORDER_ID_RE = /^order_[A-Za-z0-9]{6,40}$/;
export const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{6,40}$/;
const SIGNATURE_RE = /^[a-f0-9]{64}$/;

/**
 * Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
 * Compared in constant time.
 */
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  if (!ORDER_ID_RE.test(orderId || "") || !PAYMENT_ID_RE.test(paymentId || "")) return false;
  if (!SIGNATURE_RE.test(signature || "")) return false;
  const expected = hmacSha256Hex(getRazorpayConfig().keySecret, `${orderId}|${paymentId}`);
  return safeEqual(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook secret). */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = getRazorpayConfig().webhookSecret;
  if (!secret || typeof rawBody !== "string" || !SIGNATURE_RE.test(signature || "")) return false;
  const expected = hmacSha256Hex(secret, rawBody);
  return safeEqual(expected, signature);
}

/** Extract a safe, log-friendly description from a Razorpay SDK error. */
export function describeRazorpayError(err) {
  const e = err?.error || err;
  return [e?.code, e?.description || e?.message].filter(Boolean).join(": ") || "unknown error";
}
