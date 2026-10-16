import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/utils/logger";

/**
 * In-app account deletion (App Store guideline 5.1.1(v)).
 *
 * The database half is public.delete_user_account (migration 071): in one
 * transaction it deletes the person's own data, scrubs the users row to a
 * "Deleted user" placeholder that shared content (hunts, rosters...) can keep
 * pointing at, and returns the auth users and storage objects to remove. For a
 * parent it also covers the child/teen accounts they created. This module does
 * the parts SQL should not: storage objects and Supabase auth users.
 */

type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** The word the person types to confirm; the request body must echo it. */
export const DELETE_CONFIRMATION = "DELETE";

/** Buckets holding personal uploads, all written under `<users.id>/...`. */
export const PERSONAL_BUCKETS = ["geo-selfies", "avatars", "captures", "challenge-audio"] as const;

const STORAGE_PAGE = 1000;
const STORAGE_MAX_PAGES = 20;

export interface DeletedAccount {
  user_id: string;
  auth_id: string | null;
}

export interface StorageObject {
  bucket: string;
  path: string;
}

export interface AccountDeletionResult {
  /** Every account removed, the caller's own last. */
  accounts: DeletedAccount[];
  /** Auth users that could not be deleted (their app data is already gone). */
  authFailures: string[];
  /** Storage objects that could not be removed. */
  storageFailures: number;
}

export class AccountNotFoundError extends Error {
  constructor() {
    super("account_not_found");
    this.name = "AccountNotFoundError";
  }
}

/**
 * The Supabase auth user id of the caller (Bearer token for mobile, session
 * cookie for web), or null. Unlike getAuthUser this does not require a live
 * users row, so a deletion that removed the data but not the auth user can be
 * finished by asking again.
 */
export async function getCallerAuthId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const serviceClient = await createSupabaseServiceClient();
    const { data } = await serviceClient.auth.getUser(authHeader.slice(7));
    return data.user?.id ?? null;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // The route clears the session cookies itself after deleting.
        },
      },
    }
  );
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function parseRpcResult(data: unknown): { accounts: DeletedAccount[]; storage: StorageObject[] } {
  const value = (data ?? {}) as { accounts?: unknown; storage?: unknown };
  const accounts = Array.isArray(value.accounts) ? (value.accounts as DeletedAccount[]) : [];
  const storage = Array.isArray(value.storage)
    ? (value.storage as StorageObject[]).filter(
        (o) => o && typeof o.bucket === "string" && typeof o.path === "string" && o.path.length > 0
      )
    : [];
  return { accounts, storage };
}

async function removeObjects(supabase: Db, bucket: string, paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (!error) return 0;
  logger.error("account.delete.storage_remove_failed", { bucket, count: paths.length, error: error.message });
  return paths.length;
}

/** Remove everything under `<userId>/` in a personal bucket. */
async function removeUserFolder(supabase: Db, bucket: string, userId: string): Promise<number> {
  let failures = 0;
  for (let page = 0; page < STORAGE_MAX_PAGES; page++) {
    const { data, error } = await supabase.storage.from(bucket).list(userId, { limit: STORAGE_PAGE });
    // A bucket that was never created simply has nothing to remove.
    if (error || !data || data.length === 0) return failures;
    const paths = data.filter((f) => f.name).map((f) => `${userId}/${f.name}`);
    const failed = await removeObjects(supabase, bucket, paths);
    failures += failed;
    if (failed > 0 || data.length < STORAGE_PAGE) return failures;
  }
  return failures;
}

async function removeStorage(
  supabase: Db,
  objects: StorageObject[],
  userIds: string[]
): Promise<number> {
  let failures = 0;

  const byBucket = new Map<string, Set<string>>();
  for (const { bucket, path } of objects) {
    byBucket.set(bucket, (byBucket.get(bucket) ?? new Set()).add(path));
  }
  for (const [bucket, paths] of byBucket) {
    failures += await removeObjects(supabase, bucket, [...paths]);
  }

  // Files whose rows were never written (e.g. an upload whose insert failed).
  for (const bucket of PERSONAL_BUCKETS) {
    for (const userId of userIds) {
      failures += await removeUserFolder(supabase, bucket, userId);
    }
  }
  return failures;
}

/** Delete an auth user, retrying once. Returns whether it is gone. */
export async function deleteAuthUser(supabase: Db, authId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.auth.admin.deleteUser(authId);
    // Already gone counts as done (a retry after a partial failure).
    if (!error || error.status === 404) return true;
    if (attempt === 1) {
      logger.error("account.delete.auth_delete_failed", { authId, error: error.message });
    }
  }
  return false;
}

/**
 * Delete the account `userId` (and, for a parent, their child accounts).
 * Throws AccountNotFoundError when there is no live account, and an Error when
 * the database step fails, in which case nothing was changed.
 */
export async function deleteAccount(supabase: Db, userId: string): Promise<AccountDeletionResult> {
  const { data, error } = await supabase.rpc("delete_user_account", { p_user_id: userId });
  if (error) {
    if (error.code === "P0002") throw new AccountNotFoundError();
    logger.error("account.delete.db_failed", { userId, code: error.code, error: error.message });
    throw new Error("account deletion failed");
  }

  const { accounts, storage } = parseRpcResult(data);

  const storageFailures = await removeStorage(
    supabase,
    storage,
    accounts.map((a) => a.user_id)
  );

  const authFailures: string[] = [];
  for (const account of accounts) {
    if (!account.auth_id) continue; // seed/demo rows have no auth user
    if (!(await deleteAuthUser(supabase, account.auth_id))) authFailures.push(account.auth_id);
  }

  logger.info("account.delete.completed", {
    userId,
    accounts: accounts.length,
    storageFailures,
    authFailures: authFailures.length,
  });

  return { accounts, authFailures, storageFailures };
}
