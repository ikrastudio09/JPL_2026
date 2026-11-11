"use client";

import { useEffect } from "react";

/**
 * ReviewModal — lets the player review their details before paying.
 * Styled to match SuccessModal.
 */
export default function ReviewModal({ form, previews, fee, onEdit, onConfirm, busy }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape" && !busy) onEdit();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onEdit, busy]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  const address = [form.addressLine1, form.addressLine2, form.city, form.state, form.pinCode, form.country]
    .map((v) => (v || "").trim())
    .filter(Boolean)
    .join(", ");

  const rows = [
    ["Full Name", form.name],
    ["Mobile", form.mobile],
    ["Date of Birth", form.dateOfBirth ? new Date(form.dateOfBirth).toLocaleDateString("en-IN") : ""],
    ["Blood Group", form.bloodGroup],
    ["Father's Name", form.fatherName],
    ["Profession", form.profession === "Other" ? `Other — ${form.professionOther}` : form.profession],
    ["Previous Team", form.previousTeam || "—"],
    ["Address", address],
    ["Playing Style", (form.playingStyle || []).join(", ")],
    ["Role", form.role],
    ["T-Shirt", `${form.tShirtSize} · #${form.tShirtNumber} · ${form.tShirtName}`],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", animation: "fadeIn 0.3s ease-out" }}
      onClick={(e) => e.target === e.currentTarget && !busy && onEdit()}
    >
      <div
        className="relative w-full max-w-lg rounded-3xl overflow-hidden animate-scale-in max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        style={{
          background: "linear-gradient(145deg, #0d1f12, #0a1508)",
          border: "1px solid rgba(34,197,94,0.3)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 60px rgba(34,197,94,0.1)",
        }}
      >
        <div className="relative p-6 sm:p-8 flex flex-col gap-5">
          <div className="text-center">
            <h2
              id="review-title"
              className="text-2xl sm:text-3xl font-bold"
              style={{
                fontFamily: "var(--font-display)",
                letterSpacing: "0.05em",
                background: "linear-gradient(135deg, #4ade80, #22c55e)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              REVIEW YOUR DETAILS
            </h2>
            <p className="text-xs sm:text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
              Please confirm everything is correct before paying
            </p>
          </div>

          <div
            className="w-full rounded-2xl p-4 flex flex-col gap-2"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {rows.map(([label, value]) => (
              <div key={label} className="flex gap-3 text-xs">
                <span
                  className="w-28 flex-shrink-0 uppercase"
                  style={{ color: "var(--color-text-dim)", fontFamily: "var(--font-accent)", letterSpacing: "0.06em" }}
                >
                  {label}
                </span>
                <span className="font-medium break-words min-w-0" style={{ color: "var(--color-text)" }}>
                  {value || "—"}
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              ["Photo", previews.photo],
              ["Aadhaar Front", previews.aadhaarFront],
              ["Aadhaar Back", previews.aadhaarBack],
            ].map(([label, src]) => (
              <div key={label} className="flex flex-col gap-1 items-center">
                {src ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={src}
                    alt={label}
                    className="w-full h-20 object-cover rounded-lg"
                    style={{ border: "1px solid rgba(34,197,94,0.3)" }}
                  />
                ) : (
                  <div className="w-full h-20 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }} />
                )}
                <span className="text-[10px] uppercase" style={{ color: "var(--color-text-dim)" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          <div
            className="flex items-center justify-between p-3 rounded-xl"
            style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}
          >
            <span className="text-sm" style={{ color: "rgba(232,245,233,0.7)" }}>
              Amount to pay
            </span>
            <span className="text-xl font-bold" style={{ color: "#4ade80", fontFamily: "var(--font-accent)" }}>
              ₹{fee}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onEdit}
              disabled={busy}
              className="flex-1 py-3.5 rounded-xl font-semibold text-sm"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "var(--color-text)",
                fontFamily: "var(--font-accent)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                opacity: busy ? 0.6 : 1,
              }}
            >
              ✏️ Edit Details
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="flex-1 py-3.5 rounded-xl font-semibold text-sm"
              style={{
                background: "linear-gradient(135deg, #16a34a, #22c55e)",
                color: "#fff",
                fontFamily: "var(--font-accent)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                boxShadow: "0 8px 24px rgba(34,197,94,0.3)",
                opacity: busy ? 0.7 : 1,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "Please wait…" : `Confirm & Pay ₹${fee}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
