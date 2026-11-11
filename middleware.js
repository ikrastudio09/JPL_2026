/**
 * Edge middleware — defence in depth for admin surfaces.
 *
 * It only performs a cheap presence check of the admin session cookie so that
 * unauthenticated traffic never reaches protected handlers. The REAL authentication
 * (session lookup in MongoDB + CSRF validation) happens in every protected route via
 * lib/auth/adminSession.requireAdmin().
 */
import { NextResponse } from "next/server";

const SESSION_COOKIE = "jpl_admin_session";

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Admin pages: never index or cache (the layout itself renders the login screen when needed)
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    res.headers.set("Cache-Control", "no-store");
    return res;
  }

  // Login must stay reachable without a session
  if (pathname === "/api/admin/auth/login" || pathname === "/api/admin/auth/logout") {
    return NextResponse.next();
  }

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/players",
    "/api/players/:path*",
    "/api/proxy-image",
  ],
};
