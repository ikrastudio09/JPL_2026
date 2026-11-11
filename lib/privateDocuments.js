/**
 * Private document (Aadhaar) storage helpers.
 *
 * - Content is validated by magic bytes (JPEG / PNG only) — the browser-supplied
 *   MIME type and filename are never trusted on their own.
 * - Files are stored in Cloudinary with delivery type "authenticated": they cannot be
 *   fetched through a plain public URL.
 * - Public IDs are random UUIDs (no user-controlled path segments → no path traversal).
 * - Admins view files through /api/players/[id]/aadhaar/[side], which fetches a
 *   short-lived signed download URL server-side and streams the bytes.
 */
import crypto from "crypto";
import cloudinary from "./cloudinary";
import {
  AADHAAR_MAX_IMAGE_SIZE_BYTES,
  AADHAAR_ALLOWED_TYPES,
  AADHAAR_ALLOWED_EXTENSIONS,
} from "../constants/playerOptions";

export const AADHAAR_FOLDER = "cricket_tournament/aadhaar_private";
const DELIVERY_TYPE = "authenticated";

/** Detect the real image type from file signature. Returns "jpg" | "png" | null. */
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 8) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => buffer[i] === b)) return "png";
  return null;
}

/**
 * Validate an uploaded Aadhaar image File (from request.formData()).
 * @returns {Promise<{ error?: string, buffer?: Buffer, format?: string }>}
 */
export async function validateAadhaarFile(file, label) {
  if (!file || typeof file !== "object" || typeof file.size !== "number" || typeof file.arrayBuffer !== "function") {
    return { error: `${label} is required.` };
  }
  if (file.size === 0) return { error: `${label} is empty. Please upload a valid image file.` };
  if (file.size > AADHAAR_MAX_IMAGE_SIZE_BYTES) {
    const mb = Math.round(AADHAAR_MAX_IMAGE_SIZE_BYTES / (1024 * 1024));
    return { error: `${label} size exceeds the limit of ${mb} MB.` };
  }
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const extOk = AADHAAR_ALLOWED_EXTENSIONS.some((e) => name.endsWith(e));
  if (!AADHAAR_ALLOWED_TYPES.includes(mime) || !extOk) {
    return { error: `${label} must be a JPG, JPEG, or PNG image.` };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > AADHAAR_MAX_IMAGE_SIZE_BYTES) {
    return { error: `${label} size exceeds the allowed limit.` };
  }
  const detected = detectImageType(buffer);
  if (!detected) {
    return { error: `${label} is not a valid JPG or PNG image.` };
  }
  const declared = mime === "image/png" ? "png" : "jpg";
  if (detected !== declared) {
    return { error: `${label} file content does not match its file type.` };
  }
  return { buffer, format: detected };
}

/** Upload validated bytes as a private (authenticated) Cloudinary asset. */
export async function uploadPrivateDocument(buffer) {
  const publicIdLeaf = crypto.randomUUID();
  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: AADHAAR_FOLDER,
          public_id: publicIdLeaf,
          type: DELIVERY_TYPE,
          resource_type: "image",
          allowed_formats: ["jpg", "png"],
          overwrite: false,
          unique_filename: false,
          use_filename: false,
        },
        (error, res) => (error ? reject(error) : resolve(res)),
      )
      .end(buffer);
  });
  return {
    public_id: result.public_id,
    format: result.format,
    bytes: result.bytes,
  };
}

export async function deletePrivateDocument(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      type: DELIVERY_TYPE,
      resource_type: "image",
      invalidate: true,
    });
  } catch (err) {
    // Do not log the public id (it identifies a personal document)
    console.error("[documents] Failed to delete private document:", err?.message);
  }
}

/** Short-lived (60 s) signed API download URL — used server-side only, never sent to clients. */
export function privateDownloadUrl(publicId, format) {
  return cloudinary.utils.private_download_url(publicId, format || "jpg", {
    type: DELIVERY_TYPE,
    resource_type: "image",
    expires_at: Math.floor(Date.now() / 1000) + 60,
  });
}
