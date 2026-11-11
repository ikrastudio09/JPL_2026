/**
 * Admin layout (Server Component).
 * Validates the admin session against MongoDB on every request. Unauthenticated
 * visitors get the login screen — the dashboard is never rendered for them, and every
 * admin API independently re-checks the session.
 */
import { cookies } from "next/headers";
import { getSessionByToken, SESSION_COOKIE } from "../../lib/auth/adminSession";
import { isConfigured } from "../../lib/env";
import AdminLogin from "../../components/admin/AdminLogin";
import AdminSessionBar from "../../components/admin/AdminSessionBar";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "JPL 2026 Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }) {
  const configured = isConfigured("admin");
  let session = null;
  if (configured) {
    try {
      session = await getSessionByToken(cookies().get(SESSION_COOKIE)?.value);
    } catch (err) {
      console.error("[auth] Session check failed:", err?.message);
    }
  }

  if (!session) return <AdminLogin configured={configured} />;

  return (
    <>
      <AdminSessionBar username={session.username} />
      {children}
    </>
  );
}
