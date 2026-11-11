/**
 * PATCH /api/players/[id]/pool
 * Update a player's pool (Admin only — pool update logic unchanged)
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
    const { playerPool } = body;

    const playerRaw = await Player.findByIdAndUpdate(
      id,
      { playerPool },
      { new: true, runValidators: true },
    )
      .select(ADMIN_PLAYER_FIELDS)
      .lean();

    if (!playerRaw) {
      return errorResponse("Player not found.", 404);
    }

    const player = toAdminPlayer(playerRaw);

    return successResponse({ player }, "Player pool updated successfully.");
  } catch (error) {
    console.error("Update player pool error:", error);
    return errorResponse("Failed to update player pool.", 500);
  }
}
