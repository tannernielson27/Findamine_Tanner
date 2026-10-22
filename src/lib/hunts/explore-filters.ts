/**
 * Explore (`/browse`) filters: URL state, chip predicates and the audience
 * default. Pure, so it is unit-tested without a DOM or a database.
 *
 * URL shape: `/browse?q=…&f=near,short&audience=adults&view=map`
 * - `f`: comma-separated chip ids, whitelisted and kept in chip order.
 * - `audience`: one of AUDIENCES, or "any" for every age. Absent means "use
 *   the viewer's default" (see defaultAudiencesFor), which can be a set.
 */
import type { HuntCardData, HuntListRow } from "@/lib/hunts/card-data";
import { distanceMeters } from "@/lib/hunts/card-data";

/* ─── Chips ─────────────────────────────────────────────────── */

export const FILTER_IDS = ["near", "short", "campus", "photo", "team", "new"] as const;
export type FilterId = (typeof FILTER_IDS)[number];

export const FILTER_LABELS: Record<FilterId, string> = {
  near: "Near me",
  short: "Under 30 min",
  campus: "Campus",
  photo: "Photo challenges",
  team: "Team",
  new: "New",
};

/** "Under 30 min" includes exactly 30. */
export const SHORT_HUNT_MAX_MIN = 30;
/** "New" = created in the last 30 days. */
export const NEW_HUNT_DAYS = 30;
/** The challenge type that makes a hunt a "photo challenge" (tasks.challenge_type). */
export const PHOTO_CHALLENGE_TYPE = "photo_observation";

const CAMPUS_PATTERN = /\bcampus\b|\bbyu\b|brigham young/i;
const DAY_MS = 24 * 60 * 60 * 1000;

function isFilterId(value: string): value is FilterId {
  return (FILTER_IDS as readonly string[]).includes(value);
}

/** `?f=` → known chip ids, de-duplicated, in chip order. Unknown ids are dropped. */
export function parseFilters(param: string | string[] | null | undefined): FilterId[] {
  const raw = Array.isArray(param) ? param.join(",") : param ?? "";
  const wanted = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(isFilterId)
  );
  return FILTER_IDS.filter((id) => wanted.has(id));
}

/** Chip ids → `?f=` value, or null when none are on. */
export function serializeFilters(filters: readonly FilterId[]): string | null {
  const on = FILTER_IDS.filter((id) => filters.includes(id));
  return on.length > 0 ? on.join(",") : null;
}

/** Returns a new list with `id` switched on or off. */
export function toggleFilter(filters: readonly FilterId[], id: FilterId): FilterId[] {
  const next = filters.includes(id) ? filters.filter((f) => f !== id) : [...filters, id];
  return FILTER_IDS.filter((f) => next.includes(f));
}

/* ─── Hunt shape the predicates read ────────────────────────── */

export interface ExploreHunt extends HuntCardData {
  /** hunts.subject_domains */
  tags: string[];
  /** Distinct tasks.challenge_type across the hunt's live stops. */
  challengeTypes: string[];
}

/** Row from the Explore query: the card columns plus stops' challenge types and play count. */
export interface ExploreRow extends Omit<HuntListRow, "finds"> {
  subject_domains?: string[] | null;
  finds?: Array<{
    deleted_at?: string | null;
    tasks?: { challenge_type?: string | null } | Array<{ challenge_type?: string | null }> | null;
  }> | null;
  play_sessions?: Array<{ count: number }> | null;
}

/** Maps an Explore query row to the card + predicate shape. Soft-deleted stops are ignored. Pure. */
export function toExploreHunt(row: ExploreRow): ExploreHunt {
  const liveFinds = (row.finds ?? []).filter((f) => !f.deleted_at);
  const types = new Set<string>();
  for (const find of liveFinds) {
    const tasks = Array.isArray(find.tasks) ? find.tasks : find.tasks ? [find.tasks] : [];
    for (const task of tasks) if (task?.challenge_type) types.add(task.challenge_type);
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    coverImageUrl: row.cover_image_url ?? null,
    audience: row.target_audience ?? null,
    playMode: row.play_mode ?? null,
    durationMinutes: row.estimated_duration_min ?? null,
    stopCount: liveFinds.length || null,
    latitude: row.center_latitude ?? null,
    longitude: row.center_longitude ?? null,
    createdAt: row.created_at ?? null,
    plays: row.play_sessions?.[0]?.count ?? null,
    tags: row.subject_domains ?? [],
    challengeTypes: [...types],
  };
}

