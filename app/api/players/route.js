/**
 * GET /api/players
 * Fetch all registered players with pagination, advanced search, and filtering
 * Returns full player data matching the updated Player model (Admin only)
 */
import connectDB from "../../../lib/mongodb";
import Player from "../../../models/Player";
import { successResponse, errorResponse } from "../../../utils/apiHelpers";
import { requireAdmin } from "../../../lib/auth/adminSession";
import { ADMIN_PLAYER_FIELDS, toAdminPlayer } from "../../../lib/playerProjection";

const MAX_LIMIT = 10000; // the admin Excel export requests all players in one call

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;

    await connectDB();

    const { searchParams } = new URL(request.url);

    // Pagination
    const pageRaw = parseInt(searchParams.get("page") || "1", 10);
    const limitRaw = parseInt(searchParams.get("limit") || "20", 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : 20;
    const skip = (page - 1) * limit;

    // Filters
    const status = searchParams.get("status"); // pending | approved | rejected
    const playerType = searchParams.get("playerType"); // Batsman | Bowler | All Rounder
    const playingStyle = searchParams.get("playingStyle"); // e.g. Right Arm Batting
    const search = searchParams.get("search"); // name, phone, transactionId, playerID, tShirtNumber
    const playerCategory = searchParams.get("playerCategory");
    const playerPool = searchParams.get("playerPool");
    const profession = searchParams.get("profession");

    // Sorting
    const sortField = searchParams.get("sortField") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") === "asc" ? 1 : -1;

    // Build query
    const query = {};

    if (status) query.status = status;
    if (playerType) query.playerType = playerType;
    if (playingStyle) query.playingStyle = { $in: [playingStyle] };
    if (playerCategory) query.playerCategory = playerCategory;
    if (profession) query.profession = profession;
    if (playerPool !== null && playerPool !== undefined && playerPool !== "") {
      query.playerPool = Number(playerPool);
    }

    if (search && search.trim()) {
      const trimmedSearch = search.trim().slice(0, 100);
      const safePattern = escapeRegex(trimmedSearch);
      const orConditions = [
        { playerName: { $regex: safePattern, $options: "i" } },
        { playerPhone: { $regex: safePattern, $options: "i" } },
        { transactionId: { $regex: safePattern, $options: "i" } },
        { "payment.razorpayPaymentId": { $regex: safePattern, $options: "i" } },
        { "payment.razorpayOrderId": { $regex: safePattern, $options: "i" } },
      ];

      // If search is numeric, also search playerID and tShirtNumber
      const numericVal = Number(trimmedSearch);
      if (trimmedSearch !== "" && !isNaN(numericVal)) {
        orConditions.push({ playerID: numericVal });
        orConditions.push({ tShirtNumber: numericVal });
      }

      query.$or = orConditions;
    }

    // Allowed sort fields (whitelist to prevent injection)
    const allowedSortFields = [
      "createdAt",
      "updatedAt",
      "playerID",
      "playerName",
      "dateOfBirth",
      "bloodGroup",
      "profession",
      "tShirtNumber",
      "Age",
      "status",
      "playerType",
      "playerPool",
    ];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : "createdAt";

    // Execute query with pagination
    const [playersRaw, total] = await Promise.all([
      Player.find(query)
        .select(ADMIN_PLAYER_FIELDS)
        // _id tie-breaker keeps pagination stable when many records share a sort value
        .sort({ [safeSortField]: sortOrder, _id: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      Player.countDocuments(query),
    ]);

    // Attach calculated age dynamically while preserving historical Age fallback
    const players = playersRaw.map(toAdminPlayer);

    return successResponse({
      players,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      filters: { status, playerType, playingStyle, playerCategory, playerPool, profession, search },
    });
  } catch (error) {
    console.error("Fetch players error:", error);
    return errorResponse("Failed to fetch players.", 500);
  }
}