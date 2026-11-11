/**
 * POST /api/register — RETIRED.
 *
 * The old QR/UPI workflow accepted a self-reported transaction ID and payment screenshot,
 * which would let anyone register without paying once Razorpay is live. Registrations are
 * now created only after a server-verified Razorpay payment:
 *   POST /api/payment/create-order  →  Razorpay Checkout  →  POST /api/payment/verify
 *   (and POST /api/payment/webhook as a reconciliation path)
 *
 * Historical registrations created by this endpoint are untouched.
 */
import { errorResponse } from "../../../utils/apiHelpers";

export async function POST() {
  return errorResponse(
    "This registration method is no longer available. Please refresh the page and complete payment through the secure Razorpay checkout.",
    410,
  );
}
