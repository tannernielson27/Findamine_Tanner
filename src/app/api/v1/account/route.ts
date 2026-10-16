import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { errorResponse, ApiError } from "@/lib/utils/api-auth";
import { authLimiter } from "@/lib/utils/rate-limit";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import {
  AccountNotFoundError,
  DELETE_CONFIRMATION,
  deleteAccount,
  deleteAuthUser,
  getCallerAuthId,
} from "@/lib/services/account-deletion";

/**
 * DELETE /api/v1/account  body: { "confirm": "DELETE" }
 *
 * Permanently deletes the caller's account, immediately (App Store 5.1.1(v)).
 * See src/lib/services/account-deletion.ts and migration 071 for what is
 * deleted, what is kept de-identified, and why.
 *
 * Responses:
 *  200 { ok: true, deleted_accounts }  — done; session cookies are cleared.
 *  400 — missing confirmation.  401 — not signed in.  403 — closed account.
 *  409 — the caller is the last active admin (another admin must exist first).
 *  500 — nothing changed (database step failed), or the data is gone but the
 *        sign-in could not be removed; calling again finishes the job.
 */
export async function DELETE(request: NextRequest) {
  try {
    assertTrustedOrigin(request);

    const authId = await getCallerAuthId(request);
    if (!authId) throw new ApiError(401, "Not authenticated");
    await authLimiter.check(request, authId);

    const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
    if (body?.confirm !== DELETE_CONFIRMATION) {
      throw new ApiError(400, `Type ${DELETE_CONFIRMATION} to confirm account deletion.`);
    }

    const supabase = await createSupabaseServiceClient();
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("id, deleted_at, role")
      .eq("auth_id", authId)
      .maybeSingle();
    if (profileError) throw new ApiError(500, "We couldn't delete your account. Nothing was changed. Please try again.");

    if (profile?.deleted_at) {
      // Closed by an admin: the account's data is not the caller's to purge
      // here (moderation records); support handles these.
      throw new ApiError(403, "This account has been closed. Please contact support to delete it.");
    }

    if (!profile) {
      // No app profile: either a sign-in left over from an earlier deletion
      // whose last step failed, or one whose profile was never created.
      // Either way only the auth user is left to remove.
      if (!(await deleteAuthUser(supabase, authId))) {
        throw new ApiError(500, "We couldn't finish deleting your account. Please try again.");
      }
      return signedOut(request, { ok: true, deleted_accounts: 1 });
    }

    if (profile.role === "admin") await assertNotLastAdmin(supabase, profile.id);

    let result;
    try {
      result = await deleteAccount(supabase, profile.id);
    } catch (error) {
      if (error instanceof AccountNotFoundError) {
        throw new ApiError(404, "Account not found.");
      }
      throw new ApiError(500, "We couldn't delete your account. Nothing was changed. Please try again.");
    }

    if (result.authFailures.includes(authId)) {
      throw new ApiError(
        500,
        "Your data has been deleted, but we couldn't finish closing your sign-in. Please try again."
      );
    }

    return signedOut(request, { ok: true, deleted_accounts: result.accounts.length });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Refuse to delete the only remaining active admin: nobody could then run
 * moderation, review hunts or grant the role again from inside the app.
 */
async function assertNotLastAdmin(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  userId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .is("deleted_at", null)
    .neq("id", userId)
    .limit(1);
  if (error) {
    throw new ApiError(500, "We couldn't delete your account. Nothing was changed. Please try again.");
  }
  if (!data || data.length === 0) {
    throw new ApiError(
      409,
      "You're the only admin. Make someone else an admin before deleting your account, so Findamine still has someone to run moderation."
    );
  }
}

/** JSON response that also expires the Supabase session cookies. */
function signedOut(request: NextRequest, payload: Record<string, unknown>): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const { name } of request.cookies.getAll()) {
    if (/^sb-.+-auth-token(?:\.\d+)?$/.test(name)) {
      headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax`);
    }
  }
  return new Response(JSON.stringify(payload), { status: 200, headers });
}
