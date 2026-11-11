/**
 * POST /api/payment/verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, clientToken }
 * The registration is created ONLY after signature + server-side payment verification.
 */
import connectDB from "../../../../lib/mongodb";
import { verifyCheckoutPayment } from "../../../../lib/registration/paymentService";
import { isSameOrigin } from "../../../../lib/security";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    if (!isSameOrigin(request)) {
      return Response.json({ success: false, message: "Forbidden." }, { status: 403 });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ success: false, message: "Invalid request." }, { status: 400 });
    }
    await connectDB();
    const { status, body: out } = await verifyCheckoutPayment(body);
    return Response.json(out, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[payment] verify unexpected error:", error?.message);
    return Response.json(
      {
        success: false,
        state: "pending",
        retryable: true,
        message: "We could not confirm your payment yet. Please do not pay again — it will be confirmed automatically.",
      },
      { status: 503 },
    );
  }
}
