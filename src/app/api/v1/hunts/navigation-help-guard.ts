import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";
import { checkNavigationHelpEdit, inheritNavigationHelp, navigationHelpChanged } from "@/lib/play/navigation-help";
import { deliveryLocked } from "./delivery-guard";

/**
 * Hunt-editing routes' side of the difficulty setting (navigation help,
 * lib/play/navigation-help.ts). It shares the clue delivery lock: once the
 * hunt is published, or anyone has played it, the level can't change.
 */

type Meta = Record<string, unknown> | null;

/** 400 when new hunt settings name a difficulty that doesn't exist. */
export function assertKnownNavigationHelp(metadata: unknown): void {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return;
  const result = checkNavigationHelpEdit({ locked: false, before: null, after: metadata as Record<string, unknown> });
  if (!result.ok) throw new ApiError(result.status, result.error);
}

/**
 * Settles the difficulty in a hunt metadata update against the stored hunt.
 * An update that leaves it out keeps the stored level; an unknown level is a
 * 400; a change on a locked hunt is a 409. Returns the metadata to store.
 * The lock is only looked up when the level actually changes.
 */
export async function settleNavigationHelp(
  supabase: SupabaseClient,
  input: { hunt: { id: string; status: string }; before: Meta; after: Meta; route: string }
): Promise<Meta> {
  const { hunt, before, route } = input;
  const after = inheritNavigationHelp(before, input.after) as Meta;
  const locked = navigationHelpChanged(before, after) ? await deliveryLocked(supabase, hunt, route) : false;
  const result = checkNavigationHelpEdit({ locked, before, after });
  if (!result.ok) throw new ApiError(result.status, result.error);
  return after;
}
