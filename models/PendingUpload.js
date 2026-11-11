/**
 * PendingUpload
 * An Aadhaar image uploaded (privately) before payment. It becomes "used" once the
 * registration is finalized; abandoned uploads are deleted by the cleanup routine.
 */
import mongoose from "mongoose";

const PendingUploadSchema = new mongoose.Schema(
  {
    uploadId: { type: String, required: true, unique: true },
    kind: { type: String, enum: ["aadhaar"], default: "aadhaar" },
    side: { type: String, enum: ["front", "back"], required: true },
    public_id: { type: String, required: true },
    format: { type: String },
    bytes: { type: Number },
    status: { type: String, enum: ["pending", "used"], default: "pending" },
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

PendingUploadSchema.index({ status: 1, expiresAt: 1 });

const PendingUpload =
  mongoose.models.PendingUpload || mongoose.model("PendingUpload", PendingUploadSchema);

export default PendingUpload;
