import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type SupabaseDouble, type Row } from "@/__tests__/support/supabase-double";

/**
 * Team join / leave / create / list routes against the in-memory Supabase
 * double. The double does not model the partial unique index on
 * team_members(team_id, user_id) WHERE status = 'active'; the routes' own
 * checks are what is under test here.
 */

const h = vi.hoisted(() => ({ user: null as null | { id: string; role: string } }));

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
vi.mock("@/lib/utils/rate-limit", () => ({
  socialLimiter: { check: async () => {} },
}));

import { GET as listTeams, POST as createTeam } from "@/app/api/v1/teams/route";
import { POST as joinTeam } from "@/app/api/v1/teams/[id]/join/route";
import { POST as leaveTeam } from "@/app/api/v1/teams/[id]/leave/route";
import {
  addMember,
  formationMethodFor,
  latestPerUser,
  teamModeOf,
  type ServiceClient,
  type TeamRow,
} from "@/app/api/v1/teams/team-rules";

const SELF_HUNT = "hunt-self";
const ASSIGNED_HUNT = "hunt-assigned";

function seed(extra: Record<string, Row[]> = {}): SupabaseDouble {
  return installDouble({
    hunts: [
      { id: SELF_HUNT, title: "Campus Quest", play_mode: "team_self_select", status: "published", created_by: "teacher", max_team_size: 2, max_teams: null },
      { id: ASSIGNED_HUNT, title: "Class Hunt", play_mode: "team_assigned", status: "published", created_by: "teacher", max_team_size: 4, max_teams: null },
    ],
    teams: [
      { id: "t1", hunt_id: SELF_HUNT, name: "Owls", status: "forming", max_size: 2, created_at: "2026-01-01T00:00:00Z" },
      { id: "t2", hunt_id: SELF_HUNT, name: "Foxes", status: "forming", max_size: 2, created_at: "2026-01-02T00:00:00Z" },
      { id: "t3", hunt_id: ASSIGNED_HUNT, name: "Team 1", status: "ready", max_size: 4, created_at: "2026-01-03T00:00:00Z" },
      { id: "t4", hunt_id: ASSIGNED_HUNT, name: "Team 2", status: "ready", max_size: 4, created_at: "2026-01-04T00:00:00Z" },
    ],
    team_members: [],
    users: [
      { id: "ada", display_name: "Ada", avatar_url: null, profile_visibility: {} },
      { id: "bo", display_name: "Bo", avatar_url: null, profile_visibility: { display_name: "nobody" } },
      { id: "cy", display_name: "Cy", avatar_url: null, profile_visibility: { display_name: "team" } },
      { id: "me", display_name: "Me", avatar_url: null, profile_visibility: {} },
    ],
    roster_entries: [],
    play_sessions: [],
    ...extra,
  });
}

function member(teamId: string, userId: string, over: Row = {}): Row {
  return { id: `${teamId}-${userId}`, team_id: teamId, user_id: userId, role: "member", status: "active", joined_at: "2026-02-01T00:00:00Z", ...over };
}

function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const forTeam = (id: string) => ({ params: Promise.resolve({ id }) });
const join = (id: string) => joinTeam(req("POST", `/api/v1/teams/${id}/join`, {}), forTeam(id));
const leave = (id: string) => leaveTeam(req("POST", `/api/v1/teams/${id}/leave`, {}), forTeam(id));
const active = (db: SupabaseDouble, teamId: string) =>
  db.where("team_members", (r) => r.team_id === teamId && r.status === "active");

beforeEach(() => {
  h.user = { id: "me", role: "student" };
});

