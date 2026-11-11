/**
 * Cleanup of abandoned registrations (no cron needed — runs opportunistically,
 * at most once every 10 minutes per server instance, with a small work budget).
 *
 *  - Expired unpaid orders: re-checked with Razorpay first. If a payment actually went
 *    through, the registration is finalized instead of deleted. Otherwise the temporary
 *    personal data and player photo are removed and the order is marked "expired".
 *  - Expired Aadhaar uploads that are not bound to any active order are deleted from
 *    Cloudinary and MongoDB (no unnecessary retention of identity documents).
 */
import RegistrationOrder from "../../models/RegistrationOrder";
import PendingUpload from "../../models/PendingUpload";
import { deleteFromCloudinary } from "../cloudinary";
import { deletePrivateDocument } from "../privateDocuments";
import { finalizeRegistrationOrder, FinalizeCode } from "./finalizeOrder";

const INTERVAL_MS = 10 * 60 * 1000;
const ORDER_BUDGET = 5;
const UPLOAD_BUDGET = 10;
const ACTIVE_ORDER_STATES = ["created", "attempted", "failed", "paid"];

const state = globalThis.__jplCleanupState || (globalThis.__jplCleanupState = { lastRun: 0, running: false });

export async function runCleanupIfDue() {
  if (state.running || Date.now() - state.lastRun < INTERVAL_MS) return;
  state.running = true;
  state.lastRun = Date.now();
  try {
    await runCleanup();
  } catch (err) {
    console.error("[cleanup] failed:", err?.message);
  } finally {
    state.running = false;
  }
}

export async function runCleanup() {
  const now = new Date();
  const summary = { ordersExpired: 0, ordersFinalized: 0, uploadsDeleted: 0 };

  const staleOrders = await RegistrationOrder.find({
    status: { $in: ["created", "attempted", "failed"] },
    expiresAt: { $lt: now },
  })
    .limit(ORDER_BUDGET)
    .lean();

  for (const order of staleOrders) {
    const result = await finalizeRegistrationOrder({
      razorpayOrderId: order.razorpayOrderId,
      source: "reconciliation",
    });
    if (result.code === FinalizeCode.OK) {
      summary.ordersFinalized++;
      continue;
    }
    // Only expire when Razorpay confirms there is no successful/pending payment
    if (![FinalizeCode.PAYMENT_PENDING, FinalizeCode.PAYMENT_FAILED].includes(result.code)) continue;

    const res = await RegistrationOrder.updateOne(
      { _id: order._id, status: { $in: ["created", "attempted", "failed"] } },
      { $set: { status: "expired" }, $unset: { registration: 1 } },
    );
    if (res.modifiedCount === 1) {
      if (order.playerPhoto?.public_id) await deleteFromCloudinary(order.playerPhoto.public_id).catch(() => {});
      summary.ordersExpired++;
    }
  }

  const staleUploads = await PendingUpload.find({ status: "pending", expiresAt: { $lt: now } })
    .limit(UPLOAD_BUDGET)
    .lean();

  for (const upload of staleUploads) {
    const inUse = await RegistrationOrder.exists({
      status: { $in: ACTIVE_ORDER_STATES },
      $or: [{ "aadhaarFront.uploadId": upload.uploadId }, { "aadhaarBack.uploadId": upload.uploadId }],
    });
    if (inUse) continue;
    const del = await PendingUpload.deleteOne({ _id: upload._id, status: "pending" });
    if (del.deletedCount === 1) {
      await deletePrivateDocument(upload.public_id);
      summary.uploadsDeleted++;
    }
  }

  if (summary.ordersExpired || summary.ordersFinalized || summary.uploadsDeleted) {
    console.info("[cleanup]", JSON.stringify(summary));
  }
  return summary;
}
