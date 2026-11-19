import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

/**
 * Issue #13: real names on the leaderboard, for the people running an event.
 * The rule under test: GET /api/v1/leaderboard returns real names only when the
 * caller is a platform admin or researcher, or the creator of that hunt, AND
 * asks with real_names=1. Anything else gets exactly the response it gets today.
 */

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
}));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/rate-limit", () => ({ generalLimiter: { check: async () => {} } }));
vi.mock("@/lib/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET as leaderboard } from "@/app/api/v1/leaderboard/route";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// People who look at boards.
const PLAYER = id(1);
const TEACHER = id(2); // a teacher, but not the creator of HUNT
const CREATOR = id(3);
const ADMIN = id(4);
const RESEARCHER = id(5);
// People on the boards.
const ADA = id(11);
const BO = id(12);
const KID = id(13);
const TESS = id(14);
const YOUNG = id(15);
const HANK = id(16);

const HUNT = id(101); // codenames, created by CREATOR
const OTHER_HUNT = id(102); // created by TEACHER
const NAMED_HUNT = id(103); // identity_mode real_name, created by CREATOR

const REAL_NAMES = ["Ada Lovelace", "Kid Real", "Tess Teen", "Young Adult", "Hidden Hank", "Pat Player"];

function user(userId: string, role: string, displayName: string, extra: Row = {}): Row {
  return {
    id: userId,
    role,
    display_name: displayName,
    avatar_url: null,
    email: `${displayName.toLowerCase().replace(/\W+/g, "")}@example.edu`,
    date_of_birth: null,
    deleted_at: null,
    profile_visibility: {},
    metadata: {},
    ...extra,
  };
}

const USERS: Row[] = [
  user(PLAYER, "adult", "pat_p", { metadata: { real_name: "Pat Player" } }),
  user(TEACHER, "teacher", "Ms Other"),
  user(CREATOR, "teacher", "Ms Creator"),
  user(ADMIN, "admin", "Admin"),
  user(RESEARCHER, "researcher", "Researcher"),
  user(ADA, "adult", "ada_l", { metadata: { real_name: "Ada Lovelace", privacy_default: "private" } }),
  // No real name on file, and a display name restricted to nobody.
  user(BO, "adult", "bo", { profile_visibility: { display_name: "nobody" } }),
  user(KID, "child", "Kid", { metadata: { real_name: "Kid Real" } }),
  user(TESS, "teen", "tess", { metadata: { real_name: "Tess Teen" } }),
  // An adult-role account whose date of birth says under 18.
  user(YOUNG, "adult", "young", { date_of_birth: "2010-06-01", metadata: { real_name: "Young Adult" } }),
  // Restricted total_score: left off the boards other players see.
  user(HANK, "adult", "hank", { profile_visibility: { total_score: "nobody" }, metadata: { real_name: "Hidden Hank" } }),
];

function session(n: number, huntId: string, userId: string, score: number, codename: string | null): Row {
  return { id: `s${n}`, hunt_id: huntId, user_id: userId, total_score: score, codename, status: "completed" };
}

const SESSIONS: Row[] = [
  session(1, HUNT, ADA, 500, "Swift Fox"),
  session(2, HUNT, BO, 400, "Quiet Owl"),
  session(3, HUNT, KID, 300, "Brave Otter"),
  session(4, HUNT, TESS, 200, "Bold Hare"),
  session(5, HUNT, YOUNG, 150, "Keen Wren"),
  session(6, HUNT, HANK, 100, "Sly Lynx"),
  session(7, HUNT, PLAYER, 50, "Calm Deer"),
  session(8, OTHER_HUNT, ADA, 10, "Swift Fox"),
  session(9, NAMED_HUNT, ADA, 90, null),
  session(10, NAMED_HUNT, BO, 80, null),
  session(11, NAMED_HUNT, KID, 70, null),
  session(12, NAMED_HUNT, HANK, 60, null),
];

const HUNTS: Row[] = [
  { id: HUNT, identity_mode: "codename_assigned", created_by: CREATOR },
  { id: OTHER_HUNT, identity_mode: "codename_assigned", created_by: TEACHER },
  { id: NAMED_HUNT, identity_mode: "real_name", created_by: CREATOR },
];

/** What overall_leaderboard() returns: finished-hunt score per player, best first. */
const RANKED: Row[] = [
  { user_id: ADA, total_score: 600, hunts_completed: 3, display_name: "ada_l", avatar_url: null, role: "adult", best_codename: null },
  { user_id: BO, total_score: 480, hunts_completed: 2, display_name: "bo", avatar_url: null, role: "adult", best_codename: null },
  { user_id: KID, total_score: 370, hunts_completed: 2, display_name: "Kid", avatar_url: null, role: "child", best_codename: "Brave Otter" },
  { user_id: HANK, total_score: 160, hunts_completed: 2, display_name: "hank", avatar_url: null, role: "adult", best_codename: "Sly Lynx" },
  { user_id: PLAYER, total_score: 50, hunts_completed: 1, display_name: "pat_p", avatar_url: null, role: "adult", best_codename: "Calm Deer" },
];

let db: SupabaseDouble;

beforeEach(() => {
  h.user = null;
  db = installDouble(
    {
      users: USERS.map((u) => ({ ...u })),
      hunts: HUNTS.map((x) => ({ ...x })),
      play_sessions: SESSIONS.map((s) => ({ ...s })),
      audit_log: [],
    },
    {
      embeds: { play_sessions: { users: { table: "users", localKey: "user_id" } } },
      rpc: { overall_leaderboard: (args) => RANKED.slice(0, args.p_limit as number) },
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
});

interface Entry {
  user_id: string;
  display_name: string | null;
  real_name?: string | null;
  real_name_status?: string;
  shown_as?: string | null;
  [key: string]: unknown;
}

interface Body {
  entries: Entry[];
  real_names?: boolean;
  [key: string]: unknown;
}

function as(viewer: string | null): void {
  const row = USERS.find((u) => u.id === viewer);
  h.user = row ? { id: row.id as string, role: row.role as string } : null;
}

async function fetchRaw(query: string): Promise<string> {
  const res = await leaderboard(new NextRequest(`http://localhost:3000/api/v1/leaderboard${query}`));
  expect(res.status).toBe(200);
  return res.text();
}

async function fetchBoard(query: string): Promise<Body> {
  return JSON.parse(await fetchRaw(query)) as Body;
}

const byId = (body: Body) => Object.fromEntries(body.entries.map((e) => [e.user_id, e]));

function expectNoRealNames(raw: string): void {
  const body = JSON.parse(raw) as Body;
  expect(body).not.toHaveProperty("real_names");
  for (const entry of body.entries) {
    expect(entry).not.toHaveProperty("real_name");
    expect(entry).not.toHaveProperty("real_name_status");
    expect(entry).not.toHaveProperty("shown_as");
  }
  for (const name of REAL_NAMES) expect(raw).not.toContain(name);
}

describe("GET /api/v1/leaderboard?real_names=1: who is refused", () => {
  const BOARDS = [`?hunt_id=${HUNT}`, `?hunt_id=${NAMED_HUNT}`, ""];
  const withParam = (query: string) => `${query}${query ? "&" : "?"}real_names=1`;

  it.each([
    ["a player", PLAYER],
    ["a teacher who did not create the hunt", TEACHER],
    ["a signed-out caller", null],
  ])("%s gets today's response, with no real names, even when asking", async (_label, viewer) => {
    for (const board of BOARDS) {
      as(viewer);
      const plain = await fetchRaw(board);
      const asked = await fetchRaw(withParam(board));
      expect(asked).toBe(plain);
      expectNoRealNames(asked);
    }
    expect(db.table("audit_log")).toHaveLength(0);
  });

  it("a child or teen account is refused too", async () => {
    for (const viewer of [KID, TESS]) {
      as(viewer);
      const asked = await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
      expect(asked).toBe(await fetchRaw(`?hunt_id=${HUNT}`));
      expectNoRealNames(asked);
    }
  });

  it("the creator of one hunt is refused on someone else's hunt and on the overall board", async () => {
    as(CREATOR);
    for (const board of [`?hunt_id=${OTHER_HUNT}`, ""]) {
      const asked = await fetchRaw(withParam(board));
      expect(asked).toBe(await fetchRaw(board));
      expectNoRealNames(asked);
    }
    // And the other way round: TEACHER created OTHER_HUNT, not HUNT.
    as(TEACHER);
    expect((await fetchBoard(`?hunt_id=${OTHER_HUNT}&real_names=1`)).real_names).toBe(true);
    expectNoRealNames(await fetchRaw(`?hunt_id=${HUNT}&real_names=1`));
  });

  it("nobody gets real names for a hunt that does not exist", async () => {
    as(ADMIN);
    const missing = `?hunt_id=${id(999)}`;
    const asked = await fetchRaw(`${missing}&real_names=1`);
    expect(asked).toBe(await fetchRaw(missing));
    expectNoRealNames(asked);
  });

  it("only real_names=1 switches it on", async () => {
    as(ADMIN);
    const plain = await fetchRaw(`?hunt_id=${HUNT}`);
    for (const value of ["0", "true", "", "yes"]) {
      expect(await fetchRaw(`?hunt_id=${HUNT}&real_names=${value}`)).toBe(plain);
    }
  });
});

describe("GET /api/v1/leaderboard without real_names: unchanged for staff", () => {
  it("an admin's hunt board has exactly the fields it has today", async () => {
    as(ADMIN);
    const raw = await fetchRaw(`?hunt_id=${HUNT}`);
    expectNoRealNames(raw);
    const body = JSON.parse(raw) as Body;
    expect(Object.keys(body)).toEqual(["entries", "identity_mode", "viewer_id", "me"]);
    expect(body.identity_mode).toBe("codename_assigned");
    expect(body.viewer_id).toBe(ADMIN);
    expect(body.me).toBeNull();
    expect(body.entries).toEqual(
      SESSIONS.filter((s) => s.hunt_id === HUNT).map((s) => ({
        user_id: s.user_id,
        score: s.total_score,
        display_name: USERS.find((u) => u.id === s.user_id)!.display_name,
        avatar_url: null,
        codename: s.codename,
        profile_linkable: true,
      }))
    );
    expect(db.table("audit_log")).toHaveLength(0);
  });

  it("an admin's overall board has exactly the fields it has today", async () => {
    as(ADMIN);
    const raw = await fetchRaw("");
    expectNoRealNames(raw);
    const body = JSON.parse(raw) as Body;
    expect(Object.keys(body)).toEqual(["entries", "identity_mode", "viewer_id", "me"]);
    expect(body.entries).toEqual([
      { user_id: ADA, score: 600, hunts_completed: 3, display_name: "ada_l", avatar_url: null, profile_linkable: true },
      { user_id: BO, score: 480, hunts_completed: 2, display_name: "Anonymous", avatar_url: null, profile_linkable: false },
      { user_id: KID, score: 370, hunts_completed: 2, display_name: "Brave Otter", avatar_url: null, profile_linkable: false },
      { user_id: PLAYER, score: 50, hunts_completed: 1, display_name: "Calm Deer", avatar_url: null, profile_linkable: false },
    ]);
  });

  it("turning real names on for one request changes nothing for the next plain one", async () => {
    as(ADMIN);
    const before = await fetchRaw(`?hunt_id=${HUNT}`);
    await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
    expect(await fetchRaw(`?hunt_id=${HUNT}`)).toBe(before);
    as(PLAYER);
    expectNoRealNames(await fetchRaw(`?hunt_id=${HUNT}`));
  });
});

describe("GET /api/v1/leaderboard?real_names=1: who is allowed", () => {
  it.each([
    ["an admin", ADMIN],
    ["a researcher", RESEARCHER],
    ["the hunt's creator", CREATOR],
  ])("%s gets real names on the hunt board", async (_label, viewer) => {
    as(viewer);
    const body = await fetchBoard(`?hunt_id=${HUNT}&real_names=1`);
    expect(body.real_names).toBe(true);
    const rows = byId(body);
    expect(rows[ADA]).toMatchObject({ real_name: "Ada Lovelace", real_name_status: "on_file" });
    expect(rows[PLAYER]).toMatchObject({ real_name: "Pat Player", real_name_status: "on_file" });
    expect(rows[HANK]).toMatchObject({ real_name: "Hidden Hank", real_name_status: "on_file" });
  });

  it("adds to the board without changing who is on it or what each row already said", async () => {
    as(CREATOR);
    const plain = await fetchBoard(`?hunt_id=${HUNT}`);
    const named = await fetchBoard(`?hunt_id=${HUNT}&real_names=1`);
    const strip = ({ real_name, real_name_status, shown_as, ...rest }: Entry) => {
      void real_name;
      void real_name_status;
      void shown_as;
      return rest;
    };
    expect(named.entries.map(strip)).toEqual(plain.entries);
    expect({ ...named, entries: plain.entries, real_names: undefined }).toEqual({ ...plain, real_names: undefined });
  });

  it("gives a clear status, never an email, when no real name is on file", async () => {
    as(ADMIN);
    const raw = await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
    expect(byId(JSON.parse(raw) as Body)[BO]).toMatchObject({ real_name: null, real_name_status: "not_on_file" });
    expect(raw).not.toContain("@");
    expect(raw).not.toContain("example.edu");
    // Nothing else from the profile's metadata rides along.
    expect(raw).not.toContain("privacy_default");
    expect(raw).not.toContain("date_of_birth");
  });

  it("withholds the real names of children, teens and anyone under 18", async () => {
    for (const viewer of [ADMIN, RESEARCHER, CREATOR]) {
      as(viewer);
      const raw = await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
      const rows = byId(JSON.parse(raw) as Body);
      for (const minor of [KID, TESS, YOUNG]) {
        expect(rows[minor]).toMatchObject({ real_name: null, real_name_status: "withheld_minor" });
      }
      for (const name of ["Kid Real", "Tess Teen", "Young Adult"]) expect(raw).not.toContain(name);
    }
  });

  it("marks the response as not cacheable", async () => {
    as(ADMIN);
    const res = await leaderboard(
      new NextRequest(`http://localhost:3000/api/v1/leaderboard?hunt_id=${HUNT}&real_names=1`)
    );
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("says what other players see on a codename hunt", async () => {
    as(CREATOR);
    const rows = byId(await fetchBoard(`?hunt_id=${HUNT}&real_names=1`));
    expect(rows[ADA].shown_as).toBe("Swift Fox");
    expect(rows[BO].shown_as).toBe("Quiet Owl");
    // Hank restricted his score, so other players' boards leave him out.
    expect(rows[HANK].shown_as).toBeNull();
  });

  it("says what other players see on a real-name hunt, matching a signed-out viewer's board", async () => {
    as(null);
    const publicRows = byId(await fetchBoard(`?hunt_id=${NAMED_HUNT}`));
    as(CREATOR);
    const rows = byId(await fetchBoard(`?hunt_id=${NAMED_HUNT}&real_names=1`));
    expect(rows[ADA].shown_as).toBe("ada_l");
    expect(rows[BO].shown_as).toBe("Anonymous");
    expect(rows[KID].shown_as).toBe("K");
    expect(rows[HANK].shown_as).toBeNull();
    for (const player of [ADA, BO, KID]) expect(rows[player].shown_as).toBe(publicRows[player].display_name);
    expect(publicRows[HANK]).toBeUndefined();
  });

  it("admins and researchers get real names on the overall board, with the same rows as before", async () => {
    for (const viewer of [ADMIN, RESEARCHER]) {
      as(viewer);
      const plain = await fetchBoard("");
      const named = await fetchBoard("?real_names=1");
      expect(named.real_names).toBe(true);
      expect(named.entries.map((e) => [e.user_id, e.display_name])).toEqual(
        plain.entries.map((e) => [e.user_id, e.display_name])
      );
      const rows = byId(named);
      expect(rows[ADA]).toMatchObject({ real_name: "Ada Lovelace", real_name_status: "on_file", shown_as: "ada_l" });
      expect(rows[BO]).toMatchObject({ real_name: null, real_name_status: "not_on_file", shown_as: "Anonymous" });
      expect(rows[KID]).toMatchObject({ real_name: null, real_name_status: "withheld_minor", shown_as: "Brave Otter" });
      // Still left off, as on the plain board: the toggle never adds rows.
      expect(rows[HANK]).toBeUndefined();
    }
  });
});

describe("GET /api/v1/leaderboard?real_names=1: audit trail", () => {
  const auditRows = () => db.table("audit_log");

  it("records who viewed real names on which board, without the names", async () => {
    as(CREATOR);
    await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0]).toMatchObject({
      user_id: CREATOR,
      action: "update",
      entity_type: "leaderboard_real_names",
      entity_id: HUNT,
      new_values: { op: "real_names_viewed", board: "hunt", basis: "hunt_creator", viewer_role: "teacher" },
    });
    const stored = JSON.stringify(auditRows());
    for (const name of REAL_NAMES) expect(stored).not.toContain(name);
    for (const player of [ADA, BO, KID, HANK]) expect(stored).not.toContain(player);
  });

  it("records an admin's view of the overall board with no hunt attached", async () => {
    as(ADMIN);
    await fetchRaw("?real_names=1");
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0]).toMatchObject({
      user_id: ADMIN,
      entity_type: "leaderboard_real_names",
      entity_id: null,
      new_values: { op: "real_names_viewed", board: "overall", basis: "staff", viewer_role: "admin" },
    });
  });

  it("writes one record per viewer and board while the board keeps refreshing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T18:00:00Z"));
    as(ADMIN);
    await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
    vi.setSystemTime(new Date("2026-11-18T18:00:15Z"));
    await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
    vi.setSystemTime(new Date("2026-11-18T18:05:00Z"));
    await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
    expect(auditRows()).toHaveLength(1);

    // A different board, and a different viewer, are separate records.
    await fetchRaw(`?hunt_id=${NAMED_HUNT}&real_names=1`);
    await fetchRaw("?real_names=1");
    as(RESEARCHER);
    await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
    expect(auditRows()).toHaveLength(4);

    // Still watching after the window: recorded again.
    as(ADMIN);
    vi.setSystemTime(new Date("2026-11-18T18:11:00Z"));
    await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
    expect(auditRows()).toHaveLength(5);
  });

  it("records nothing when real names were not asked for, or not allowed", async () => {
    as(ADMIN);
    await fetchRaw(`?hunt_id=${HUNT}`);
    await fetchRaw("");
    as(PLAYER);
    await fetchRaw(`?hunt_id=${HUNT}&real_names=1`);
    as(null);
    await fetchRaw("?real_names=1");
    expect(auditRows()).toHaveLength(0);
  });
});
