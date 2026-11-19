/**
 * What a report points at, and how to find who wrote it.
 *
 * moderation_reports.entity_type is CHECK-constrained. Migration 072 widens it
 * to message | wall_post | content | user | shoutout | kudos | hunt | review
 * and adds reported_user_id + content_snapshot, so the admin queue can show
 * what was said and by whom even if the original is later edited or deleted.
 * `legacy` is the pre-072 value, used if the insert hits the old CHECK.
 */

import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

export interface ReportTarget {
  /** entity_type stored after migration 072. */
  stored: string;
  /** entity_type allowed by the original (004) CHECK. */
  legacy: string;
  /** Where the reported thing lives, to resolve author + text. */
  source?: { table: string; author: string; text: string };
  /**
   * For a target whose author is not a column on its own row (a hunt stop is
   * written by the hunt's creator): resolve it here instead of via `source`.
   */
  resolve?: (supabase: ServiceClient, targetId: string, reporter: Reporter) => Promise<ResolvedTarget>;
}

/** Who is making the report. */
export interface Reporter {
  id: string;
  role: string;
}

const MESSAGE: ReportTarget = {
  stored: "message",
  legacy: "message",
  source: { table: "team_messages", author: "user_id", text: "message" },
};

export const REPORT_TARGETS: Record<string, ReportTarget> = {
  message: MESSAGE,
  team_message: MESSAGE,
  chat_message: MESSAGE,
  kudos: { stored: "kudos", legacy: "content", source: { table: "kudos", author: "sender_id", text: "message" } },
  wall_post: { stored: "wall_post", legacy: "wall_post", source: { table: "wall_posts", author: "user_id", text: "content" } },
  shoutout: { stored: "shoutout", legacy: "shoutout", source: { table: "shoutouts", author: "sender_id", text: "message" } },
  user: { stored: "user", legacy: "user", source: { table: "users", author: "id", text: "display_name" } },
  hunt: { stored: "hunt", legacy: "content", source: { table: "hunts", author: "created_by", text: "title" } },
  review: { stored: "review", legacy: "content", source: { table: "hunt_ratings", author: "user_id", text: "review_text" } },
  // A hunt stop, reported from the play page. migration 072's CHECK has no
  // "find", so it is stored as content (the details keep the "[find]" tag),
  // but the clue and the hunt's creator are snapshotted like any other target.
  find: { stored: "content", legacy: "content", resolve: resolveFind },
};

/** Fixed, human labels for alert emails: client-sent target types are never echoed. */
const TARGET_LABELS: Record<string, string> = {
  message: "chat message",
  team_message: "chat message",
  chat_message: "chat message",
  kudos: "kudos message",
  wall_post: "wall post",
  shoutout: "shoutout",
  user: "player",
  hunt: "hunt",
  review: "hunt review",
  find: "hunt stop",
};

/** The label for a report target type; anything unknown is just "content". */
export function reportTargetLabel(targetType: unknown): string {
  return typeof targetType === "string" && Object.prototype.hasOwnProperty.call(TARGET_LABELS, targetType)
    ? TARGET_LABELS[targetType]
    : "content";
}

/** Longest target_type accepted from a client (all known ones are shorter). */
export const MAX_TARGET_TYPE_LENGTH = 40;
const TARGET_TYPE_RE = /^[a-z_]{1,40}$/;

/** A plausible target_type: short snake_case. Unknown-but-valid ones are stored as content. */
export function isValidTargetType(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TARGET_TYPE_LENGTH && TARGET_TYPE_RE.test(value);
}

/** Anything else (the play page sends "find") is stored as generic content. */
export function reportTargetFor(targetType: string): ReportTarget {
  return Object.prototype.hasOwnProperty.call(REPORT_TARGETS, targetType)
    ? REPORT_TARGETS[targetType]
    : { stored: "content", legacy: "content" };
}

export interface ResolvedTarget {
  found: boolean;
  reportedUserId: string | null;
  snapshot: string | null;
}

const SNAPSHOT_MAX = 1000;

