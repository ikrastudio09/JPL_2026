/**
 * GET /api/admin/auth/me — returns the current admin session (or 401).
 */
import { requireAdmin } from "../../../../../lib/auth/adminSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  return Response.json(
    {
      success: true,
      data: {
        authenticated: true,
        username: auth.session.username,
        expiresAt: auth.session.expiresAt,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