describe("team-rules helpers", () => {
  it("treats every team_* play mode except self-select as teacher-formed", () => {
    expect(teamModeOf("solo")).toBe("solo");
    expect(teamModeOf(null)).toBe("solo");
    expect(teamModeOf("team_self_select")).toBe("self_select");
    for (const mode of ["team_assigned", "team_random", "team_ai_smart", "team_custom_multi_dim"]) {
      expect(teamModeOf(mode)).toBe("assigned");
    }
  });

  it("maps formation strategies onto values the teams.formation_method CHECK allows", () => {
    const allowed = ["manual", "random", "personality", "balanced", "self_select"];
    for (const s of ["random", "teacher_assigned", "personality_similar", "personality_diverse", "performance_similar", "performance_diverse", "balanced"]) {
      expect(allowed).toContain(formationMethodFor(s));
    }
    expect(formationMethodFor("personality_diverse")).toBe("personality");
    expect(formationMethodFor("teacher_assigned")).toBe("manual");
  });

  it("keeps one (the newest) assessment per student", () => {
    const rows = [
      { user_id: "a", scores: { openness: 6 } },
      { user_id: "b", scores: { openness: 2 } },
      { user_id: "a", scores: { openness: 1 } },
    ];
    expect(latestPerUser(rows)).toEqual([rows[0], rows[1]]);
  });
});

describe("POST /teams/[id]/join", () => {
  it("requires a signed-in user", async () => {
    seed();
    h.user = null;
    expect((await join("t1")).status).toBe(401);
  });

  it("adds the player to a team with room", async () => {
    const db = seed({ team_members: [member("t1", "ada", { role: "captain" })] });
    const res = await join("t1");
    expect(res.status).toBe(201);
    expect(active(db, "t1").map((r) => r.user_id).sort()).toEqual(["ada", "me"]);
    expect(active(db, "t1").find((r) => r.user_id === "me")?.role).toBe("member");
  });

  it("refuses self-join on a teacher-formed hunt", async () => {
    const db = seed();
    const res = await join("t3");
    expect(res.status).toBe(403);
    expect(active(db, "t3")).toHaveLength(0);
  });

  it("refuses a full team", async () => {
    const db = seed({ team_members: [member("t1", "ada"), member("t1", "bo")] });
    const res = await join("t1");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/full/i);
    expect(active(db, "t1")).toHaveLength(2);
  });

  it("refuses a second team in the same hunt, and joining the same team twice", async () => {
    const db = seed({ team_members: [member("t2", "me")] });
    expect((await join("t1")).status).toBe(409);
    expect((await join("t2")).status).toBe(409);
    expect(db.where("team_members", (r) => r.user_id === "me")).toHaveLength(1);
  });

  it("refuses a disbanded team and an unknown team", async () => {
    const db = seed();
    db.table("teams")[0].status = "disbanded";
    expect((await join("t1")).status).toBe(409);
    expect((await join("nope")).status).toBe(404);
  });

  it("lets a player rejoin after leaving", async () => {
    const db = seed({ team_members: [member("t1", "me", { status: "left" })] });
    expect((await join("t1")).status).toBe(201);
    expect(active(db, "t1")).toHaveLength(1);
  });
});

describe("addMember under a race (checks passed, state changed before insert)", () => {
  const team = (db: SupabaseDouble, id: string) => db.table("teams").find((t) => t.id === id) as unknown as TeamRow;
  const client = (db: SupabaseDouble) => db.client as unknown as ServiceClient;

  it("backs out when the team filled up in the meantime", async () => {
    const db = seed({ team_members: [member("t1", "ada"), member("t1", "bo")] });
    await expect(addMember(client(db), team(db, "t1"), "me", "member")).rejects.toMatchObject({ statusCode: 409 });
    expect(db.where("team_members", (r) => r.user_id === "me")).toHaveLength(0);
    expect(active(db, "t1")).toHaveLength(2);
  });

  it("backs out when the player landed on another team of the hunt in the meantime", async () => {
    const db = seed({ team_members: [member("t2", "me")] });
    await expect(addMember(client(db), team(db, "t1"), "me", "member")).rejects.toMatchObject({ statusCode: 409 });
    expect(db.where("team_members", (r) => r.user_id === "me").map((r) => r.team_id)).toEqual(["t2"]);
  });

  it("backs out when the team was disbanded in the meantime", async () => {
    const db = seed();
    const stale = { ...team(db, "t1") };
    db.table("teams")[0].status = "disbanded";
    await expect(addMember(client(db), stale, "me", "member")).rejects.toMatchObject({ statusCode: 409 });
    expect(db.where("team_members", (r) => r.user_id === "me")).toHaveLength(0);
  });
});

