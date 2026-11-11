/**
 * POST /api/payment/webhook — Razorpay webhook receiver.
 * Signature is verified against the RAW body with RAZORPAY_WEBHOOK_SECRET.
 * Events: payment.captured, order.paid, payment.failed
 */
import connectDB from "../../../../lib/mongodb";
import { handleRazorpayWebhook } from "../../../../lib/registration/paymentService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request) {
  try {
    const rawBody = await request.text(); // must be the exact bytes Razorpay signed
    if (rawBody.length > MAX_BODY_BYTES) {
      return Response.json({ success: false, message: "Payload too large." }, { status: 413 });
    }
    await connectDB();
    const { status, body } = await handleRazorpayWebhook(rawBody, request.headers);
    return Response.json(body, { status });
  } catch (error) {
    console.error("[webhook] unexpected error:", error?.message);
    // Non-2xx → Razorpay will retry delivery
    return Response.json({ success: false, message: "Webhook processing failed." }, { status: 500 });
  }
}
