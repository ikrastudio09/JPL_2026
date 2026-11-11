/**
 * Centralised server-side environment configuration.
 * NEVER import this file from client components — it reads secrets.
 */

// Existing fee that was previously hard-coded in PaymentQR.jsx / TournamentHeader.jsx
export const DEFAULT_REGISTRATION_FEE_INR = 1500;

const GROUPS = {
  database: ["MONGODB_URI"],
  cloudinary: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
  razorpay: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
  admin: ["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "ADMIN_SESSION_SECRET"],
};

function isSet(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "";
}

/** Returns the list of missing variables for a feature group. */
export function missingEnv(group) {
  return (GROUPS[group] || []).filter((n) => !isSet(n));
}

export function isConfigured(group) {
  return missingEnv(group).length === 0;
}

/**
 * Registration fee in whole rupees. Server-side source of truth.
 * The amount is NEVER taken from the client.
 */
export function getRegistrationFeeInr() {
  const raw = process.env.REGISTRATION_FEE;
  if (raw === undefined || String(raw).trim() === "") return DEFAULT_REGISTRATION_FEE_INR;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 100000) {
    throw new Error("REGISTRATION_FEE must be a positive whole number of rupees (e.g. 1500).");
  }
  return n;
}

export function getRegistrationAmountPaise() {
  return getRegistrationFeeInr() * 100;
}

export function getRazorpayConfig() {
  return {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
}

export function getAdminConfig() {
  return {
    username: process.env.ADMIN_USERNAME,
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    sessionSecret: process.env.ADMIN_SESSION_SECRET,
  };
}

export const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Validate all environment variables and return a list of human-readable problems.
 * Called at server startup from instrumentation.js.
 */
export function validateEnv() {
  const problems = [];
  for (const group of Object.keys(GROUPS)) {
    const missing = missingEnv(group);
    if (missing.length) problems.push(`[${group}] missing: ${missing.join(", ")}`);
  }
  try {
    getRegistrationFeeInr();
  } catch (e) {
    problems.push(e.message);
  }
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (isSet("ADMIN_PASSWORD_HASH") && !/^\$2[aby]\$\d{2}\$.{53}$/.test(hash)) {
    problems.push(
      "ADMIN_PASSWORD_HASH does not look like a bcrypt hash. Generate one with: npm run hash-password",
    );
  }
  if (isSet("ADMIN_SESSION_SECRET") && process.env.ADMIN_SESSION_SECRET.length < 32) {
    problems.push("ADMIN_SESSION_SECRET must be at least 32 characters long.");
  }
  if (isProduction() && isSet("RAZORPAY_KEY_ID") && process.env.RAZORPAY_KEY_ID.startsWith("rzp_test_")) {
    problems.push("WARNING: Razorpay TEST key is configured in a production build.");
  }
  return problems;
}
