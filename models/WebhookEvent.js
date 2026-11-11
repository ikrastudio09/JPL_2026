/**
 * WebhookEvent — de-duplicates Razorpay webhook deliveries (x-razorpay-event-id).
 * Kept for 30 days.
 */
import mongoose from "mongoose";

const WebhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  event: { type: String },
  razorpayOrderId: { type: String },
  status: { type: String, enum: ["received", "processed"], default: "received" },
  result: { type: String },
  receivedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 3600 * 1000) },
});

WebhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const WebhookEvent =
  mongoose.models.WebhookEvent || mongoose.model("WebhookEvent", WebhookEventSchema);

export default WebhookEvent;