describe("POST /teams/[id]/leave", () => {
  it("marks the membership left and keeps the team when others remain", async () => {
    const db = seed({ team_members: [member("t1", "me"), member("t1", "ada", { role: "captain" })] });
    const res = await leave("t1");
    expect(res.status).toBe(200);
    expect((await res.json()).disbanded).toBe(false);
    expect(active(db, "t1").map((r) => r.user_id)).toEqual(["ada"]);
    expect(db.table("teams")[0].status).toBe("forming");
  });

  it("disbands the team when the last member leaves", async () => {
    const db = seed({ team_members: [member("t1", "me", { role: "captain" })] });
    const res = await leave("t1");
    expect((await res.json()).disbanded).toBe(true);
    expect(db.table("teams")[0].status).toBe("disbanded");
  });

  it("hands the captaincy to the longest-standing remaining member", async () => {
    const db = seed({
      team_members: [
        member("t1", "me", { role: "captain", joined_at: "2026-02-01T00:00:00Z" }),
        member("t1", "bo", { joined_at: "2026-02-03T00:00:00Z" }),
        member("t1", "ada", { joined_at: "2026-02-02T00:00:00Z" }),
      ],
    });
    await leave("t1");
    expect(active(db, "t1").find((r) => r.role === "captain")?.user_id).toBe("ada");
  });

  it("404s for someone who is not on the team (it used to report success)", async () => {
    seed({ team_members: [member("t1", "ada")] });
    expect((await leave("t1")).status).toBe(404);
  });

  it("does not let a player leave a teacher-formed team", async () => {
    const db = seed({ team_members: [member("t3", "me")] });
    expect((await leave("t3")).status).toBe(403);
    expect(active(db, "t3")).toHaveLength(1);
  });

  it("keeps a player on the team their game in progress is scored for", async () => {
    const db = seed({
      team_members: [member("t1", "me"), member("t1", "ada")],
      play_sessions: [{ id: "s1", hunt_id: SELF_HUNT, user_id: "me", team_id: "t1", status: "active" }],
    });
    expect((await leave("t1")).status).toBe(409);
    expect(active(db, "t1")).toHaveLength(2);
  });
});

describe("POST /teams (create)", () => {
  const create = (body: unknown) => createTeam(req("POST", "/api/v1/teams", body));

  it("creates a self-select team sized by the hunt with the creator as captain", async () => {
    const db = seed();
    const res = await create({ hunt_id: SELF_HUNT, name: "  Night   Hawks ", max_size: 99 });
    expect(res.status).toBe(201);
    const { team } = await res.json();
    expect(team.name).toBe("Night Hawks");
    const row = db.table("teams").find((t) => t.id === team.id)!;
    expect(row.max_size).toBe(2); // hunt.max_team_size, not the 99 the player asked for
    expect(row.formation_method).toBe("self_select");
    expect(active(db, team.id)).toMatchObject([{ user_id: "me", role: "captain" }]);
  });

  it("refuses a player who is already on a team for the hunt, leaving no empty team", async () => {
    const db = seed({ team_members: [member("t1", "me")] });
    const res = await create({ hunt_id: SELF_HUNT, name: "Second" });
    expect(res.status).toBe(409);
    expect(db.table("teams").some((t) => t.name === "Second")).toBe(false);
  });

  it("refuses a duplicate name, a blank name and too many teams", async () => {
    const db = seed();
    expect((await create({ hunt_id: SELF_HUNT, name: "owls" })).status).toBe(409);
    expect((await create({ hunt_id: SELF_HUNT, name: "   " })).status).toBe(400);
    db.table("hunts")[0].max_teams = 2;
    expect((await create({ hunt_id: SELF_HUNT, name: "Third" })).status).toBe(409);
    expect(db.table("teams")).toHaveLength(4);
  });

  it("only lets whoever runs the hunt create teams on a teacher-formed hunt", async () => {
    const db = seed();
    expect((await create({ hunt_id: ASSIGNED_HUNT, name: "Sneaky" })).status).toBe(403);

    h.user = { id: "teacher", role: "teacher" };
    const res = await create({ hunt_id: ASSIGNED_HUNT, name: "Team 3" });
    expect(res.status).toBe(201);
    const { team } = await res.json();
    expect(db.table("teams").find((t) => t.id === team.id)?.formation_method).toBe("manual");
    expect(active(db, team.id)).toHaveLength(0); // the teacher is not put on it
  });
});

