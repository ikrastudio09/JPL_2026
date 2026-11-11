"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch, UNAUTHORIZED_EVENT } from "../../lib/adminFetch";

/**
 * Slim bar above the (unchanged) admin dashboard: signed-in user + Logout.
 * Also returns to the login screen whenever an admin API reports the session expired.
 */
export default function AdminSessionBar({ username }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => router.refresh();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [router]);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await adminFetch("/api/admin/auth/logout", { method: "POST" });
    } catch {
      /* ignore — the refresh below re-checks the session server-side */
    }
    router.refresh();
  };

  return (
    <div
      style={{
        background: "#0F172A",
        color: "#CBD5E1",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontSize: 12,
        padding: "6px 16px",
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span>
        🔒 Signed in as <strong style={{ color: "#fff" }}>{username}</strong>
      </span>
      <button
        onClick={logout}
        disabled={loggingOut}
        style={{
          background: "transparent",
          color: "#fff",
          border: "1px solid #475569",
          borderRadius: 6,
          padding: "3px 10px",
          fontSize: 12,
          fontWeight: 600,
          cursor: loggingOut ? "not-allowed" : "pointer",
        }}
      >
        {loggingOut ? "Logging out…" : "Logout"}
      </button>
    </div>
  );
}
