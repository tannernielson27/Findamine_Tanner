import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/utils/api-auth";
import { firstFlagged, jsonStrings } from "@/lib/hunts/text-filter";

export { jsonStrings };

/**
 * Publish review (migration 073). Publishing a hunt sends it to reviewers;
 * only an approved hunt is listed in the public catalogue (is_public = true).
 * Until then the hunt is "unlisted": its creator, reviewers, and (while it is
 * pending) students on the creator's rosters can still open and play it. A
 * hunt reviewers rejected is closed to everyone but its creator and reviewers.
 */

export type HuntReviewStatus = "not_submitted" | "pending" | "approved" | "rejected";

export const REVIEWER_ROLES = ["admin", "researcher"] as const;

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

interface Viewer {
  id: string;
  role: string;
}

interface HuntAccessFields {
  created_by: string;
  status: string;
  review_status?: string | null;
}

export function isReviewer(role: string | null | undefined): boolean {
  return !!role && (REVIEWER_ROLES as readonly string[]).includes(role);
}

/** Approved and out of draft: anyone may open and play it. */
export function isPubliclyAvailable(hunt: HuntAccessFields): boolean {
  return hunt.status !== "draft" && hunt.review_status === "approved";
}

/** True when the viewer is a student on one of the hunt creator's rosters. */
export async function isRosterStudentOf(
  supabase: ServiceClient,
  creatorId: string,
  viewerId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("roster_entries")
    .select("roster_id, rosters!inner(teacher_id, deleted_at)")
    .eq("student_id", viewerId)
    .eq("rosters.teacher_id", creatorId)
    .is("rosters.deleted_at", null)
    .limit(1);
  if (error) return false;
  return (data || []).length > 0;
}

/**
 * Whether `viewer` may open/play `hunt`. Drafts and rejected hunts: owner and
 * reviewers only. Published and waiting for review: also the creator's roster
 * students, so a teacher can run their own hunt with their class before it is
 * listed. Approved: everyone.
 */
export async function canAccessHunt(
  supabase: ServiceClient,
  hunt: HuntAccessFields,
  viewer: Viewer | null
): Promise<boolean> {
  if (isPubliclyAvailable(hunt)) return true;
  if (!viewer) return false;
  if (viewer.id === hunt.created_by || isReviewer(viewer.role)) return true;
  if (hunt.status === "draft") return false;
  // Reviewers turned it down: it must not keep reaching students.
  if (hunt.review_status === "rejected") return false;
  return isRosterStudentOf(supabase, hunt.created_by, viewer.id);
}

/** Fields written when a hunt is (re)submitted for review. */
export function pendingReviewFields(now: Date = new Date()) {
  return {
    review_status: "pending" as const,
    review_reason: null,
    review_submitted_at: now.toISOString(),
    reviewed_at: null,
    reviewed_by: null,
    is_public: false,
  };
}

/** Text fields on hunts that a reviewer approved; editing one sends the hunt back to review. */
export const REVIEWED_HUNT_TEXT_FIELDS = ["title", "description", "theme", "theme_narrative"] as const;

/**
 * Settings a reviewer approved along with the text: who the hunt is for, how
 * it is played, and where. Changing one on a listed hunt sends it back to
 * review (mirrors the hunts trigger in the database).
 */
export const REVIEWED_HUNT_SETTING_FIELDS = [
  "target_audience",
  "play_mode",
  "identity_mode",
  "grade_range_min",
  "grade_range_max",
  "center_latitude",
  "center_longitude",
  "search_radius_km",
  "subject_domains",
  "metadata",
] as const;

/** Every hunts column whose change needs a fresh review. */
export const REVIEWED_HUNT_FIELDS = [...REVIEWED_HUNT_TEXT_FIELDS, ...REVIEWED_HUNT_SETTING_FIELDS] as const;

/** The reviewed fields `updates` actually changes relative to `before`. */
export function changedReviewedHuntFields(
  before: Record<string, unknown>,
  updates: Record<string, unknown>
): string[] {
  return REVIEWED_HUNT_FIELDS.filter(
    (field) => updates[field] !== undefined && JSON.stringify(updates[field] ?? null) !== JSON.stringify(before[field] ?? null)
  );
}

/** Told to a creator whose edit took a listed hunt back to review. */
export const REQUEUED_MESSAGE =
  "Saved. Because this hunt was listed in Discover, your edit sent it back for review. It stays playable for you and your classes, and returns to Discover once a reviewer approves the change.";

/** Stop fields a reviewer approved; mirrors the finds requeue trigger (migrations 073/076). */
export const FIND_REVIEW_KEYS = [
  "clue_text",
  "clue_hints",
  "task_id",
  "primer_id",
  "location_id",
  "reading_check",
  "scaffolding_level",
  "hot_cold_enabled",
  "metadata",
] as const;

/** Whether a stop update changes its clue, hints, challenge, primer, or place. */
export function findTextChanged(before: Record<string, unknown>, updates: Record<string, unknown>): boolean {
  return FIND_REVIEW_KEYS.some(
    (key) => updates[key] !== undefined && JSON.stringify(updates[key] ?? null) !== JSON.stringify(before[key] ?? null)
  );
}

