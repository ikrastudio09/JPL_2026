/**
 * GET /api/players/stats  (Admin only)
 * Dashboard summary counts computed with a single aggregation on the indexed `status`
 * field — replaces downloading every player record just to count them.
 * Not cached: counts must reflect status updates immediately.
 */
import connectDB from "../../../../lib/mongodb";
import Player from "../../../../models/Player";
import { successResponse, errorResponse } from "../../../../utils/apiHelpers";
import { requireAdmin } from "../../../../lib/auth/adminSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;

    await connectDB();
    const groups = await Player.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);

    const stats = { total: 0, pending: 0, approved: 0, rejected: 0 };
    for (const g of groups) {
      stats.total += g.count;
      if (g._id in stats && g._id !== "total") stats[g._id] = g.count;
    }
    return successResponse({ stats });
  } catch (error) {
    console.error("Fetch player stats error:", error?.message);
    return errorResponse("Failed to fetch player statistics.", 500);
  }
}
