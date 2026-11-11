"use client";

/**
 * fetch() wrapper for the admin portal.
 *  - sends the session cookie (same-origin)
 *  - attaches the CSRF token header on state-changing requests
 *  - on 401 (expired / logged-out session) notifies the admin shell to show the login screen
 */
export const CSRF_COOKIE = "jpl_admin_csrf";
export const UNAUTHORIZED_EVENT = "jpl-admin-unauthorized";

export function readCsrfToken() {
  if (typeof document === "undefined") return "";
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : "";
}

export async function adminFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!["GET", "HEAD"].includes(method)) headers.set("x-csrf-token", readCsrfToken());

  const res = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" });
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return res;
}
