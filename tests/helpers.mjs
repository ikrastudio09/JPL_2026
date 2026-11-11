/**
 * Shared test helpers. Tests NEVER talk to the real MongoDB, Razorpay or Cloudinary:
 *  - MongoDB: in-memory replica set (mongodb-memory-server)
 *  - Razorpay / Cloudinary: in-process fakes
 */
import crypto from "crypto";

export const TEST_ENV = {
  NODE_ENV: "test",
  RAZORPAY_KEY_ID: "rzp_test_FAKEKEY000000",
  RAZORPAY_KEY_SECRET: "test_key_secret_for_unit_tests_only",
  RAZORPAY_WEBHOOK_SECRET: "test_webhook_secret_for_unit_tests_only",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "000000000000000",
  CLOUDINARY_API_SECRET: "test-cloudinary-secret",
  ADMIN_USERNAME: "admin",
  ADMIN_SESSION_SECRET: "test-session-secret-that-is-at-least-32-chars-long",
  REGISTRATION_FEE: "1500",
};

let passed = 0;
let failed = 0;
const failures = [];

export function assert(cond, name, detail) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}${detail !== undefined ? `  → ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}

export function section(title) {
  console.log(`\n▶ ${title}`);
}

export function summary(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  if (failed) console.log("Failures:\n - " + failures.join("\n - "));
  return failed;
}

// Minimal byte sequences with real file signatures (Cloudinary is mocked, so they need not decode)
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), Buffer.alloc(2048, 1)]);
export const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 2)]);
export const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048, 3)]);
export const EXE_BYTES = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(2048, 4)]);

export function file(bytes, name, type) {
  return new File([bytes], name, { type });
}

export function validRegistrationFields(overrides = {}) {
  return {
    name: "Test Player",
    mobile: "9876543210",
    dateOfBirth: "1995-06-15",
    bloodGroup: "B+",
    fatherName: "Test Father",
    profession: "Software Developer",
    previousTeam: "N/A",
    addressLine1: "12 Test Street",
    city: "Sangli",
    state: "Maharashtra",
    pinCode: "416416",
    country: "India",
    role: "Batsman",
    playingStyle: JSON.stringify(["Right Arm Batting"]),
    tShirtSize: "L",
    tShirtNumber: "18",
    tShirtName: "TESTER",
    ...overrides,
  };
}

export function hmac(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Fake Razorpay API with the subset of the SDK surface the app uses.
 */
export function createFakeRazorpay() {
  const orders = new Map();
  const payments = new Map();
  let seq = 0;
  const id = (prefix) => `${prefix}_${(++seq).toString(36).padStart(6, "0")}T${crypto.randomBytes(4).toString("hex")}`;
  const calls = { ordersCreate: 0, paymentsFetch: 0, capture: 0, fetchPayments: 0 };
  const failNext = { fetch: 0 };

  const api = {
    orders: {
      async create(params) {
        calls.ordersCreate++;
        const order = { id: id("order"), entity: "order", amount: params.amount, currency: params.currency, receipt: params.receipt, status: "created" };
        orders.set(order.id, order);
        return { ...order };
      },
      async fetchPayments(orderId) {
        calls.fetchPayments++;
        if (failNext.fetch > 0) {
          failNext.fetch--;
          throw { error: { code: "SERVER_ERROR", description: "simulated outage" } };
        }
        return { items: [...payments.values()].filter((p) => p.order_id === orderId).map((p) => ({ ...p })) };
      },
    },
    payments: {
      async fetch(paymentId) {
        calls.paymentsFetch++;
        if (failNext.fetch > 0) {
          failNext.fetch--;
          throw { error: { code: "SERVER_ERROR", description: "simulated outage" } };
        }
        const p = payments.get(paymentId);
        if (!p) throw { statusCode: 400, error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } };
        return { ...p };
      },
      async capture(paymentId, amount) {
        calls.capture++;
        const p = payments.get(paymentId);
        if (!p) throw { error: { code: "BAD_REQUEST_ERROR", description: "not found" } };
        if (p.captureShouldFail) throw { error: { code: "BAD_REQUEST_ERROR", description: "capture failed" } };
        if (p.status !== "authorized") throw { error: { code: "BAD_REQUEST_ERROR", description: "already captured" } };
        if (amount !== p.amount) throw { error: { code: "BAD_REQUEST_ERROR", description: "amount mismatch" } };
        p.status = "captured";
        return { ...p };
      },
    },
  };

  /** Simulate a customer paying an order through Checkout. */
  function pay(orderId, { status = "captured", amount, currency = "INR", method = "upi", forOrderId, captureShouldFail = false } = {}) {
    const order = orders.get(orderId);
    const p = {
      id: id("pay"),
      entity: "payment",
      order_id: forOrderId || orderId,
      amount: amount ?? order?.amount,
      currency,
      status,
      method,
      captureShouldFail,
      created_at: Math.floor(Date.now() / 1000),
      error_code: status === "failed" ? "BAD_REQUEST_ERROR" : null,
      error_description: status === "failed" ? "Payment declined by bank" : null,
      error_reason: status === "failed" ? "payment_failed" : null,
    };
    payments.set(p.id, p);
    if (status === "captured" && order) order.status = "paid";
    return p;
  }

  return { api, orders, payments, pay, calls, failNext };
}
