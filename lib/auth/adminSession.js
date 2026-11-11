/**
 * Admin authentication — server-side sessions stored in MongoDB.
 *
 *  - Cookie `jpl_admin_session`: random 256-bit token, HttpOnly, SameSite=Strict, Secure in production.
 *  - DB stores only HMAC-SHA256(ADMIN_SESSION_SECRET, token).
 *  - Cookie `jpl_admin_csrf`: per-session CSRF token (readable by the admin UI), which must be
 *    echoed in the `x-csrf-token` header for every state-changing admin request.
 */
import bcrypt from "bcryptjs";
import connectDB from "../mongodb";
import AdminSession from "../../models/AdminSession";
import { getAdminConfig, isConfigured, isProduction } from "../env";
import { hmacSha256Hex, randomToken, safeEqual, isSameOrigin } from "../security";

export const SESSION_COOKIE = "jpl_admin_session";
export const CSRF_COOKIE = "jpl_admin_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// A valid bcrypt hash used to keep timing uniform when the username is wrong.
// (hash of a random, discarded value — it matches nothing)
const DUMMY_HASH = "$2b$12$0Kepydadx8iKhfAHPMsQEe2MLTSPdA/i/18zK/0XrEhV6hYu5m5da";

function tokenHash(token) {
  return hmacSha256Hex(getAdminConfig().sessionSecret, token);
}

function cookieAttrs(maxAgeSec, { httpOnly }) {
  const parts = [`Path=/`, `Max-Age=${maxAgeSec}`, `SameSite=Strict`];
  if (httpOnly) parts.push("HttpOnly");
  if (isProduction()) parts.push("Secure");
  return parts.join("; ");
}

export function buildSessionCookies(token, csrfToken) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return [
    `${SESSION_COOKIE}=${token}; ${cookieAttrs(maxAge, { httpOnly: true })}`,
    `${CSRF_COOKIE}=${csrfToken}; ${cookieAttrs(maxAge, { httpOnly: false })}`,
  ];
}

export function buildClearedCookies() {
  return [
    `${SESSION_COOKIE}=; ${cookieAttrs(0, { httpOnly: true })}`,
    `${CSRF_COOKIE}=; ${cookieAttrs(0, { httpOnly: false })}`,
  ];
}

/** Verify admin credentials. Always runs bcrypt to avoid user-enumeration timing leaks. */
export async function verifyAdminCredentials(username, password) {
  const cfg = getAdminConfig();
  if (!isConfigured("admin")) return false;
  if (typeof username !== "string" || typeof password !== "string") return false;
  if (password.length > 200 || username.length > 100) return false;
  const userOk = safeEqual(username.trim(), cfg.username.trim());
  const passOk = await bcrypt.compare(password, userOk ? cfg.passwordHash : DUMMY_HASH);
  return userOk && passOk;
}

export async function createSession(username) {
  await connectDB();
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await AdminSession.create({ tokenHash: tokenHash(token), csrfToken, username, expiresAt });
  return { token, csrfToken, expiresAt };
}

/** Look up a session from a raw token. Returns the lean session or null. */
export async function getSessionByToken(token) {
  if (!token || typeof token !== "string" || token.length > 200) return null;
  if (!isConfigured("admin")) return null;
  await connectDB();
  const session = await AdminSession.findOne({
    tokenHash: tokenHash(token),
    expiresAt: { $gt: new Date() },
  }).lean();
  return session || null;
}

export async function destroySessionByToken(token) {
  if (!token) return;
  await connectDB();
  await AdminSession.deleteOne({ tokenHash: tokenHash(token) });
}

export function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function jsonError(message, status) {
  return Response.json(
    { success: false, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Authenticate (and for unsafe methods, CSRF-check) an admin API request.
 * Usage:
 *   const auth = await requireAdmin(request);
 *   if (auth.response) return auth.response;
 */
export async function requireAdmin(request) {
  if (!isConfigured("admin")) {
    console.error("[auth] Admin authentication is not configured (ADMIN_* env vars missing).");
    return { response: jsonError("Admin authentication is not configured.", 503) };
  }
  const token = readCookie(request, SESSION_COOKIE);
  const session = await getSessionByToken(token);
  if (!session) return { response: jsonError("Authentication required.", 401) };

  const method = (request.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const headerToken = request.headers.get(CSRF_HEADER);
    if (!isSameOrigin(request) || !safeEqual(headerToken || "", session.csrfToken)) {
      return { response: jsonError("Invalid or missing CSRF token.", 403) };
    }
  }
  return { session, token };
}
