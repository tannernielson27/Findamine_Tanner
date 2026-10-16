import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";
import {
  MAX_AUDIO_BYTES,
  formatAudioAnswer,
  isOwnAudioPath,
  matchesAudioContainer,
  parseAudioAnswer,
} from "@/lib/play/audio-answer";

interface StorageState {
  uploads: { bucket: string; path: string; contentType?: string; size: number }[];
  removed: { bucket: string; paths: string[] }[];
  listed: Record<string, { name: string }[]>;
  signed: { bucket: string; path: string; expiresIn: number }[];
  uploadError: { message: string } | null;
}

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  storage: null as unknown as StorageState,
}));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, file: Blob, opts?: { contentType?: string }) => {
        if (h.storage.uploadError) return { data: null, error: h.storage.uploadError };
        h.storage.uploads.push({ bucket, path, contentType: opts?.contentType, size: file.size });
        return { data: { path }, error: null };
      },
      list: async (folder: string, opts?: { search?: string }) => ({
        data: (h.storage.listed[`${bucket}:${folder}`] || []).filter((f) => !opts?.search || f.name.includes(opts.search)),
        error: null,
      }),
      remove: async (paths: string[]) => {
        h.storage.removed.push({ bucket, paths });
        return { data: [], error: null };
      },
      createSignedUrl: async (path: string, expiresIn: number) => {
        h.storage.signed.push({ bucket, path, expiresIn });
        return { data: { signedUrl: `https://signed.example/${path}?t=1` }, error: null };
      },
    }),
  };
  const client = async () => ({ ...m.current().client, storage });
  return { createSupabaseServiceClient: client, createSupabaseServerClient: client };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  playLimiter: { check: async () => {} },
  uploadLimiter: { check: async () => {} },
}));
vi.mock("@/lib/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/services/referral", () => ({ awardReferralPoints: async () => {} }));
vi.mock("@/lib/services/privacy-notice", () => ({ recordPrivacyNotice: async () => null }));
vi.mock("@/lib/services/gamification", () => ({
  updateStreak: async () => ({ current: 1, longest: 1, justBroke: false, badgesEarned: [] }),
  evaluateBadges: async () => [],
}));

import { POST as uploadAudio, GET as audioUrl } from "@/app/api/v1/play/[huntId]/audio/route";
import { POST as answer } from "@/app/api/v1/play/[huntId]/answer/route";

const HUNT = "hunt-1";
const SESSION = "sess-1";
const FIND = "find-1";
const COMPLETION = "comp-1";
const params = { params: Promise.resolve({ huntId: HUNT }) };

const WEBM = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81];
// ....ftypM4A
const MP4 = [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20];