describe("GET /teams", () => {
  const list = (query: string) => listTeams(req("GET", `/api/v1/teams?${query}`));

  it("lists a self-select hunt's teams with active-member counts and privacy-filtered names", async () => {
    seed({
      team_members: [
        member("t1", "ada", { role: "captain" }),
        member("t1", "bo"),
        member("t2", "cy"),
        member("t2", "ada", { status: "left" }),
      ],
    });
    const res = await list(`hunt_id=${SELF_HUNT}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.hunt).toMatchObject({ team_mode: "self_select", playable: true, max_team_size: 2 });
    expect(body.viewer).toEqual({ id: "me", team_id: null, can_manage: false });

    const [owls, foxes] = body.teams;
    expect(owls).toMatchObject({ name: "Owls", member_count: 2, is_full: true });
    expect(foxes).toMatchObject({ name: "Foxes", member_count: 1, is_full: false });

    const name = (team: { team_members: { user_id: string; users: { display_name: string | null } }[] }, id: string) =>
      team.team_members.find((m) => m.user_id === id)?.users.display_name;
    expect(name(owls, "ada")).toBe("Ada"); // unset -> everyone
    expect(name(owls, "bo")).toBeNull(); // display_name: nobody
    expect(name(foxes, "cy")).toBeNull(); // display_name: team, and the viewer is not a teammate

    // Visibility settings themselves never leave the server.
    expect(JSON.stringify(body)).not.toContain("profile_visibility");
  });

  it("shows a team-only name to a teammate, and honours a per-person override", async () => {
    const db = seed({ team_members: [member("t2", "cy"), member("t2", "me")] });
    let body = await (await list(`hunt_id=${SELF_HUNT}`)).json();
    expect(body.viewer.team_id).toBe("t2");
    expect(body.teams[1].team_members.find((m: { user_id: string }) => m.user_id === "cy").users.display_name).toBe("Cy");

    db.table("users").find((u) => u.id === "cy")!.profile_visibility_overrides = { me: { display_name: "nobody" } };
    body = await (await list(`hunt_id=${SELF_HUNT}`)).json();
    expect(body.teams[1].team_members.find((m: { user_id: string }) => m.user_id === "cy").users.display_name).toBeNull();
  });

  it("shows a player only their own team on a teacher-formed hunt", async () => {
    seed({ team_members: [member("t3", "ada"), member("t4", "me"), member("t4", "bo")] });
    let body = await (await list(`hunt_id=${ASSIGNED_HUNT}`)).json();
    expect(body.hunt.team_mode).toBe("assigned");
    expect(body.teams.map((t: { id: string }) => t.id)).toEqual(["t4"]);
    expect(body.viewer.team_id).toBe("t4");

    h.user = { id: "cy", role: "student" }; // not placed yet
    body = await (await list(`hunt_id=${ASSIGNED_HUNT}`)).json();
    expect(body.teams).toEqual([]);
    expect(body.viewer.team_id).toBeNull();

    h.user = { id: "teacher", role: "teacher" }; // runs the hunt
    body = await (await list(`hunt_id=${ASSIGNED_HUNT}`)).json();
    expect(body.teams).toHaveLength(2);
    expect(body.viewer.can_manage).toBe(true);
  });

  it("lists my teams with their hunt, without teams I left or that were disbanded", async () => {
    const db = seed({
      team_members: [member("t1", "me"), member("t1", "ada", { status: "left" }), member("t3", "me", { status: "left" }), member("t4", "me")],
    });
    db.table("teams").find((t) => t.id === "t4")!.status = "disbanded";
    const body = await (await list("mine=true")).json();
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0]).toMatchObject({
      id: "t1",
      member_count: 1,
      hunt: { id: SELF_HUNT, title: "Campus Quest", playable: true, team_mode: "self_select" },
    });
  });

  it("requires sign-in and a known hunt", async () => {
    seed();
    expect((await list("hunt_id=missing")).status).toBe(404);
    h.user = null;
    expect((await list(`hunt_id=${SELF_HUNT}`)).status).toBe(401);
  });
});