/** Look up the reported row's author and text. Unknown sources resolve as found. */
export async function resolveReportTarget(
  supabase: ServiceClient,
  target: ReportTarget,
  targetId: string,
  reporter: Reporter
): Promise<ResolvedTarget> {
  if (target.resolve) return target.resolve(supabase, targetId, reporter);
  if (!target.source) return { found: true, reportedUserId: null, snapshot: null };
  const { table, author, text } = target.source;
  const { data, error } = await supabase
    .from(table)
    .select(author === "id" ? `id, ${text}` : `${author}, ${text}`)
    .eq("id", targetId)
    .maybeSingle();
  if (error) {
    console.error(`Failed to resolve reported ${table}: ${error.message}`);
    return { found: true, reportedUserId: null, snapshot: null };
  }
  if (!data) return { found: false, reportedUserId: null, snapshot: null };
  const row = data as unknown as Record<string, unknown>;
  const authorId = typeof row[author] === "string" ? (row[author] as string) : null;
  const body = typeof row[text] === "string" ? (row[text] as string).slice(0, SNAPSHOT_MAX) : null;
  return { found: true, reportedUserId: authorId, snapshot: body };
}

const NOT_FOUND: ResolvedTarget = { found: false, reportedUserId: null, snapshot: null };
const REVIEWER_ROLES: readonly string[] = ["admin", "researcher"];

/**
 * A hunt stop: its clue text, written by the hunt's creator.
 *
 * The clue is kept with the report, and a reporter can read their own reports
 * back. So the clue is kept only for someone who has been given it: a player
 * who has started the stop, the hunt's creator, or a reviewer. A player who is
 * in the hunt but has not started the stop (the play screen offers "Report a
 * problem" on the "I'm ready" step too) can still report it; that report is
 * stored without the clue. For anyone else the stop resolves as not found, as
 * a made-up id does.
 */
async function resolveFind(supabase: ServiceClient, findId: string, reporter: Reporter): Promise<ResolvedTarget> {
  const { data, error } = await supabase
    .from("finds")
    .select("id, hunt_id, clue_text, hunts(created_by)")
    .eq("id", findId)
    .maybeSingle();
  if (error) {
    console.error(`Failed to resolve reported finds: ${error.message}`);
    return NOT_FOUND;
  }
  if (!data) return NOT_FOUND;
  const row = data as unknown as { hunt_id?: unknown; clue_text?: unknown; hunts?: unknown };
  const hunt = (Array.isArray(row.hunts) ? row.hunts[0] : row.hunts) as { created_by?: unknown } | null | undefined;
  const creatorId = typeof hunt?.created_by === "string" ? hunt.created_by : null;

  const insider = creatorId === reporter.id || REVIEWER_ROLES.includes(reporter.role);
  const standing = insider ? "started" : await playerStanding(supabase, reporter.id, String(row.hunt_id ?? ""), findId);
  if (standing === "outside") return NOT_FOUND;

  return {
    found: true,
    reportedUserId: creatorId,
    snapshot: standing === "started" && typeof row.clue_text === "string" ? row.clue_text.slice(0, SNAPSHOT_MAX) : null,
  };
}

/**
 * Where a player stands with a stop: they have started it in one of their
 * sessions on its hunt, they are in the hunt but have not started it, or they
 * are not in the hunt at all. A failed read counts as the more cautious answer.
 */
async function playerStanding(
  supabase: ServiceClient,
  userId: string,
  huntId: string,
  findId: string
): Promise<"started" | "in_hunt" | "outside"> {
  const { data: sessions, error: sessionsError } = await supabase
    .from("play_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("hunt_id", huntId);
  if (sessionsError || !sessions || sessions.length === 0) return "outside";
  const { data: started, error } = await supabase
    .from("find_completions")
    .select("id")
    .eq("find_id", findId)
    .in("play_session_id", sessions.map((s) => s.id as string))
    .limit(1);
  return !error && !!started && started.length > 0 ? "started" : "in_hunt";
}
