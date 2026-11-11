/**
 * Runs once when the Next.js server starts. Validates environment configuration and
 * reports every problem clearly. Each feature additionally fails closed at request
 * time (returns 503) if its configuration is missing, so a missing Razorpay key can
 * never result in an unpaid registration and a missing admin config never opens the portal.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv } = await import("./lib/env");
  const problems = validateEnv();
  if (problems.length) {
    console.error(
      "\n[config] ⚠ Environment configuration problems:\n  - " + problems.join("\n  - ") +
        "\n  See .env.example and README.md (Setup) for details.\n",
    );
  } else {
    console.info("[config] Environment configuration OK");
  }
}