/* ─── Predicates (one per chip; "near" sorts instead of filtering) ── */

export function isShortHunt(hunt: Pick<ExploreHunt, "durationMinutes">): boolean {
  return hunt.durationMinutes != null && hunt.durationMinutes > 0 && hunt.durationMinutes <= SHORT_HUNT_MAX_MIN;
}

/** Title, description or tags mention campus or BYU (there is no campus column). */
export function isCampusHunt(hunt: Pick<ExploreHunt, "title" | "description" | "tags">): boolean {
  return [hunt.title, hunt.description ?? "", ...(hunt.tags ?? [])].some((text) => CAMPUS_PATTERN.test(text));
}

export function hasPhotoChallenge(hunt: Pick<ExploreHunt, "challengeTypes">): boolean {
  return hunt.challengeTypes.includes(PHOTO_CHALLENGE_TYPE);
}

export function isTeamHunt(hunt: Pick<ExploreHunt, "playMode">): boolean {
  return typeof hunt.playMode === "string" && hunt.playMode.startsWith("team");
}

export function isNewHunt(hunt: Pick<ExploreHunt, "createdAt">, now: Date): boolean {
  if (!hunt.createdAt) return false;
  const created = Date.parse(hunt.createdAt);
  if (!Number.isFinite(created)) return false;
  const age = now.getTime() - created;
  return age >= 0 && age <= NEW_HUNT_DAYS * DAY_MS;
}

const PREDICATES: Record<Exclude<FilterId, "near">, (hunt: ExploreHunt, now: Date) => boolean> = {
  short: (h) => isShortHunt(h),
  campus: (h) => isCampusHunt(h),
  photo: (h) => hasPhotoChallenge(h),
  team: (h) => isTeamHunt(h),
  new: (h, now) => isNewHunt(h, now),
};

/** Hunts matching every selected chip (AND). "near" never removes a hunt. Pure. */
export function applyFilters<T extends ExploreHunt>(hunts: readonly T[], filters: readonly FilterId[], now: Date): T[] {
  const active = filters.filter((f): f is Exclude<FilterId, "near"> => f !== "near");
  return hunts.filter((hunt) => active.every((f) => PREDICATES[f](hunt, now)));
}

/**
 * Adds `distanceMeters` from `origin` and sorts nearest first. Hunts without
 * coordinates keep their order at the end. Returns new objects. Pure.
 */
export function withDistances<T extends HuntCardData>(
  hunts: readonly T[],
  origin: { lat: number; lng: number } | null,
  sort: boolean
): T[] {
  if (!origin) return [...hunts];
  const measured = hunts.map((hunt) => ({
    ...hunt,
    distanceMeters:
      hunt.latitude != null && hunt.longitude != null
        ? distanceMeters(origin, { lat: hunt.latitude, lng: hunt.longitude })
        : null,
  }));
  if (!sort) return measured;
  return measured
    .map((hunt, index) => ({ hunt, index }))
    .sort((a, b) => {
      const da = a.hunt.distanceMeters ?? Number.POSITIVE_INFINITY;
      const db = b.hunt.distanceMeters ?? Number.POSITIVE_INFINITY;
      return da === db ? a.index - b.index : da - db;
    })
    .map(({ hunt }) => hunt);
}

/** Curated "Popular at BYU" shelf: campus hunts, most played first. Pure. */
export function popularCampusHunts<T extends ExploreHunt>(hunts: readonly T[], limit = 8): T[] {
  return hunts
    .filter((h) => isCampusHunt(h))
    .map((hunt, index) => ({ hunt, index }))
    .sort((a, b) => (b.hunt.plays ?? 0) - (a.hunt.plays ?? 0) || a.index - b.index)
    .slice(0, limit)
    .map(({ hunt }) => hunt);
}

/* ─── Audience ──────────────────────────────────────────────── */

export const AUDIENCES = ["kids", "teens", "adults", "family"] as const;
export type Audience = (typeof AUDIENCES)[number];
/** URL value meaning "every age" (no audience filter). */
export const ANY_AUDIENCE = "any";

