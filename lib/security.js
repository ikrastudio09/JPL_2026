/**
 * Small server-side security helpers.
 */
import crypto from "crypto";

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function hmacSha256Hex(secret, value) {
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
}

/** Constant-time string comparison (safe for unequal lengths). */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Compare against itself to keep timing roughly uniform, then fail.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** Best-effort client IP (Vercel / reverse proxies set x-forwarded-for). */
export function getClientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

/** Hashed IP for use as a rate-limit key without storing raw IPs. */
export function ipKey(request) {
  return sha256Hex(`ip:${getClientIp(request)}`).slice(0, 32);
}

/**
 * Reject cross-site state-changing requests: when an Origin header is present
 * it must match the request host.
 */
export function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers / server-to-server
  try {
    const originHost = new URL(origin).host;
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    return !!host && originHost === host;
  } catch {
    return false;
  }
}
