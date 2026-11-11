"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Minimal admin login screen — matches the admin dashboard's light slate/blue theme.
 */
export default function AdminLogin({ configured = true }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setPassword("");
        router.refresh();
        return;
      }
      setError(data.message || "Login failed. Please try again.");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={s.page}>
      <form onSubmit={onSubmit} style={s.card} noValidate>
        <div style={{ fontSize: 34, textAlign: "center" }}>🏏</div>
        <h1 style={s.title}>JPL 2026 Admin</h1>
        <p style={s.subtitle}>Sign in to manage player registrations</p>

        {!configured && (
          <div style={s.error}>
            Admin login is not configured on the server. Set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and
            ADMIN_SESSION_SECRET.
          </div>
        )}

        <label style={s.label} htmlFor="admin-username">Username</label>
        <input
          id="admin-username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={s.input}
          disabled={!configured || submitting}
          autoFocus
        />

        <label style={s.label} htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={s.input}
          disabled={!configured || submitting}
        />

        {error && <div style={s.error} role="alert">{error}</div>}

        <button
          type="submit"
          disabled={!configured || submitting}
          style={{ ...s.button, opacity: !configured || submitting ? 0.7 : 1 }}
        >
          {submitting ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}

const s = {
  page: {
    minHeight: "100vh",
    background: "#F8FAFC",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    background: "#fff",
    border: "1px solid #E2E8F0",
    borderRadius: 14,
    boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
    padding: "28px 26px",
    display: "flex",
    flexDirection: "column",
  },
  title: { margin: "6px 0 2px", textAlign: "center", fontSize: 20, fontWeight: 800, color: "#0F172A" },
  subtitle: { margin: "0 0 20px", textAlign: "center", fontSize: 13, color: "#64748B" },
  label: { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6, marginTop: 10 },
  input: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #CBD5E1",
    fontSize: 14,
    outline: "none",
    color: "#0F172A",
    background: "#fff",
  },
  error: {
    marginTop: 14,
    background: "#FEF2F2",
    border: "1px solid #FECACA",
    color: "#DC2626",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13,
  },
  button: {
    marginTop: 20,
    padding: "11px 14px",
    borderRadius: 8,
    border: "none",
    background: "#1E3A8A",
    color: "#fff",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },
};
