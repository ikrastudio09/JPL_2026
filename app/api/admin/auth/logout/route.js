/**
 * POST /api/admin/auth/logout
 * Deletes the server-side session (invalidating the cookie everywhere) and clears cookies.
 */
import {
  requireAdmin,
  destroySessionByToken,
  buildClearedCookies,
} from "../../../../../lib/auth/adminSession";

export const dynamic = "force-dynamic";

function clearedResponse(body, status) {
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json" });
  for (const c of buildClearedCookies()) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

export async function POST(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) {
      // Not logged in (or bad CSRF) — still clear any stale cookies on this browser.
      if (auth.response.status === 401) {
        return clearedResponse({ success: true, message: "Logged out." }, 200);
      }
      return auth.response;
    }
    await destroySessionByToken(auth.token);
    return clearedResponse({ success: true, message: "Logged out." }, 200);
  } catch (error) {
    console.error("[auth] Logout error:", error?.message);
    return clearedResponse({ success: false, message: "Logout failed." }, 500);
  }
}
