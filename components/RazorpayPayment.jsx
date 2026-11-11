"use client";

/**
 * RazorpayPayment — payment information panel (replaces the old UPI QR panel).
 * Purely presentational: shows the fee, how payment works, and the live payment state.
 */
const STATE_STYLES = {
  failed: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.3)", color: "#fca5a5", icon: "⚠️" },
  cancelled: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.3)", color: "#fcd34d", icon: "ℹ️" },
  pending: { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.3)", color: "#93c5fd", icon: "⏳" },
  info: { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.3)", color: "#86efac", icon: "🔒" },
};

export default function RazorpayPayment({ fee, notice }) {
  const tone = notice ? STATE_STYLES[notice.tone] || STATE_STYLES.info : null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.03) 100%)",
        border: "1px solid rgba(245,158,11,0.2)",
      }}
    >
      {/* Header */}
      <div
        className="px-5 py-3 flex items-center gap-2"
        style={{ background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.15)" }}
      >
        <span className="text-lg">💳</span>
        <span
          className="font-semibold text-sm tracking-wider"
          style={{ color: "#fbbf24", fontFamily: "var(--font-accent)", textTransform: "uppercase" }}
        >
          Registration Fee Payment
        </span>
      </div>

      <div className="p-5 flex flex-col gap-4">
        {/* Amount */}
        <div
          className="flex items-center justify-between p-3 rounded-xl"
          style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}
        >
          <span className="text-sm" style={{ color: "rgba(232,245,233,0.7)" }}>
            Registration Fee
          </span>
          <span className="text-xl font-bold" style={{ color: "#4ade80", fontFamily: "var(--font-accent)" }}>
            ₹{fee}
          </span>
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-2">
          {[
            { step: "1", text: "Fill in all details and upload your photo & Aadhaar card" },
            { step: "2", text: "Review your details and tap Pay & Submit" },
            { step: "3", text: "Pay securely with UPI, card, net banking or wallet via Razorpay" },
            { step: "4", text: "Your registration is confirmed automatically once payment is verified" },
          ].map((item) => (
            <div key={item.step} className="flex items-center gap-2.5">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                style={{ background: "rgba(245,158,11,0.2)", color: "#fbbf24", fontFamily: "var(--font-accent)" }}
              >
                {item.step}
              </div>
              <span className="text-xs" style={{ color: "rgba(232,245,233,0.7)" }}>
                {item.text}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
          🔒 Payments are processed by Razorpay. We never see or store your card / UPI details.
        </p>

        {/* Live payment state */}
        {notice && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2 p-3 rounded-xl text-xs animate-fade-in"
            style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.color }}
          >
            <span className="flex-shrink-0">{tone.icon}</span>
            <span>
              {notice.title && <strong className="block mb-0.5">{notice.title}</strong>}
              {notice.message}
              {notice.reference && (
                <span className="block mt-1 font-mono opacity-80">Reference: {notice.reference}</span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
