import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/utils/logger", () => ({
  logger: { info: vi.fn(), warn: h.warn, error: vi.fn() },
}));

import { LEADERBOARD_CHANGED_EVENT, leaderboardTopic } from "@/lib/social/leaderboard-channel";
import { notifyLeaderboardChanged } from "@/lib/social/leaderboard-broadcast";
import { createPingHub, type PingTransport } from "@/lib/social/leaderboard-pings";

const HUNT_A = "0b7f3c1e-1111-4a6b-9c3d-000000000001";
const HUNT_B = "0b7f3c1e-2222-4a6b-9c3d-000000000002";

describe("leaderboardTopic", () => {
  it("gives every hunt its own channel", () => {
    expect(leaderboardTopic(HUNT_A)).not.toBe(leaderboardTopic(HUNT_B));
    expect(leaderboardTopic(HUNT_A)).toContain(HUNT_A);
  });

  it("gives the overall board a channel no hunt can share", () => {
    expect(leaderboardTopic()).toBe(leaderboardTopic(null));
    expect(leaderboardTopic()).not.toBe(leaderboardTopic(HUNT_A));
    expect(leaderboardTopic("global")).not.toBe(leaderboardTopic());
  });
});

describe("notifyLeaderboardChanged", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    h.warn.mockReset();
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts one request that pings the hunt's board and the overall board", async () => {
    await notifyLeaderboardChanged(HUNT_A);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/realtime/v1/api/broadcast");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("service-key");
    const body = JSON.parse(init.body);
    expect(body.messages.map((m: { topic: string }) => m.topic)).toEqual([
      leaderboardTopic(HUNT_A),
      leaderboardTopic(),
    ]);
    for (const message of body.messages) {
      expect(message.event).toBe(LEADERBOARD_CHANGED_EVENT);
    }
  });

  it("carries no player data: no ids, names or scores, only that something changed", async () => {
    await notifyLeaderboardChanged(HUNT_A);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    for (const message of body.messages) {
      expect(message.payload).toEqual({ changed: true });
      expect(Object.keys(message).sort()).toEqual(["event", "payload", "topic"]);
    }
  });

  it("never throws when Realtime is unreachable; the poll covers it", async () => {
    fetchMock.mockRejectedValue(new Error("connect timeout"));
    await expect(notifyLeaderboardChanged(HUNT_A)).resolves.toBeUndefined();
    expect(h.warn).toHaveBeenCalledWith(
      "leaderboard.ping_failed",
      expect.objectContaining({ huntId: HUNT_A, error: "connect timeout" })
    );
  });

  it("logs a refused ping instead of failing", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    await expect(notifyLeaderboardChanged(HUNT_A)).resolves.toBeUndefined();
    expect(h.warn).toHaveBeenCalledWith(
      "leaderboard.ping_failed",
      expect.objectContaining({ huntId: HUNT_A, status: 403 })
    );
  });

  it("does nothing when the Supabase settings are missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(notifyLeaderboardChanged(HUNT_A)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up after a short timeout so a slow Realtime never holds a request open", async () => {
    await notifyLeaderboardChanged(HUNT_A);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

/** A stand-in for the Realtime connection: records joins and lets the test drive them. */
function fakeTransport() {
  interface Join {
    topic: string;
    ping: (payload?: unknown) => void;
    status: (status: string) => void;
    left: boolean;
    finishLeaving: () => void;
  }
  const joins: Join[] = [];
  const transport: PingTransport = {
    join(topic, onPing, onStatus) {
      let finishLeaving: () => void = () => {};
      const leaving = new Promise<void>((resolve) => {
        finishLeaving = resolve;
      });
      const join: Join = { topic, ping: onPing, status: onStatus, left: false, finishLeaving };
      joins.push(join);
      return () => {
        join.left = true;
        return leaving;
      };
    },
  };
  return { transport, joins, open: () => joins.filter((j) => !j.left) };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("ping hub", () => {
  it("joins the topic once and passes pings on", () => {
    const t = fakeTransport();
    const hub = createPingHub(t.transport);
    const onPing = vi.fn();
    hub.subscribe(leaderboardTopic(HUNT_A), { onPing, onReconnect: vi.fn() });

    expect(t.joins).toHaveLength(1);
    expect(t.joins[0].topic).toBe(leaderboardTopic(HUNT_A));
    t.joins[0].ping();
    expect(onPing).toHaveBeenCalledTimes(1);
  });

  it("hands the listener nothing from the message: whatever a sender put in it is dropped", () => {
    const t = fakeTransport();
    const hub = createPingHub(t.transport);
    const onPing = vi.fn();
    hub.subscribe(leaderboardTopic(HUNT_A), { onPing, onReconnect: vi.fn() });

    t.joins[0].ping({ payload: { user_id: "u1", score: 999 } });
    expect(onPing).toHaveBeenCalledWith();
  });

  it("keeps boards on different hunts apart", () => {
    const t = fakeTransport();
    const hub = createPingHub(t.transport);
    const a = vi.fn();
    const b = vi.fn();
    const overall = vi.fn();
    hub.subscribe(leaderboardTopic(HUNT_A), { onPing: a, onReconnect: vi.fn() });
    hub.subscribe(leaderboardTopic(HUNT_B), { onPing: b, onReconnect: vi.fn() });
    hub.subscribe(leaderboardTopic(), { onPing: overall, onReconnect: vi.fn() });

    t.joins.find((j) => j.topic === leaderboardTopic(HUNT_A))?.ping();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(overall).not.toHaveBeenCalled();
  });

  it("shares one connection between two boards on the same hunt, and keeps it until both are gone", () => {
    const t = fakeTransport();
    const hub = createPingHub(t.transport);
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = hub.subscribe(leaderboardTopic(HUNT_A), { onPing: first, onReconnect: vi.fn() });
    const offSecond = hub.subscribe(leaderboardTopic(HUNT_A), { onPing: second, onReconnect: vi.fn() });
    expect(t.joins).toHaveLength(1);

    offFirst();
    expect(t.open()).toHaveLength(1);
    t.joins[0].ping();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    offSecond();
    expect(t.open()).toHaveLength(0);
  });

  it("reports a reconnect, but not the first connection", () => {
    const t = fakeTransport();
    const hub = createPingHub(t.transport);
    const onReconnect = vi.fn();
    hub.subscribe(leaderboardTopic(HUNT_A), { onPing: vi.fn(), onReconnect });

    t.joins[0].status("SUBSCRIBED");
    expect(onReconnect).not.toHaveBeenCalled();

    t.joins[0].status("CHANNEL_ERROR");
    t.joins[0].status("TIMED_OUT");
    expect(onReconnect).not.toHaveBeenCalled();

    t.joins[0].status("SUBSCRIBED");
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("waits for the old connection to finish closing before rejoining the same topic", async () => {
    const t = fakeTransport();
    const hub = createPingHub(t.transport);
    const off = hub.subscribe(leaderboardTopic(HUNT_A), { onPing: vi.fn(), onReconnect: vi.fn() });
    off();

    // Remount straight away (React strict mode, or back-and-forth navigation).
    const onPing = vi.fn();
    hub.subscribe(leaderboardTopic(HUNT_A), { onPing, onReconnect: vi.fn() });
    expect(t.joins).toHaveLength(1);

    t.joins[0].finishLeaving();
    await flush();
    expect(t.joins).toHaveLength(2);
    t.joins[1].ping();
    expect(onPing).toHaveBeenCalledTimes(1);
  });

  it("does not rejoin if the board went away again while the old connection was closing", async () => {
    const t = fakeTransport();
    const hub = createPingHub(t.transport);
    hub.subscribe(leaderboardTopic(HUNT_A), { onPing: vi.fn(), onReconnect: vi.fn() })();
    hub.subscribe(leaderboardTopic(HUNT_A), { onPing: vi.fn(), onReconnect: vi.fn() })();

    t.joins[0].finishLeaving();
    await flush();
    expect(t.joins).toHaveLength(1);
  });

  it("ignores a late message from a connection it already left", () => {
    const t = fakeTransport();
    const hub = createPingHub(t.transport);
    const onPing = vi.fn();
    const onReconnect = vi.fn();
    const off = hub.subscribe(leaderboardTopic(HUNT_A), { onPing, onReconnect });
    t.joins[0].status("SUBSCRIBED");
    off();

    t.joins[0].ping();
    t.joins[0].status("SUBSCRIBED");
    expect(onPing).not.toHaveBeenCalled();
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("carries on without pings when the connection cannot be opened", () => {
    const hub = createPingHub({
      join() {
        throw new Error("WebSocket is not available");
      },
    });
    const off = hub.subscribe(leaderboardTopic(HUNT_A), { onPing: vi.fn(), onReconnect: vi.fn() });
    expect(() => off()).not.toThrow();
  });
});
