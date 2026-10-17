import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError, blockChildren } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { isMissingTable } from "@/lib/moderation/blocks";
import { parseDeviceRegistration, parseDeviceRemoval } from "@/lib/native/push-token";

/**
 * Push-notification devices for the signed-in user (iOS app; migration 078).
 *
 * The app calls POST after the player turns notifications on in Settings
 * (primer first, then the iOS prompt), and DELETE when they turn them off.
 * Rows are written with the service role; RLS on push_devices only lets an
 * owner read their own rows. Sending notifications (APNs) is not built yet.
 *
 * Child accounts can't register: a device token is a persistent identifier.
 */

const NOT_READY = "Notifications aren't available yet. Please try again later.";

/** POST { token, platform: "ios", app_version? } → 201 { registered: true } */
export async function POST(request: NextRequest) {
  try {
    assertTrustedOrigin(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    blockChildren(user, "notifications");
    await generalLimiter.check(request, user.id);

    const parsed = parseDeviceRegistration(await request.json().catch(() => null));
    if (!parsed.ok) throw new ApiError(400, parsed.error);
    const { token, platform, app_version } = parsed.value;

    const supabase = await createSupabaseServiceClient();
    const now = new Date().toISOString();
    // One row per token: a phone that signs into another account moves to it.
    const { error } = await supabase
      .from("push_devices")
      .upsert(
        { user_id: user.id, token, platform, app_version, last_seen_at: now, updated_at: now },
        { onConflict: "token" }
      );
    if (error) {
      if (isMissingTable(error)) throw new ApiError(503, NOT_READY);
      throw new ApiError(500, "We couldn't turn on notifications for this device.");
    }
    return Response.json({ registered: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE { token } → { removed: true }. Only removes the caller's own row. */
export async function DELETE(request: NextRequest) {
  try {
    assertTrustedOrigin(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await generalLimiter.check(request, user.id);

    const parsed = parseDeviceRemoval(await request.json().catch(() => null));
    if (!parsed.ok) throw new ApiError(400, parsed.error);

    const supabase = await createSupabaseServiceClient();
    const { error } = await supabase
      .from("push_devices")
      .delete()
      .eq("user_id", user.id)
      .eq("token", parsed.value.token);
    if (error && !isMissingTable(error)) {
      throw new ApiError(500, "We couldn't turn off notifications for this device.");
    }
    return Response.json({ removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
