/**
 * User blocking and per-viewer hiding (App Store guideline 1.2).
 *
 * A block is one-directional in storage (user_blocks: blocker → blocked, see
 * migration 072) but mutual in effect: neither person sees the other's chat
 * messages, kudos, wall posts or shoutouts, and neither can send the other
 * kudos, shoutouts or friend requests.
 *
 * Reads fail open with a logged error when user_blocks is missing (migration
 * 072 not applied yet) so chat and kudos keep working; writes surface it.
 */

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/utils/api-auth";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

export interface BlockSets {
  /** People the viewer blocked. */
  blocked: Set<string>;
  /** People who blocked the viewer. */
  blockedBy: Set<string>;
}

interface BlockRow {
  blocker_id: string;
  blocked_id: string;
}

/** PostgREST / Postgres codes for "that table does not exist". */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MISSING_TABLE_CODES.has(error.code);
}

/** Split block rows into the viewer's two directions. Pure, for tests. */
export function toBlockSets(rows: BlockRow[], viewerId: string): BlockSets {
  const blocked = new Set<string>();
  const blockedBy = new Set<string>();
  for (const r of rows) {
    if (r.blocker_id === viewerId && r.blocked_id !== viewerId) blocked.add(r.blocked_id);
    else if (r.blocked_id === viewerId && r.blocker_id !== viewerId) blockedBy.add(r.blocker_id);
  }
  return { blocked, blockedBy };
}

/** Everyone whose content the viewer should not see (either direction). */
export function hiddenUserIds(sets: BlockSets): Set<string> {
  return new Set([...sets.blocked, ...sets.blockedBy]);
}

/** Drop rows authored by a hidden user. Pure, for tests. */
export function withoutAuthors<R>(rows: R[], authorOf: (row: R) => string | null | undefined, hidden: Set<string>): R[] {
  if (hidden.size === 0) return rows;
  return rows.filter((r) => {
    const author = authorOf(r);
    return !author || !hidden.has(author);
  });
}

export async function getBlockSets(supabase: ServiceClient, viewerId: string): Promise<BlockSets> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
  if (error) {
    console.error(
      isMissingTable(error)
        ? "user_blocks table missing; apply migration 072. Treating as no blocks."
        : `Failed to read user_blocks: ${error.message}`
    );
    return { blocked: new Set(), blockedBy: new Set() };
  }
  return toBlockSets((data || []) as BlockRow[], viewerId);
}

/** True when either person has blocked the other. */
export async function isBlockedBetween(supabase: ServiceClient, a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .in("blocker_id", [a, b])
    .in("blocked_id", [a, b])
    .limit(2);
  if (error) {
    if (!isMissingTable(error)) console.error(`Failed to read user_blocks: ${error.message}`);
    return false;
  }
  return (data || []).some((r: BlockRow) => r.blocker_id !== r.blocked_id);
}

/** Throw 403 when either person has blocked the other. */
export async function assertNotBlocked(
  supabase: ServiceClient,
  senderId: string,
  recipientId: string,
  message = "You can't interact with this player."
): Promise<void> {
  if (await isBlockedBetween(supabase, senderId, recipientId)) {
    throw new ApiError(403, message);
  }
}

/**
 * Ids (from `ids`) of entities of one type the viewer has reported. Reported
 * items are hidden from the reporter straight away, before anyone reviews them.
 */
export async function getReportedEntityIds(
  supabase: ServiceClient,
  reporterId: string,
  entityType: string,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("moderation_reports")
    .select("entity_id")
    .eq("reporter_id", reporterId)
    .eq("entity_type", entityType)
    .in("entity_id", ids);
  if (error) {
    console.error(`Failed to read reporter's reports: ${error.message}`);
    return new Set();
  }
  return new Set((data || []).map((r: { entity_id: string }) => r.entity_id));
}

/**
 * Block `blockedId` on behalf of `blockerId`: store the block (idempotent) and
 * remove any friendship or pending request between them.
 */
export async function blockUser(supabase: ServiceClient, blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new ApiError(400, "You can't block yourself.");

  const { error } = await supabase
    .from("user_blocks")
    .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true });
  if (error) {
    console.error(`Failed to store block: ${error.message}`);
    throw new ApiError(
      isMissingTable(error) ? 503 : 500,
      "Blocking isn't available right now. Please try again later."
    );
  }

  const { error: unfriendError } = await supabase
    .from("friend_connections")
    .delete()
    .in("requester_id", [blockerId, blockedId])
    .in("addressee_id", [blockerId, blockedId]);
  if (unfriendError) {
    // The block itself is stored and enforced; a stale friendship row is
    // still hidden by the block checks, so log rather than fail.
    console.error(`Block stored but friendship not removed: ${unfriendError.message}`);
  }
}
