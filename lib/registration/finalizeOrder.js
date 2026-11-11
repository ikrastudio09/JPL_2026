/**
 * Idempotent registration finalization.
 *
 * Called from three places — checkout verification (/api/payment/verify), the Razorpay
 * webhook, and reconciliation (status polling / cleanup). Whichever arrives first creates
 * the Player; every other call returns the same existing result.
 *
 * Safety layers (no multi-document transaction needed):
 *  1. Payment is ALWAYS confirmed through Razorpay's server API (status, order_id, amount, currency).
 *  2. Atomic conditional update moves the order to "paid" (first verified payment wins).
 *  3. A short lease lock (finalizeLockUntil) ensures only one worker creates the Player.
 *  4. Unique partial indexes on Player.payment.razorpayOrderId / razorpayPaymentId make a
 *     duplicate registration impossible even if a lock expires mid-flight.
 *  5. Before creating, we look up an existing Player for the order (crash recovery).
 */
import Player from "../../models/Player";
import RegistrationOrder from "../../models/RegistrationOrder";
import PendingUpload from "../../models/PendingUpload";
import { getRazorpay, describeRazorpayError } from "../razorpay";
import { createPlayerFromRegistration, toRegistrationSuccess } from "./createPlayer";

export const FinalizeCode = {
  OK: "OK",
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_MISMATCH: "PAYMENT_MISMATCH",
  PROCESSING: "PROCESSING",
  EXPIRED: "EXPIRED",
  ERROR: "ERROR",
};