/** Reject a stop write whose clue or hints contain blocked language (400). */
export function assertCleanFindText(fields: Record<string, unknown>): void {
  const flagged = firstFlagged([
    { label: "The clue", text: typeof fields.clue_text === "string" ? fields.clue_text : null },
    { label: "A hint", text: jsonStrings(fields.clue_hints).join("\n") },
  ]);
  if (flagged) {
    throw new ApiError(400, `${flagged} contains language that isn't allowed on Findamine.`);
  }
}


interface ReviewableFind {
  clue_text?: string | null;
  clue_hints?: unknown;
  tasks?: { title?: string | null; description?: string | null; content?: unknown; feedback?: unknown } | null;
  primers?: { title?: string | null; content?: unknown } | null;
  locations?: {
    name?: string | null;
    description?: string | null;
    address?: string | null;
    safety_notes?: string | null;
  } | null;
}

interface ReviewableHunt {
  title?: string | null;
  description?: string | null;
  theme?: string | null;
  theme_narrative?: string | null;
}

/** All author-written text in a hunt, labelled so a filter hit can tell the author where. */
export function huntTextForReview(
  hunt: ReviewableHunt,
  finds: ReviewableFind[]
): { label: string; text: string | null | undefined }[] {
  const fields = [
    { label: "the title", text: hunt.title },
    { label: "the description", text: hunt.description },
    { label: "the theme", text: hunt.theme },
    { label: "the story", text: hunt.theme_narrative },
  ];
  finds.forEach((find, index) => {
    const stop = `stop ${index + 1}`;
    fields.push({ label: `${stop}'s clue`, text: find.clue_text });
    fields.push({ label: `${stop}'s hints`, text: jsonStrings(find.clue_hints).join("\n") });
    if (find.tasks) {
      fields.push({
        label: `${stop}'s challenge`,
        text: [
          find.tasks.title,
          find.tasks.description,
          ...jsonStrings(find.tasks.content),
          ...jsonStrings(find.tasks.feedback),
        ].join("\n"),
      });
    }
    if (find.primers) {
      fields.push({
        label: `${stop}'s primer`,
        text: [find.primers.title, ...jsonStrings(find.primers.content)].join("\n"),
      });
    }
    if (find.locations) {
      const place = find.locations;
      fields.push({
        label: `${stop}'s place`,
        text: [place.name, place.description, place.address, place.safety_notes].join("\n"),
      });
    }
  });
  return fields;
}

/**
 * An edit changed reviewed text on a hunt: if it was listed, pull it from the
 * catalogue and send it back to the queue. Pending/rejected/draft hunts are
 * left alone (pending ones are already queued; others resubmit by publishing).
 */
export async function requeueApprovedHunt(supabase: ServiceClient, huntId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("hunts")
    .update(pendingReviewFields())
    .eq("id", huntId)
    .eq("review_status", "approved")
    .neq("status", "draft")
    .select("id");
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

/** Told to an admin/researcher whose edit to someone else's listed hunt sent it back to review. */
export const REQUEUED_MESSAGE_FOR_EDITOR =
  "Saved. This edit took the hunt out of Discover and sent it back for review. It returns to Discover once a reviewer approves the change.";

export function requeuedMessage(editorId: string, creatorId: string | null | undefined): string {
  return editorId === creatorId ? REQUEUED_MESSAGE : REQUEUED_MESSAGE_FOR_EDITOR;
}

/**
 * After a write to a hunt or one of its stops: is a hunt that was approved
 * now back in the review queue? The database triggers decide; this reads the
 * result. When the route itself saw a reviewed change (`predicted`) it also
 * requeues explicitly, which is a no-op once the trigger has acted and keeps
 * the rule holding if the trigger is missing.
 */
export async function settleRequeue(
  supabase: ServiceClient,
  huntId: string,
  wasListed: boolean,
  predicted: boolean
): Promise<boolean> {
  if (!wasListed) return false;
  if (predicted) await requeueApprovedHunt(supabase, huntId);
  return (await currentReviewStatus(supabase, huntId)) === "pending";
}

/**
 * The hunt's review_status as stored now. Read after a write so the response
 * reflects what the database triggers decided (they requeue an approved hunt
 * on edits to more columns than this module predicts, and bump
 * review_submitted_at on edits to a pending one), instead of guessing in TS.
 */
export async function currentReviewStatus(supabase: ServiceClient, huntId: string): Promise<string | null> {
  const { data } = await supabase.from("hunts").select("review_status").eq("id", huntId).maybeSingle();
  return (data as { review_status?: string | null } | null)?.review_status ?? null;
}

/**
 * Review bookkeeping only the creator and reviewers may see: who reviewed or
 * affirmed it, why it was turned down, when. Players get the hunt without it.
 */
const INTERNAL_REVIEW_FIELDS = [
  "review_reason",
  "reviewed_by",
  "reviewed_at",
  "review_submitted_at",
  "safety_affirmed_by",
  "safety_affirmed_at",
] as const;

export function withoutInternalReviewFields<T extends Record<string, unknown>>(hunt: T): T {
  const copy: Record<string, unknown> = { ...hunt };
  for (const field of INTERNAL_REVIEW_FIELDS) delete copy[field];
  return copy as T;
}
