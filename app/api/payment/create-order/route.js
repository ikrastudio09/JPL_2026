/**
 * POST /api/payment/create-order  (multipart/form-data)
 * Validates the registration (existing rules), checks the Aadhaar uploads, uploads the
 * player photo, and creates a Razorpay order for the server-configured fee.
 */
import connectDB from "../../../../lib/mongodb";
import { createRegistrationOrder } from "../../../../lib/registration/paymentService";
import { consumeLimit } from "../../../../lib/rateLimit";
import { ipKey, isSameOrigin } from "../../../../lib/security";

export const dynamic = "force-dynamic";

const ORDERS_PER_HOUR_PER_IP = 20;

export async function POST(request) {
  try {
    if (!isSameOrigin(request)) {
      return Response.json({ success: false, message: "Forbidden." }, { status: 403 });
    }
    await connectDB();

    const limit = await consumeLimit(`create-order:${ipKey(request)}`, ORDERS_PER_HOUR_PER_IP, 3600 * 1000);
    if (!limit.allowed) {
      return Response.json(
        { success: false, message: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return Response.json(
        { success: false, message: "Invalid form data. Please check your submission." },
        { status: 400 },
      );
    }

    const { status, body } = await createRegistrationOrder(formData);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[payment] create-order unexpected error:", error?.message);
    return Response.json(
      { success: false, message: "Could not start the payment. Please try again." },
      { status: 500 },
    );
  }
}
