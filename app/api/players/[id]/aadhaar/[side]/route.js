/**
 * GET /api/players/[id]/aadhaar/[side]   (side = front | back)   — Admin only
 * Streams the private Aadhaar image. The Cloudinary signed download URL is generated
 * server-side with a 60-second expiry and is never sent to the browser.
 */
import mongoose from "mongoose";
import connectDB from "../../../../../../lib/mongodb";
import Player from "../../../../../../models/Player";
import { requireAdmin } from "../../../../../../lib/auth/adminSession";
import { privateDownloadUrl } from "../../../../../../lib/privateDocuments";
import { errorResponse } from "../../../../../../utils/apiHelpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FIELD = { front: "aadhaarFrontImage", back: "aadhaarBackImage" };
const CONTENT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

export async function GET(request, { params }) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;

    const { id, side } = await params;
    const field = FIELD[side];
    if (!field || !mongoose.isValidObjectId(id)) return errorResponse("Not found.", 404);

    await connectDB();
    const player = await Player.findById(id).select(`+${field}`).lean();
    const doc = player?.[field];
    if (!doc?.public_id) return errorResponse("Aadhaar image not available for this player.", 404);

    const upstream = await fetch(privateDownloadUrl(doc.public_id, doc.format), {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!upstream.ok) {
      console.error(`[aadhaar] Upstream fetch failed with status ${upstream.status}`);
      return errorResponse("Could not load the document.", 502);
    }

    const contentType = CONTENT_TYPES[String(doc.format || "").toLowerCase()] || "image/jpeg";
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="aadhaar-${side}.${contentType === "image/png" ? "png" : "jpg"}"`,
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[aadhaar] view error:", error?.message);
    return errorResponse("Could not load the document.", 500);
  }
}
