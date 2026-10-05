/**
 * Shared reads for the threat tooling (threat-sessions, shap-explain,
 * feature-importance, cron/cluster-threats).
 *
 * behavioral_events (migration 004) has NO ip_address or user_agent column:
 * id, user_id, session_id, event_type, event_name, payload, platform,
 * app_version, created_at. Selecting the missing columns made PostgREST reject
 * the whole query, so every one of those routes saw zero events.
 *
 * What is actually collected:
 *   - session_id, when the client supplies one;
 *   - payload.ip_hash / payload.user_agent, only on the events bot-guard and
 *     failed logins write (bot_blocked, bot_suspicious, login_attempt).
 * Events with neither cannot be attributed to a session and are left out.
 */

import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** Columns that exist on behavioral_events and the threat features need. */
export const THREAT_EVENT_COLUMNS = "id, user_id, session_id, event_type, payload, created_at";

export interface ThreatEventRow {
  id: string;
  user_id: string | null;
  session_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

/** Shape extractThreatFeatures reads: user_agent lifted out of the payload. */
export interface FeatureEvent extends ThreatEventRow {
  payload: Record<string, unknown>;
  user_agent?: string;
}

/** Prefix for groups keyed by a payload ip_hash rather than a session id. */
const IP_KEY_PREFIX = "ip:";

function payloadString(e: ThreatEventRow, field: string): string | null {
  const v = e.payload?.[field];
  return typeof v === "string" && v ? v : null;
}

/** Stable key for the session an event belongs to, or null if it has none. */
export function threatGroupKey(e: ThreatEventRow): string | null {
  if (e.session_id) return e.session_id;
  const ip = payloadString(e, "ip_hash");
  return ip ? `${IP_KEY_PREFIX}${ip}` : null;
}

export interface GroupedThreatEvents {
  groups: Map<string, ThreatEventRow[]>;
  /** Events with no session id and no ip hash — not attributable. */
  ungrouped: number;
}

export function groupThreatEvents(events: ThreatEventRow[]): GroupedThreatEvents {
  const groups = new Map<string, ThreatEventRow[]>();
  let ungrouped = 0;
  for (const e of events) {
    const key = threatGroupKey(e);
    if (!key) {
      ungrouped++;
      continue;
    }
    groups.set(key, [...(groups.get(key) || []), e]);
  }
  return { groups, ungrouped };
}

/** The ip hash recorded on any event in the group, or null (not collected). */
export function groupIpHash(events: ThreatEventRow[]): string | null {
  for (const e of events) {
    const ip = payloadString(e, "ip_hash");
    if (ip) return ip;
  }
  return null;
}

/** The user agent recorded on any event in the group, or null (not collected). */
export function groupUserAgent(events: ThreatEventRow[]): string | null {
  for (const e of events) {
    const ua = payloadString(e, "user_agent");
    if (ua) return ua;
  }
  return null;
}

export function toFeatureEvents(events: ThreatEventRow[]): FeatureEvent[] {
  return events.map((e) => ({
    ...e,
    payload: e.payload || {},
    user_agent: payloadString(e, "user_agent") ?? undefined,
  }));
}

/** Events for one group key as produced by threatGroupKey(), oldest first. */
export async function fetchGroupEvents(
  supabase: ServiceClient,
  key: string,
  limit: number
): Promise<ThreatEventRow[]> {
  const base = supabase.from("behavioral_events").select(THREAT_EVENT_COLUMNS);
  const filtered = key.startsWith(IP_KEY_PREFIX)
    ? base.is("session_id", null).eq("payload->>ip_hash", key.slice(IP_KEY_PREFIX.length))
    : base.eq("session_id", key);
  const { data, error } = await filtered.order("created_at").limit(limit);
  if (error) throw new Error(`behavioral_events read failed: ${error.message}`);
  return (data || []) as ThreatEventRow[];
}
