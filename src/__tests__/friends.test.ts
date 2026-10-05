import { describe, it, expect } from "vitest";
import {
  friendLinkWith,
  socialErrorMessage,
  withViewerSide,
  type FriendRow,
} from "@/lib/social/friends";
import { buildKudosRecipients } from "@/lib/social/recipients";

const ada = { id: "ada", display_name: "Ada", avatar_url: null };
const me = { id: "me", display_name: "Me", avatar_url: null };

function row(over: Partial<FriendRow> & { requester: typeof ada | null; addressee: typeof ada | null }) {
  return { id: "c1", status: "accepted", created_at: "2026-01-01T00:00:00Z", requester_id: "me", addressee_id: "ada", ...over };
}

describe("withViewerSide", () => {
  it("names the other person and marks a request the viewer sent as outgoing", () => {
    const out = withViewerSide(row({ requester: me, addressee: ada }), "me");
    expect(out.friend).toEqual(ada);
    expect(out.direction).toBe("outgoing");
    // The raw sides stay, for consumers that read requester/addressee.
    expect(out.requester).toEqual(me);
    expect(out.addressee).toEqual(ada);
  });

  it("marks a request the viewer received as incoming", () => {
    const out = withViewerSide(
      row({ requester_id: "ada", addressee_id: "me", requester: ada, addressee: me }),
      "me"
    );
    expect(out.friend).toEqual(ada);
    expect(out.direction).toBe("incoming");
  });

  it("produces rows the kudos recipient list understands", () => {
    const out = withViewerSide(row({ requester: me, addressee: ada }), "me");
    expect(buildKudosRecipients({ friends: [out], selfId: "me" })).toEqual([
      { id: "ada", label: "Ada", group: "friend" },
    ]);
  });
});

describe("friendLinkWith", () => {
  const base = { created_at: "", requester_id: "", addressee_id: "", friend: ada };
  const rows: FriendRow[] = [{ ...base, id: "c1", status: "accepted", direction: "outgoing" }];

  it("reports friends, sent and received requests with the row to act on", () => {
    expect(friendLinkWith(rows, "ada")).toEqual({ state: "friends", connectionId: "c1" });
    expect(friendLinkWith([{ ...rows[0], status: "pending" }], "ada")).toEqual({
      state: "request_sent",
      connectionId: "c1",
    });
    expect(friendLinkWith([{ ...rows[0], status: "pending", direction: "incoming" }], "ada")).toEqual({
      state: "request_received",
      connectionId: "c1",
    });
  });

  it("reports no link for a stranger or a name-hidden row", () => {
    expect(friendLinkWith(rows, "someone-else")).toEqual({ state: "none", connectionId: null });
    expect(friendLinkWith([{ ...rows[0], friend: null }], "ada")).toEqual({ state: "none", connectionId: null });
  });
});

describe("socialErrorMessage", () => {
  it("passes through player-facing 4xx messages", () => {
    expect(socialErrorMessage(409, "You're already friends.", "fallback")).toBe("You're already friends.");
  });

  it("explains a rate limit instead of blaming the input", () => {
    expect(socialErrorMessage(429, "Too many requests. Try again in 12 seconds.", "That code didn't work.")).toMatch(/wait/i);
  });

  it("never shows a server fault's raw text", () => {
    expect(socialErrorMessage(500, "duplicate key value violates...", "Try again.")).toBe("Try again.");
    expect(socialErrorMessage(400, undefined, "Try again.")).toBe("Try again.");
  });
});
