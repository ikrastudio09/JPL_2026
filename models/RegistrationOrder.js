/**
 * RegistrationOrder
 * Binds a Razorpay order to the server-validated registration data that will be
 * finalized into a Player document ONLY after the payment is verified.
 *
 * Lifecycle (status):
 *   created  -> order created, checkout not completed yet
 *   attempted-> a payment attempt was seen (e.g. payment.failed webhook); retry allowed
 *   failed   -> last attempt failed; retry allowed on the same order
 *   paid     -> payment verified server-side (captured), Player not yet created
 *   completed-> Player created (terminal)
 *   expired  -> abandoned & cleaned up (terminal)
 */
import mongoose from "mongoose";

const StoredImageSchema = new mongoose.Schema(
  {
    url: String,
    public_id: String,
  },
  { _id: false },
);

const StoredDocumentSchema = new mongoose.Schema(
  {
    uploadId: String,
    public_id: String,
    format: String,
    bytes: Number,
  },
  { _id: false },
);

const RegistrationOrderSchema = new mongoose.Schema(
  {
    razorpayOrderId: { type: String, required: true, unique: true },
    receipt: { type: String, required: true, unique: true },
    amount: { type: Number, required: true }, // paise
    currency: { type: String, required: true, default: "INR" },
    status: {
      type: String,
      enum: ["created", "attempted", "failed", "paid", "completed", "expired"],
      default: "created",
    },

    // SHA-256 of a random token held only by the browser that created the order
    clientTokenHash: { type: String, required: true },

    // Validated registration fields (cleared once the Player document is created)
    registration: { type: mongoose.Schema.Types.Mixed },
    playerPhoto: StoredImageSchema,
    aadhaarFront: StoredDocumentSchema,
    aadhaarBack: StoredDocumentSchema,

    // Payment
    razorpayPaymentId: { type: String },
    paymentStatus: { type: String },
    paymentMethod: { type: String },
    paidAt: { type: Date },
    lastPaymentError: {
      code: String,
      description: String,
      reason: String,
      at: Date,
    },

    // Finalization
    player: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
    finalizeLockUntil: { type: Date, default: null },
    finalizeError: { type: String },
    completedAt: { type: Date },
    verifiedVia: { type: String },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

RegistrationOrderSchema.index({ status: 1, expiresAt: 1 });
RegistrationOrderSchema.index({ "aadhaarFront.uploadId": 1 });
RegistrationOrderSchema.index({ "aadhaarBack.uploadId": 1 });
RegistrationOrderSchema.index(
  { razorpayPaymentId: 1 },
  { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: "string" } } },
);

const RegistrationOrder =
  mongoose.models.RegistrationOrder ||
  mongoose.model("RegistrationOrder", RegistrationOrderSchema);

export default RegistrationOrder;
