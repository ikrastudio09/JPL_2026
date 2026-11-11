/**
 * POST /api/admin/auth/login
 * Body: { username, password }
 * Rate limited per IP and globally (MongoDB-backed) to resist brute force.
 */
import connectDB from "../../../../../lib/mongodb";
import {
  verifyAdminCredentials,
  createSession,
  buildSessionCookies,
} from "../../../../../lib/auth/adminSession";
import { peekLimit, hitLimit, resetLimit } from "../../../../../lib/rateLimit";
import { ipKey, isSameOrigin } from "../../../../../lib/security";
import { isConfigured } from "../../../../../lib/env";

export const dynamic = "force-dynamic";

const WINDOW_MS = 1 * 60 * 1000;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_GLOBAL = 50;

function json(body, status, extraHeaders = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
}

export async function POST(request) {
  try {
    if (!isSameOrigin(request)) return json({ success: false, message: "Forbidden." }, 403);
    if (!isConfigured("admin")) {
      console.error("[auth] Login attempted but ADMIN_* environment variables are missing.");
      return json({ success: false, message: "Admin login is not configured." }, 503);
    }

    await connectDB();
    const ipLimitKey = `login-fail:${ipKey(request)}`;
    const globalKey = "login-fail:global";

    const [ipState, globalState] = await Promise.all([
      peekLimit(ipLimitKey, WINDOW_MS),
      peekLimit(globalKey, WINDOW_MS),
    ]);
    if (ipState.count >= MAX_FAILS_PER_IP || globalState.count >= MAX_FAILS_GLOBAL) {
      const retry = Math.max(ipState.retryAfterSec, globalState.retryAfterSec, 1);
      return json(
        {
          success: false,
          message: `Too many failed login attempts. Try again in ${Math.ceil(retry / 60)} minute(s).`,
        },
        429,
        { "Retry-After": String(retry) },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, message: "Invalid request." }, 400);
    }
    const { username, password } = body || {};

    const ok = await verifyAdminCredentials(username, password);
    if (!ok) {
      await Promise.all([hitLimit(ipLimitKey, WINDOW_MS), hitLimit(globalKey, WINDOW_MS)]);
      console.warn("[auth] Failed admin login attempt");
      return json({ success: false, message: "Invalid username or password." }, 401);
    }

    await resetLimit(ipLimitKey);
    const { token, csrfToken, expiresAt } = await createSession(String(username).trim());
    const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json" });
    for (const c of buildSessionCookies(token, csrfToken)) headers.append("Set-Cookie", c);
    console.info("[auth] Admin login successful");
    return new Response(
      JSON.stringify({ success: true, message: "Logged in.", data: { expiresAt } }),
      { status: 200, headers },
    );
  } catch (error) {
    console.error("[auth] Login error:", error?.message);
    return json({ success: false, message: "Login failed. Please try again." }, 500);
  }
}
