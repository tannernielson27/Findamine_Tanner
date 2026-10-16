/**
 * Email moderators when a new report lands, so reports are acted on within the
 * 24 hours the Terms of Use promise instead of waiting unseen in the queue.
 *
 * The email deliberately carries no reported text or user names — only the
 * category and a link to /admin/moderation — so objectionable content and
 * personal data never sit in inboxes.
 *
 * Alerts are debounced (alert-throttle.ts) so reports or publishes can't be
 * used to flood moderators' inboxes: at most one report alert per
 * REPORT_ALERT_WINDOW_MS, at most one hunt-review alert per hunt per
 * HUNT_ALERT_PER_HUNT_WINDOW_MS and one in total per
 * HUNT_ALERT_GLOBAL_WINDOW_MS. Each email gives the queue's current size, so
 * a suppressed event is still covered by the next one that goes out.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/services/email";
import { escapeHtml } from "@/lib/services/auth-emails";
import { MODERATOR_ROLES } from "@/lib/moderation/roles";
import { REVIEWER_ROLES } from "@/lib/hunts/review";
import { reportTargetLabel } from "@/lib/moderation/report-targets";
import { claimAlertSlot } from "@/lib/moderation/alert-throttle";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://findamine.app";

export const REPORT_ALERT_WINDOW_MS = 10 * 60 * 1000;
export const HUNT_ALERT_PER_HUNT_WINDOW_MS = 60 * 60 * 1000;
export const HUNT_ALERT_GLOBAL_WINDOW_MS = 15 * 60 * 1000;

const CATEGORY_LABELS: Record<string, string> = {
  mean_hurtful: "Mean or hurtful",
  inappropriate: "Inappropriate",
  spam: "Spam",
  off_topic: "Off topic",
  harassment: "Harassment",
  cheating: "Cheating",
  privacy_violation: "Privacy violation",
  other: "Other",
};

export interface NewReportSummary {
  category: string;
  /** As sent by the client; only ever shown as a known label. */
  targetType: string;
}

/** "There are 3 reports waiting." / "" when the count is unknown. */
function waitingLine(count: number | null, singular: string, plural: string): string {
  if (count === null || count < 1) return "";
  return `<p>There ${count === 1 ? `is 1 ${singular}` : `are ${count} ${plural}`} waiting in the queue.</p>`;
}

export function buildReportAlertEmail(
  report: NewReportSummary,
  pendingCount: number | null = null
): { subject: string; html: string } {
  // Both values come from the client: show only fixed labels, never the raw text.
  const category = CATEGORY_LABELS[report.category] ?? "Other";
  const target = reportTargetLabel(report.targetType);
  const queueUrl = `${SITE_URL}/admin/moderation`;
  return {
    subject: `New Findamine report: ${category}`,
    html: `
      <p>A player reported a <strong>${escapeHtml(target)}</strong> as <strong>${escapeHtml(category)}</strong>.</p>
      ${waitingLine(pendingCount, "report", "reports")}
      <p>Please review it within 24 hours.</p>
      <p><a href="${escapeHtml(queueUrl)}">Open the moderation queue</a></p>
    `,
  };
}

export function buildHuntReviewAlertEmail(pendingCount: number | null = null): { subject: string; html: string } {
  const queueUrl = `${SITE_URL}/admin/moderation/hunts`;
  return {
    subject: "New Findamine hunt waiting for review",
    html: `
      <p>A creator submitted a hunt for the public catalogue.</p>
      ${waitingLine(pendingCount, "hunt", "hunts")}
      <p>Please review it within 24 hours.</p>
      <p><a href="${escapeHtml(queueUrl)}">Open the hunt review queue</a></p>
    `,
  };
}

/** Rows matching `filter` in `table`, or null if the count can't be read. */
async function countPending(
  supabase: SupabaseClient,
  table: "moderation_reports" | "hunts",
  column: string
): Promise<number | null> {
  try {
    let q = supabase.from(table).select("id", { count: "exact", head: true }).eq(column, "pending");
    if (table === "hunts") q = q.is("deleted_at", null);
    const { count, error } = await q;
    return error ? null : count ?? null;
  } catch {
    return null;
  }
}

/**
 * Email every active user holding one of `roles`. Never throws: a failed lookup
 * or send is logged and the caller's work is unaffected.
 */
async function emailActiveUsersWithRoles(
  supabase: SupabaseClient,
  roles: readonly string[],
  email: { subject: string; html: string },
  label: string
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("email")
      .in("role", [...roles])
      .is("deleted_at", null);
    if (error) {
      console.error(`${label}: could not load recipients:`, error.message);
      return;
    }

    const recipients = (data ?? [])
      .map((row: { email: string | null }) => row.email)
      .filter((address): address is string => typeof address === "string" && address.includes("@"));
    if (recipients.length === 0) {
      console.error(`${label}: no recipient email addresses on file`);
      return;
    }

    await Promise.all(recipients.map((to) => sendEmail({ to, ...email })));
  } catch (err) {
    console.error(`${label} failed:`, err);
  }
}

/** Alert every active moderator to a new report (at most once per REPORT_ALERT_WINDOW_MS). */
export async function notifyModeratorsOfReport(
  supabase: SupabaseClient,
  report: NewReportSummary
): Promise<void> {
  try {
    if (!(await claimAlertSlot("report", REPORT_ALERT_WINDOW_MS))) return;
  } catch (err) {
    console.error("Report alert throttle failed:", err);
    return;
  }
  const pending = await countPending(supabase, "moderation_reports", "status");
  await emailActiveUsersWithRoles(supabase, MODERATOR_ROLES, buildReportAlertEmail(report, pending), "Report alert");
}

/**
 * Alert every active hunt reviewer that a hunt is waiting in the review queue:
 * at most once per hunt per hour, and once per HUNT_ALERT_GLOBAL_WINDOW_MS overall.
 */
export async function notifyReviewersOfPendingHunt(supabase: SupabaseClient, huntId: string): Promise<void> {
  try {
    if (!(await claimAlertSlot(`hunt-review:${huntId}`, HUNT_ALERT_PER_HUNT_WINDOW_MS))) return;
    if (!(await claimAlertSlot("hunt-review", HUNT_ALERT_GLOBAL_WINDOW_MS))) return;
  } catch (err) {
    console.error("Hunt review alert throttle failed:", err);
    return;
  }
  const pending = await countPending(supabase, "hunts", "review_status");
  await emailActiveUsersWithRoles(supabase, REVIEWER_ROLES, buildHuntReviewAlertEmail(pending), "Hunt review alert");
}