const LOCK_MS = 30 * 1000;
const WAIT_FOR_OTHER_WORKER_MS = 6000;
const MUTABLE_STATES = ["created", "attempted", "failed", "paid"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function completedResult(order, alreadyProcessed = true) {
  const player = order.player ? await Player.findById(order.player) : null;
  return {
    code: FinalizeCode.OK,
    alreadyProcessed,
    player: player ? toRegistrationSuccess(player) : null,
  };
}

/** Find the payment to evaluate: the one given, or the best one on the order. */
async function fetchPayment(rzp, orderId, paymentId) {
  if (paymentId) return rzp.payments.fetch(paymentId);
  const list = await rzp.orders.fetchPayments(orderId);
  const items = Array.isArray(list?.items) ? list.items : [];
  return (
    items.find((p) => p.status === "captured") ||
    items.find((p) => p.status === "authorized") ||
    items.find((p) => p.status === "failed") ||
    items[0] ||
    null
  );
}

function mismatchReason(payment, order) {
  if (payment.order_id !== order.razorpayOrderId) return "order_id mismatch";
  if (Number(payment.amount) !== Number(order.amount)) return "amount mismatch";
  if (String(payment.currency || "").toUpperCase() !== String(order.currency).toUpperCase()) {
    return "currency mismatch";
  }
  return null;
}

/**
 * @param {{ razorpayOrderId: string, razorpayPaymentId?: string, source: "checkout"|"webhook"|"reconciliation" }} p
 */
export async function finalizeRegistrationOrder({ razorpayOrderId, razorpayPaymentId, source }) {
  let order = await RegistrationOrder.findOne({ razorpayOrderId });
  if (!order) return { code: FinalizeCode.ORDER_NOT_FOUND };
  if (order.status === "completed") return completedResult(order);

  // ── 1. Confirm payment with Razorpay (unless it was already verified & recorded) ──
  if (!(order.status === "paid" && order.razorpayPaymentId)) {
    let rzp;
    let payment;
    try {
      rzp = getRazorpay();
      payment = await fetchPayment(rzp, razorpayOrderId, razorpayPaymentId);
    } catch (err) {
      console.error(`[payment] Could not fetch payment for ${razorpayOrderId}: ${describeRazorpayError(err)}`);
      return { code: FinalizeCode.ERROR, retryable: true, message: "Could not confirm the payment with Razorpay." };
    }
    if (!payment) return { code: FinalizeCode.PAYMENT_PENDING };

    const mismatch = mismatchReason(payment, order);
    if (mismatch) {
      console.warn(`[payment] Rejected payment for ${razorpayOrderId}: ${mismatch} (source=${source})`);
      await RegistrationOrder.updateOne(
        { _id: order._id },
        { $set: { finalizeError: `Payment rejected: ${mismatch}` } },
      );
      return { code: FinalizeCode.PAYMENT_MISMATCH, message: "Payment details do not match this registration." };
    }

    if (order.status === "expired") {
      if (payment.status === "captured" || payment.status === "authorized") {
        console.error(
          `[payment] MANUAL_ACTION_REQUIRED: payment ${payment.id} received for expired order ${razorpayOrderId} — refund or contact the player.`,
        );
      }
      return { code: FinalizeCode.EXPIRED, message: "This registration session has expired." };
    }

    // Payments that were only authorized (auto-capture disabled) are captured server-side.
    if (payment.status === "authorized") {
      try {
        await rzp.payments.capture(payment.id, order.amount, order.currency);
      } catch (err) {
        console.warn(`[payment] Capture attempt for ${payment.id}: ${describeRazorpayError(err)}`);
      }
      try {
        payment = await rzp.payments.fetch(payment.id);
      } catch (err) {
        console.error(`[payment] Re-fetch after capture failed: ${describeRazorpayError(err)}`);
        return { code: FinalizeCode.ERROR, retryable: true, message: "Could not confirm the payment with Razorpay." };
      }
    }

    if (payment.status === "failed") {
      await RegistrationOrder.updateOne(
        { _id: order._id, status: { $in: ["created", "attempted", "failed"] } },
        {
          $set: {
            status: "failed",
            lastPaymentError: {
              code: payment.error_code,
              description: payment.error_description,
              reason: payment.error_reason,
              at: new Date(),
            },
          },
        },
      );
      return {
        code: FinalizeCode.PAYMENT_FAILED,
        message: payment.error_description || "The payment failed. Please try again.",
      };
    }

    if (payment.status === "refunded") {
      return { code: FinalizeCode.PAYMENT_FAILED, message: "This payment was refunded." };
    }

    if (payment.status !== "captured") {
      return { code: FinalizeCode.PAYMENT_PENDING };
    }

    // First verified payment wins; a different payment id can never overwrite it.
    const paidOrder = await RegistrationOrder.findOneAndUpdate(
      {
        _id: order._id,
        status: { $in: MUTABLE_STATES },
        $or: [{ razorpayPaymentId: { $exists: false } }, { razorpayPaymentId: null }, { razorpayPaymentId: payment.id }],
      },
      {
        $set: {
          status: "paid",
          razorpayPaymentId: payment.id,
          paymentStatus: payment.status,
          paymentMethod: payment.method,
          paidAt: payment.created_at ? new Date(payment.created_at * 1000) : new Date(),
          verifiedVia: source,
        },
      },
      { new: true },
    );

    if (!paidOrder) {
      const current = await RegistrationOrder.findById(order._id);
      if (current?.status === "completed") return completedResult(current);
      if (current?.razorpayPaymentId && current.razorpayPaymentId !== payment.id) {
        console.error(
          `[payment] MANUAL_ACTION_REQUIRED: second captured payment ${payment.id} on order ${razorpayOrderId} (first: ${current.razorpayPaymentId}). Refund the duplicate.`,
        );
        return current.status === "completed" ? completedResult(current) : { code: FinalizeCode.PROCESSING };
      }
      return { code: FinalizeCode.PROCESSING };
    }
    order = paidOrder;
  }

  // ── 2. Acquire the finalize lease ──
  const now = new Date();
  const locked = await RegistrationOrder.findOneAndUpdate(
    {
      _id: order._id,
      status: "paid",
      $or: [{ finalizeLockUntil: null }, { finalizeLockUntil: { $lt: now } }],
    },
    { $set: { finalizeLockUntil: new Date(now.getTime() + LOCK_MS) } },
    { new: true },
  );

  if (!locked) {
    // Another worker (webhook vs. checkout) is creating the Player right now — wait briefly.
    const deadline = Date.now() + WAIT_FOR_OTHER_WORKER_MS;
    while (Date.now() < deadline) {
      await sleep(300);
      const current = await RegistrationOrder.findById(order._id);
      if (current?.status === "completed") return completedResult(current);
    }
    return { code: FinalizeCode.PROCESSING };
  }

  // ── 3. Create the Player through the existing registration creation logic ──
  try {
    let player = await Player.findOne({ "payment.razorpayOrderId": razorpayOrderId });
    let created = false;

    if (!player) {
      const toDoc = (d) =>
        d?.public_id
          ? { public_id: d.public_id, format: d.format, bytes: d.bytes, delivery_type: "authenticated", uploadedAt: locked.createdAt }
          : undefined;
      const payment = {
        provider: "razorpay",
        razorpayOrderId,
        razorpayPaymentId: locked.razorpayPaymentId,
        receipt: locked.receipt,
        amount: locked.amount,
        currency: locked.currency,
        status: locked.paymentStatus || "captured",
        method: locked.paymentMethod,
        paidAt: locked.paidAt,
        verifiedVia: locked.verifiedVia || source,
      };
      try {
        player = await createPlayerFromRegistration(
          locked.registration,
          {
            playerPhoto: locked.playerPhoto,
            aadhaarFront: toDoc(locked.aadhaarFront),
            aadhaarBack: toDoc(locked.aadhaarBack),
          },
          payment,
        );
        created = true;
      } catch (err) {
        if (err?.code === 11000) {
          player = await Player.findOne({ "payment.razorpayOrderId": razorpayOrderId });
          if (!player) throw err;
        } else {
          throw err;
        }
      }
    }

    // ── 4. Mark complete & drop the temporary copy of personal data ──
    await RegistrationOrder.updateOne(
      { _id: locked._id },
      {
        $set: { status: "completed", player: player._id, completedAt: new Date(), finalizeLockUntil: null },
        $unset: {
          registration: 1,
          finalizeError: 1,
          "aadhaarFront.public_id": 1,
          "aadhaarBack.public_id": 1,
        },
      },
    );
    const uploadIds = [locked.aadhaarFront?.uploadId, locked.aadhaarBack?.uploadId].filter(Boolean);
    if (uploadIds.length) {
      await PendingUpload.updateMany(
        { uploadId: { $in: uploadIds } },
        { $set: { status: "used", usedBy: player._id } },
      );
    }

    if (created) {
      console.info(`[payment] Registration finalized for order ${razorpayOrderId} via ${source} (playerID ${player.playerID})`);
    }
    return { code: FinalizeCode.OK, alreadyProcessed: !created, player: toRegistrationSuccess(player) };
  } catch (err) {
    console.error(
      `[payment] MANUAL_ACTION_REQUIRED: payment verified but registration not created for order ${razorpayOrderId}: ${err?.message}`,
    );
    await RegistrationOrder.updateOne(
      { _id: locked._id },
      { $set: { finalizeLockUntil: null, finalizeError: String(err?.message || err).slice(0, 300) } },
    );
    return { code: FinalizeCode.ERROR, retryable: true, message: "Payment received, but we could not complete your registration yet." };
  }
}
