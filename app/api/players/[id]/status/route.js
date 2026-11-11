/**
 * PATCH /api/players/[id]/status
 * Update a player's registration status (pending | approved | rejected)
 * (Admin only — status update logic unchanged)
 */
import connectDB from "../../../../../lib/mongodb";
import Player from "../../../../../models/Player";
import { successResponse, errorResponse } from "../../../../../utils/apiHelpers";
import { requireAdmin } from "../../../../../lib/auth/adminSession";
import { ADMIN_PLAYER_FIELDS, toAdminPlayer } from "../../../../../lib/playerProjection";

export async function PATCH(request, { params }) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;

    await connectDB();

    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    const VALID_STATUSES = ["pending", "approved", "rejected"];

    if (!status || !VALID_STATUSES.includes(status)) {
      return errorResponse(
        `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
        400,
      );
    }

    const playerRaw = await Player.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true },
    )
      .select(ADMIN_PLAYER_FIELDS)
      .lean();

    if (!playerRaw) {
      return errorResponse("Player not found.", 404);
    }

    const player = toAdminPlayer(playerRaw);

    return successResponse({ player }, "Player status updated successfully.");
  } catch (error) {
    console.error("Update player status error:", error);
    return errorResponse("Failed to update player status.", 500);
  }
}