function seed(overrides: Record<string, Row[]> = {}): SupabaseDouble {
  return installDouble(
    {
      play_sessions: [
        { id: SESSION, hunt_id: HUNT, user_id: "11111111-aaaa-4aaa-8aaa-111111111111", status: "active", started_at: new Date().toISOString(), total_score: 0 },
      ],
      tasks: [{ id: "task-1", challenge_type: "audio_response", content: { question: "Say it", correct_answer: null } }],
      finds: [{ id: FIND, hunt_id: HUNT, task_id: "task-1", location_id: "loc-1" }],
      find_completions: [
        {
          id: COMPLETION,
          play_session_id: SESSION,
          find_id: FIND,
          arrived_at: new Date().toISOString(),
          completed_at: null,
          hints_used: 0,
          clue_hints_used: 0,
          metadata: {},
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      ...overrides,
    },
    { embeds: { finds: { tasks: { table: "tasks", localKey: "task_id" } } } }
  );
}

function recording(bytes: number[], type: string, size = bytes.length): File {
  const body = new Uint8Array(size);
  body.set(bytes.slice(0, size));
  return new File([body], "answer.bin", { type });
}

function uploadRequest(fields: { file?: File; find_id?: string; duration_seconds?: string }): NextRequest {
  const form = new FormData();
  if (fields.file) form.append("file", fields.file);
  if (fields.find_id !== undefined) form.append("find_id", fields.find_id);
  if (fields.duration_seconds !== undefined) form.append("duration_seconds", fields.duration_seconds);
  return new NextRequest(`http://localhost:3000/api/v1/play/${HUNT}/audio`, { method: "POST", body: form });
}

const validUpload = (file: File = recording(WEBM, "audio/webm;codecs=opus")) =>
  uploadRequest({ file, find_id: FIND, duration_seconds: "12" });

beforeEach(() => {
  h.user = { id: "11111111-aaaa-4aaa-8aaa-111111111111", role: "adult" };
  h.storage = { uploads: [], removed: [], listed: {}, signed: [], uploadError: null };
});

describe("audio answer helpers", () => {
  it("round-trips an uploaded and a device-only answer", () => {
    expect(parseAudioAnswer(formatAudioAnswer(12.4, "11111111-aaaa-4aaa-8aaa-111111111111/c_1.webm"))).toEqual({ seconds: 12, path: "11111111-aaaa-4aaa-8aaa-111111111111/c_1.webm" });
    expect(parseAudioAnswer("[audio:3s:local]")).toEqual({ seconds: 3, path: null });
    expect(parseAudioAnswer("[audio:12s]")).toBeNull();
    expect(parseAudioAnswer(42)).toBeNull();
  });

  it("only accepts paths in the player's folder for this stop", () => {
    expect(isOwnAudioPath("11111111-aaaa-4aaa-8aaa-111111111111/comp-1_123.m4a", "11111111-aaaa-4aaa-8aaa-111111111111", "comp-1")).toBe(true);
    expect(isOwnAudioPath("u2/comp-1_123.m4a", "11111111-aaaa-4aaa-8aaa-111111111111", "comp-1")).toBe(false);
    expect(isOwnAudioPath("11111111-aaaa-4aaa-8aaa-111111111111/comp-2_123.m4a", "11111111-aaaa-4aaa-8aaa-111111111111", "comp-1")).toBe(false);
    expect(isOwnAudioPath("11111111-aaaa-4aaa-8aaa-111111111111/comp-1_123.m4a/../../u2/x.webm", "11111111-aaaa-4aaa-8aaa-111111111111", "comp-1")).toBe(false);
  });

  it("recognises WebM, MP4 and Ogg containers by their magic bytes", () => {
    expect(matchesAudioContainer("audio/webm", new Uint8Array(WEBM))).toBe(true);
    expect(matchesAudioContainer("audio/mp4", new Uint8Array(MP4))).toBe(true);
    expect(matchesAudioContainer("audio/ogg", new TextEncoder().encode("OggS\0\0"))).toBe(true);
    expect(matchesAudioContainer("audio/webm", new Uint8Array(MP4))).toBe(false);
  });
});

describe("POST /play/[huntId]/audio", () => {
  it("rejects an unauthenticated request", async () => {
    seed();
    h.user = null;
    const res = await uploadAudio(validUpload(), params);
    expect(res.status).toBe(401);
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("requires find_id and a duration within the limit", async () => {
    seed();
    expect((await uploadAudio(uploadRequest({ file: recording(WEBM, "audio/webm"), duration_seconds: "5" }), params)).status).toBe(400);
    for (const d of ["0", "abc", "600"]) {
      const res = await uploadAudio(uploadRequest({ file: recording(WEBM, "audio/webm"), find_id: FIND, duration_seconds: d }), params);
      expect(res.status).toBe(400);
    }
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("needs an active session at an arrived, unfinished audio stop", async () => {
    seed({ play_sessions: [] });
    expect((await uploadAudio(validUpload(), params)).status).toBe(404);

    seed({ tasks: [{ id: "task-1", challenge_type: "short_text", content: {} }] });
    expect((await uploadAudio(validUpload(), params)).status).toBe(400);

    seed({ find_completions: [] });
    expect((await uploadAudio(validUpload(), params)).status).toBe(400);

    const db = seed();
    (db.table("find_completions")[0] as Row).completed_at = new Date().toISOString();
    expect((await uploadAudio(validUpload(), params)).status).toBe(409);
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("rejects audio types MediaRecorder does not produce", async () => {
    seed();
    const res = await uploadAudio(validUpload(recording(WEBM, "audio/wav")), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not allowed/);
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("rejects a file whose bytes are not the container it claims", async () => {
    seed();
    const res = await uploadAudio(validUpload(recording(MP4, "audio/webm")), params);
    expect(res.status).toBe(400);
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("rejects a recording over the size cap", async () => {
    seed();
    const res = await uploadAudio(validUpload(recording(WEBM, "audio/webm", MAX_AUDIO_BYTES + 1)), params);
    expect(res.status).toBe(413);
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("rejects a request with no recording for a teen or adult", async () => {
    seed();
    const res = await uploadAudio(uploadRequest({ find_id: FIND, duration_seconds: "4" }), params);
    expect(res.status).toBe(400);
  });

  it("never stores a child's recording, even if one is sent", async () => {
    seed();
    h.user = { id: "11111111-aaaa-4aaa-8aaa-111111111111", role: "child" };
    const res = await uploadAudio(validUpload(), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ answer: "[audio:12s:local]", local_only: true });
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("stores a Chrome WebM recording in the player's private folder", async () => {
    seed();
    const res = await uploadAudio(validUpload(), params);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(h.storage.uploads).toHaveLength(1);
    const [up] = h.storage.uploads;
    expect(up.bucket).toBe("challenge-audio");
    expect(up.contentType).toBe("audio/webm");
    expect(up.path).toMatch(/^11111111-aaaa-4aaa-8aaa-111111111111\/comp-1_\d+\.webm$/);
    expect(body).toEqual({ answer: `[audio:12s:${up.path}]`, local_only: false });
  });

  it("stores an iOS Safari/WKWebView audio/mp4 recording as .m4a", async () => {
    seed();
    const res = await uploadAudio(validUpload(recording(MP4, "audio/mp4")), params);
    expect(res.status).toBe(201);
    expect(h.storage.uploads[0]).toMatchObject({ contentType: "audio/mp4" });
    expect(h.storage.uploads[0].path).toMatch(/^11111111-aaaa-4aaa-8aaa-111111111111\/comp-1_\d+\.m4a$/);
  });

  it("deletes earlier takes for the same stop before storing a new one", async () => {
    seed();
    h.storage.listed["challenge-audio:11111111-aaaa-4aaa-8aaa-111111111111"] = [{ name: "comp-1_100.webm" }, { name: "comp-9_100.webm" }];
    await uploadAudio(validUpload(), params);
    expect(h.storage.removed).toEqual([{ bucket: "challenge-audio", paths: ["11111111-aaaa-4aaa-8aaa-111111111111/comp-1_100.webm"] }]);
  });

  it("reports a storage failure so the player can retry", async () => {
    seed();
    h.storage.uploadError = { message: "Bucket not found" };
    const res = await uploadAudio(validUpload(), params);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/try again/i);
  });
});

describe("POST /play/[huntId]/answer with a spoken answer", () => {
  const submit = (value: string) =>
    answer(
      new NextRequest(`http://localhost:3000/api/v1/play/${HUNT}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ find_id: FIND, answer: value }),
      }),
      params
    );

  it("accepts a reference to the player's own upload and stores it", async () => {
    const db = seed();
    const res = await submit("[audio:12s:11111111-aaaa-4aaa-8aaa-111111111111/comp-1_1700000000000.webm]");
    expect(res.status).toBe(200);
    expect(db.table("find_completions")[0].answer_value).toBe("[audio:12s:11111111-aaaa-4aaa-8aaa-111111111111/comp-1_1700000000000.webm]");
  });

  it("rejects the old placeholder and another player's recording", async () => {
    seed();
    expect((await submit("[audio:12s]")).status).toBe(400);
    expect((await submit("[audio:12s:u2/comp-1_1.webm]")).status).toBe(400);
    expect((await submit("[audio:12s:local]")).status).toBe(400);
  });

  it("accepts a device-only answer from a child", async () => {
    seed();
    h.user = { id: "11111111-aaaa-4aaa-8aaa-111111111111", role: "child" };
    expect((await submit("[audio:12s:local]")).status).toBe(200);
  });
});

describe("GET /play/[huntId]/audio", () => {
  const get = (query: string) =>
    audioUrl(new NextRequest(`http://localhost:3000/api/v1/play/${HUNT}/audio?${query}`), params);

  function seedSubmitted(): SupabaseDouble {
    const db = seed();
    (db.table("find_completions")[0] as Row).answer_value = "[audio:12s:11111111-aaaa-4aaa-8aaa-111111111111/comp-1_1.webm]";
    return db;
  }

  it("gives the player a short-lived signed URL for their recording", async () => {
    seedSubmitted();
    const res = await get(`find_id=${FIND}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain("11111111-aaaa-4aaa-8aaa-111111111111/comp-1_1.webm");
    expect(h.storage.signed).toEqual([{ bucket: "challenge-audio", path: "11111111-aaaa-4aaa-8aaa-111111111111/comp-1_1.webm", expiresIn: 300 }]);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("does not let another player listen", async () => {
    seedSubmitted();
    h.user = { id: "u2", role: "teacher" };
    expect((await get(`find_id=${FIND}&user_id=11111111-aaaa-4aaa-8aaa-111111111111`)).status).toBe(403);
    // Without user_id they only reach their own (non-existent) recording.
    expect((await get(`find_id=${FIND}`)).status).toBe(404);
    expect(h.storage.signed).toHaveLength(0);
  });

  it("lets an admin listen to a player's recording", async () => {
    seedSubmitted();
    h.user = { id: "admin-1", role: "admin" };
    expect((await get(`find_id=${FIND}&user_id=11111111-aaaa-4aaa-8aaa-111111111111`)).status).toBe(200);
  });

  it("records an admin listening to someone else's recording in audit_log", async () => {
    const db = seedSubmitted();
    h.user = { id: "admin-1", role: "admin" };
    expect((await get(`find_id=${FIND}&user_id=11111111-aaaa-4aaa-8aaa-111111111111`)).status).toBe(200);
    const audit = db.table("audit_log");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      user_id: "admin-1",
      entity_type: "challenge_audio",
      entity_id: "11111111-aaaa-4aaa-8aaa-111111111111",
    });
  });

  it("does not audit a player fetching their own recording", async () => {
    const db = seedSubmitted();
    expect((await get(`find_id=${FIND}`)).status).toBe(200);
    expect(db.table("audit_log")).toHaveLength(0);
  });

  it("rejects a user_id that is not a UUID", async () => {
    seedSubmitted();
    h.user = { id: "admin-1", role: "admin" };
    expect((await get(`find_id=${FIND}&user_id=not-a-uuid`)).status).toBe(400);
  });

  it("returns 404 for a child's device-only answer", async () => {
    const db = seed();
    (db.table("find_completions")[0] as Row).answer_value = "[audio:12s:local]";
    expect((await get(`find_id=${FIND}`)).status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    seedSubmitted();
    h.user = null;
    expect((await get(`find_id=${FIND}`)).status).toBe(401);
  });
});
