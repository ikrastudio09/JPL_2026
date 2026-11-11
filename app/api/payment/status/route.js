/**
 * POST /api/payment/status
 * Body: { orderId, clientToken }
 * Lets the browser poll for the outcome when verification is pending (and reconciles
 * with Razorpay if the checkout callback was lost).
 */
import connectDB from "../../../../lib/mongodb";
import { getOrderStatus } from "../../../../lib/registration/paymentService";
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
    const { status, body: out } = await getOrderStatus(body);
    return Response.json(out, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[payment] status unexpected error:", error?.message);
    return Response.json(
      { success: false, state: "pending", retryable: true, message: "Could not check payment status." },
      { status: 503 },
    );
  }
}
