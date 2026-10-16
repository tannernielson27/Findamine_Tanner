import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const sendEmail = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("@/lib/services/email", () => ({ sendEmail }));

beforeAll(() => {
  // In-memory debounce only: nothing here may reach a real Redis.
  for (const name of [
    "UPSTASH_REDIS_KV_REST_API_URL",
    "UPSTASH_REDIS_REST_URL",
    "KV_REST_API_URL",
    "UPSTASH_REDIS_KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_TOKEN",
  ]) {
    vi.stubEnv(name, "");
  }
});

import {
  buildReportAlertEmail,
  notifyModeratorsOfReport,
  notifyReviewersOfPendingHunt,
} from "@/lib/moderation/notify";
import { resetAlertThrottleForTests } from "@/lib/moderation/alert-throttle";
import { reportTargetLabel } from "@/lib/moderation/report-targets";

/**
 * Stand-in for the two queries notify makes: the recipients
 * (users.select().in().is()) and the queue size (select(count).eq()[.is()]).
 */
function usersClient(result: { data: unknown; error: { message: string } | null }, pending: number | null = 3) {
  const calls: { role?: unknown; deletedAt?: unknown; countedTable?: string } = {};
  const countResult = { count: pending, error: pending === null ? { message: "no" } : null };
  const counted = {
    is: async () => countResult,
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(countResult).then(resolve),
  };
  const client = {
    from: (table: string) => ({
      select: () => ({
        in: (_col: string, roles: unknown) => {
          calls.role = roles;
          return {
            is: async (_c: string, value: unknown) => {
              calls.deletedAt = value;
              return result;
            },
          };
        },
        eq: () => {
          calls.countedTable = table;
          return counted;
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

const sent = () => sendEmail.mock.calls as unknown as [{ to: string; subject: string; html: string }][];

beforeEach(() => {
  sendEmail.mockClear();
  resetAlertThrottleForTests();
});

describe("report alert email", () => {
  it("names the category and target with fixed labels, links to the queue, no reported text", () => {
    const { subject, html } = buildReportAlertEmail({ category: "mean_hurtful", targetType: "team_message" });
    expect(subject).toBe("New Findamine report: Mean or hurtful");
    expect(html).toContain("/admin/moderation");
    expect(html).toContain("chat message");
  });

  it("never echoes a client-supplied target type or category (L2)", () => {
    const { subject, html } = buildReportAlertEmail({ category: "<b>x</b>", targetType: "<script>alert(1)</script>" });
    expect(html).not.toContain("script");
    expect(html).toContain("<strong>content</strong>");
    expect(subject).toBe("New Findamine report: Other");
  });

  it("summarises how many reports are waiting", () => {
    expect(buildReportAlertEmail({ category: "spam", targetType: "kudos" }, 4).html).toContain("There are 4 reports waiting");
    expect(buildReportAlertEmail({ category: "spam", targetType: "kudos" }, 1).html).toContain("There is 1 report waiting");
  });
});

describe("reportTargetLabel", () => {
  it("maps known target keys and falls back to content", () => {
    expect(reportTargetLabel("wall_post")).toBe("wall post");
    expect(reportTargetLabel("find")).toBe("hunt stop");
    expect(reportTargetLabel("constructor")).toBe("content");
    expect(reportTargetLabel(42)).toBe("content");
  });
});

describe("notifyModeratorsOfReport", () => {
  it("emails every active admin, with the queue size", async () => {
    const { client, calls } = usersClient({
      data: [{ email: "a@example.com" }, { email: "b@example.com" }, { email: null }],
      error: null,
    });
    await notifyModeratorsOfReport(client, { category: "spam", targetType: "kudos" });
    expect(calls.role).toEqual(["admin"]);
    expect(calls.deletedAt).toBeNull();
    expect(calls.countedTable).toBe("moderation_reports");
    expect(sent().map(([m]) => m.to)).toEqual(["a@example.com", "b@example.com"]);
    expect(sent()[0][0].html).toContain("There are 3 reports waiting");
  });

  it("sends at most one alert per window, however many reports arrive (M3)", async () => {
    const { client } = usersClient({ data: [{ email: "a@example.com" }], error: null });
    for (let i = 0; i < 25; i++) {
      await notifyModeratorsOfReport(client, { category: "spam", targetType: "kudos" });
    }
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("still sends when the queue size can't be read", async () => {
    const { client } = usersClient({ data: [{ email: "a@example.com" }], error: null }, null);
    await notifyModeratorsOfReport(client, { category: "spam", targetType: "kudos" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sent()[0][0].html).not.toContain("waiting in the queue");
  });

  it("sends nothing and does not throw when the lookup fails", async () => {
    const { client } = usersClient({ data: null, error: { message: "boom" } });
    await expect(notifyModeratorsOfReport(client, { category: "spam", targetType: "kudos" })).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not throw when sending fails", async () => {
    sendEmail.mockRejectedValueOnce(new Error("provider down"));
    const { client } = usersClient({ data: [{ email: "a@example.com" }], error: null });
    await expect(notifyModeratorsOfReport(client, { category: "other", targetType: "user" })).resolves.toBeUndefined();
  });
});

describe("notifyReviewersOfPendingHunt", () => {
  it("emails admins and researchers about a pending hunt", async () => {
    const { client, calls } = usersClient({ data: [{ email: "r@example.com" }], error: null });
    await notifyReviewersOfPendingHunt(client, "hunt-1");
    expect(calls.role).toEqual(["admin", "researcher"]);
    const [[mail]] = sent();
    expect(mail.to).toBe("r@example.com");
    expect(mail.html).toContain("/admin/moderation/hunts");
  });

  it("emails once per hunt however often it is republished (M3)", async () => {
    const { client } = usersClient({ data: [{ email: "r@example.com" }], error: null });
    for (let i = 0; i < 10; i++) await notifyReviewersOfPendingHunt(client, "hunt-1");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("caps alerts across many different hunts too", async () => {
    const { client } = usersClient({ data: [{ email: "r@example.com" }], error: null });
    for (let i = 0; i < 10; i++) await notifyReviewersOfPendingHunt(client, `hunt-${i}`);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