export const AUDIENCE_OPTIONS: Array<{ value: Audience | typeof ANY_AUDIENCE; label: string }> = [
  { value: "adults", label: "Adults" },
  { value: "teens", label: "Teens" },
  { value: "kids", label: "Kids" },
  { value: "family", label: "Families" },
  { value: ANY_AUDIENCE, label: "All ages" },
];

/** hunts.target_audience value for hunts suitable for every age; always included. */
const ALL_AGES_VALUE = "all";

/** Roles that see every age by default: they build and review hunts for any audience. */
const ANY_AGE_ROLES: readonly string[] = ["teacher", "hunt_creator", "admin", "researcher"];

function isAudience(value: unknown): value is Audience {
  return typeof value === "string" && (AUDIENCES as readonly string[]).includes(value);
}

export interface AudienceViewer {
  role?: string | null;
  /** Age band (lib/utils/age-band): primary | intermediate | teen | adult. */
  band?: string | null;
}

/**
 * The audiences a viewer sees by default (null = every age). Hunt authors
 * and staff see everything; parents see adult and family hunts; kids and
 * teens see their own band plus family hunts; other adults see adult hunts.
 * Signed-out visitors (null) see every age. "All ages" hunts are always
 * included on top (see audienceOrFilter).
 */
export function defaultAudiencesFor(viewer: AudienceViewer | null | undefined): Audience[] | null {
  if (!viewer) return null;
  if (viewer.role && ANY_AGE_ROLES.includes(viewer.role)) return null;
  if (viewer.role === "parent") return ["adults", "family"];
  switch (viewer.band) {
    case "primary":
    case "intermediate":
      return ["kids", "family"];
    case "teen":
      return ["teens", "family"];
    case "adult":
      return ["adults"];
    default:
      return null;
  }
}

/** The audience filter in effect, and whether the viewer picked it. */
export interface AudienceChoice {
  /** Audiences to show (plus "all"-ages hunts), or null for every age. */
  audiences: Audience[] | null;
  /** True when it came from `?audience=` (one value or "any"); false for the viewer default. */
  explicit: boolean;
}

/** `?audience=` → the audience filter. Absent or unknown → the viewer's default. Pure. */
export function resolveAudience(
  param: string | string[] | null | undefined,
  viewer: AudienceViewer | null | undefined
): AudienceChoice {
  const value = Array.isArray(param) ? param[0] : param;
  if (value === ANY_AUDIENCE) return { audiences: null, explicit: true };
  if (isAudience(value)) return { audiences: [value], explicit: true };
  return { audiences: defaultAudiencesFor(viewer), explicit: false };
}

/** "Adults", "Adults & families", "All ages". Pure. */
export function audienceSetLabel(audiences: readonly Audience[] | null): string {
  if (!audiences) return "All ages";
  const picked = AUDIENCE_OPTIONS.filter((o) => isAudience(o.value) && audiences.includes(o.value));
  if (picked.length === 0) return "All ages";
  return picked.map((o, i) => (i === 0 ? o.label : o.label.toLowerCase())).join(" & ");
}

/**
 * PostgREST `or` filter for a set of audiences, e.g.
 * `target_audience.in.(adults,family,all)`. Built only from the whitelist
 * above (anything else would be parsed as filter syntax). Hunts for "all"
 * ages are always included. Null means no audience filter.
 */
export function audienceOrFilter(audiences: readonly Audience[] | null): string | null {
  if (!audiences) return null;
  const safe = AUDIENCES.filter((a) => audiences.includes(a));
  if (safe.length === 0) return null;
  return `target_audience.in.(${[...safe, ALL_AGES_VALUE].join(",")})`;
}

/* ─── Links ─────────────────────────────────────────────────── */

export interface ExploreState {
  q?: string | null;
  filters?: readonly FilterId[];
  /** Explicit URL value: an Audience, "any", or null/undefined to fall back to the viewer default. */
  audience?: string | null;
  view?: "list" | "map";
}

/** Builds a `/browse` URL from Explore state, omitting defaults. Pure. */
export function exploreHref(state: ExploreState): string {
  const params = new URLSearchParams();
  const q = state.q?.trim();
  if (q) params.set("q", q);
  const f = serializeFilters(state.filters ?? []);
  if (f) params.set("f", f);
  if (state.audience) params.set("audience", state.audience);
  if (state.view === "map") params.set("view", "map");
  const query = params.toString();
  return query ? `/browse?${query}` : "/browse";
}
