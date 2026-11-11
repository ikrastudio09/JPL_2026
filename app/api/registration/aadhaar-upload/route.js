/**
 * POST   /api/registration/aadhaar-upload   (multipart: side=front|back, file)
 * DELETE /api/registration/aadhaar-upload?uploadId=...
 *
 * Aadhaar images are uploaded independently of the main form (so each request stays
 * well under serverless body limits and the UI can show progress). The response only
 * contains an opaque, unguessable uploadId — never a URL.
 */
import connectDB from "../../../../lib/mongodb";
import PendingUpload from "../../../../models/PendingUpload";
import RegistrationOrder from "../../../../models/RegistrationOrder";
import { successResponse, errorResponse } from "../../../../utils/apiHelpers";
import {
  validateAadhaarFile,
  uploadPrivateDocument,
  deletePrivateDocument,
} from "../../../../lib/privateDocuments";
import { consumeLimit } from "../../../../lib/rateLimit";
import { ipKey, isSameOrigin, randomToken } from "../../../../lib/security";
import { isConfigured } from "../../../../lib/env";
import { AADHAAR_SIDES } from "../../../../constants/playerOptions";

export const dynamic = "force-dynamic";

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const UPLOADS_PER_HOUR_PER_IP = 30;
const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{20,64}$/;

const SIDE_LABEL = { front: "Aadhaar card front image", back: "Aadhaar card back image" };

export async function POST(request) {
  try {
    if (!isSameOrigin(request)) return errorResponse("Forbidden.", 403);
    if (!isConfigured("cloudinary")) {
      console.error("[aadhaar-upload] Cloudinary is not configured.");
      return errorResponse("Document upload is temporarily unavailable.", 503);
    }

    await connectDB();

    const limit = await consumeLimit(`aadhaar-upload:${ipKey(request)}`, UPLOADS_PER_HOUR_PER_IP, 3600 * 1000);
    if (!limit.allowed) {
      return errorResponse("Too many uploads. Please try again later.", 429);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return errorResponse("Invalid upload. Please choose the image again.", 400);
    }

    const side = String(formData.get("side") || "");
    if (!AADHAAR_SIDES.includes(side)) {
      return errorResponse("Invalid Aadhaar side.", 400);
    }
    const label = SIDE_LABEL[side];

    const checked = await validateAadhaarFile(formData.get("file"), label);
    if (checked.error) return errorResponse(checked.error, 400);

    let stored;
    try {
      stored = await uploadPrivateDocument(checked.buffer);
    } catch (err) {
      console.error("[aadhaar-upload] Cloudinary upload failed:", err?.message);
      return errorResponse(`${label} upload failed. Please try again.`, 502);
    }

    const uploadId = randomToken(24);
    try {
      await PendingUpload.create({
        uploadId,
        side,
        public_id: stored.public_id,
        format: stored.format,
        bytes: stored.bytes,
        expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
      });
    } catch (err) {
      await deletePrivateDocument(stored.public_id);
      console.error("[aadhaar-upload] Failed to record upload:", err?.message);
      return errorResponse(`${label} upload failed. Please try again.`, 500);
    }

    return successResponse({ uploadId, side }, `${label} uploaded.`, 201);
  } catch (error) {
    console.error("[aadhaar-upload] Unexpected error:", error?.message);
    return errorResponse("Upload failed due to an unexpected error.", 500);
  }
}

/**
 * Remove an upload the user replaced or removed before submitting.
 * The uploadId itself is the bearer credential. Uploads already bound to an
 * active payment order are left for the cleanup routine.
 */
export async function DELETE(request) {
  try {
    if (!isSameOrigin(request)) return errorResponse("Forbidden.", 403);
    const uploadId = new URL(request.url).searchParams.get("uploadId") || "";
    if (!UPLOAD_ID_RE.test(uploadId)) return successResponse({}, "Removed.");

    await connectDB();
    const upload = await PendingUpload.findOne({ uploadId, status: "pending" }).lean();
    if (!upload) return successResponse({}, "Removed.");

    const inUse = await RegistrationOrder.exists({
      status: { $in: ["created", "attempted", "failed", "paid"] },
      $or: [{ "aadhaarFront.uploadId": uploadId }, { "aadhaarBack.uploadId": uploadId }],
    });
    if (inUse) return successResponse({}, "Removed.");

    const del = await PendingUpload.deleteOne({ uploadId, status: "pending" });
    if (del.deletedCount === 1) await deletePrivateDocument(upload.public_id);
    return successResponse({}, "Removed.");
  } catch (error) {
    console.error("[aadhaar-upload] Delete error:", error?.message);
    return successResponse({}, "Removed.");
  }
}
