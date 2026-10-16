import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  UPLOAD_POLICIES,
  buildObjectPath,
  checkUpload,
  cleanFilename,
  parseEntityRef,
  resolvePurpose,
} from "@/lib/media/upload-policy";

/**
 * POST /api/v1/media/upload: purpose-based bucket allow-list, caller-owned
 * paths, and signed (not public) URLs for private buckets.
 */

const HUNT_ID = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  hunts: {} as Record<string, { created_by: string }>,
  uploads: [] as { bucket: string; path: string; contentType?: string }[],
  removed: [] as { bucket: string; paths: string[] }[],
  signed: [] as { bucket: string; path: string; expiresIn: number }[],
  inserted: [] as Record<string, unknown>[],
  insertError: null as null | { message: string },
}));

vi.mock("@/lib/supabase/server", () => {
  const client = async () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let row: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return q;
        },
        maybeSingle: async () => ({
          data: table === "hunts" ? h.hunts[filters.id as string] ?? null : null,
          error: null,
        }),
        insert: (r: Record<string, unknown>) => {
          row = r;
          return q;
        },
        single: async () => {
          if (h.insertError) return { data: null, error: h.insertError };
          const saved = { id: "media-1", ...row };
          h.inserted.push(saved);
          return { data: saved, error: null };
        },
      };
      return q;
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _file: Blob, opts?: { contentType?: string }) => {
          h.uploads.push({ bucket, path, contentType: opts?.contentType });
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          h.removed.push({ bucket, paths });
          return { data: [], error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://public.example/${bucket}/${path}` } }),
        createSignedUrl: async (path: string, expiresIn: number) => {
          h.signed.push({ bucket, path, expiresIn });
          return { data: { signedUrl: `https://signed.example/${bucket}/${path}?t=1` }, error: null };
        },
      }),
    },
  });
  return { createSupabaseServiceClient: client };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/rate-limit", () => ({ uploadLimiter: { check: async () => {} } }));
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from "@/app/api/v1/media/upload/route";

function png(name = "pic.png", size = 16): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

function request(fields: Record<string, string | File>): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new NextRequest("http://localhost:3000/api/v1/media/upload", { method: "POST", body: form });
}

beforeEach(() => {
  h.user = { id: "u1", role: "hunt_creator" };
  h.hunts = { [HUNT_ID]: { created_by: "u1" } };
  h.uploads = [];
  h.removed = [];
  h.signed = [];
  h.inserted = [];
  h.insertError = null;
});

describe("upload policy (pure)", () => {
  it("maps purposes and legacy bucket names, and rejects other buckets", () => {
    expect(resolvePurpose(null, null)).toEqual({ ok: true, value: "hunt_media" });
    expect(resolvePurpose("avatar", null)).toEqual({ ok: true, value: "avatar" });
    expect(resolvePurpose(null, "captures")).toEqual({ ok: true, value: "capture" });
    for (const bucket of ["geo-selfies", "challenge-audio", "secret", "__proto__"]) {
      expect(resolvePurpose(null, bucket).ok).toBe(false);
    }
    expect(resolvePurpose("toString", null).ok).toBe(false);
    // purpose and bucket must agree
    expect(resolvePurpose("hunt_media", "avatars").ok).toBe(false);
  });

  it("only hunt-media is public", () => {
    expect(UPLOAD_POLICIES.hunt_media.publicRead).toBe(true);
    expect(UPLOAD_POLICIES.avatar.publicRead).toBe(false);
    expect(UPLOAD_POLICIES.capture.publicRead).toBe(false);
  });

  it("checks role, size and type", () => {
    const img = { type: "image/png", size: 10 };
    expect(checkUpload(UPLOAD_POLICIES.avatar, "child", img).ok).toBe(false);
    expect(checkUpload(UPLOAD_POLICIES.hunt_media, "adult", img).ok).toBe(false);
    expect(checkUpload(UPLOAD_POLICIES.avatar, "adult", { type: "video/mp4", size: 10 }).ok).toBe(false);
    expect(checkUpload(UPLOAD_POLICIES.avatar, "adult", { type: "image/png", size: 0 }).ok).toBe(false);
    expect(checkUpload(UPLOAD_POLICIES.avatar, "adult", { type: "image/png", size: 3 * 1024 * 1024 }).ok).toBe(false);
    expect(checkUpload(UPLOAD_POLICIES.avatar, "adult", { type: "text/html", size: 10 }).ok).toBe(false);
    expect(checkUpload(UPLOAD_POLICIES.avatar, "adult", img)).toEqual({ ok: true, value: "png" });
  });

  it("keeps the object path inside the caller's folder", () => {
    expect(buildObjectPath("u1", "abc-123", "png")).toBe("u1/abc-123.png");
    expect(buildObjectPath("u1", "../u2/x", "/../../u2/evil")).toBe("u1/u2x.bin");
  });

  it("validates the entity link", () => {
    expect(parseEntityRef(null, null)).toEqual({ ok: true, value: { entityType: null, entityId: null } });
    expect(parseEntityRef("hunt", HUNT_ID)).toEqual({ ok: true, value: { entityType: "hunt", entityId: HUNT_ID } });
    expect(parseEntityRef("hunt", null).ok).toBe(false);
    expect(parseEntityRef("hunt", "not-a-uuid").ok).toBe(false);
    expect(parseEntityRef("Hunt; drop", HUNT_ID).ok).toBe(false);
  });

  it("cleans the stored file name", () => {
    expect(cleanFilename("../../etc/passwd")).toBe("passwd");
    expect(cleanFilename("a\u0000b.png")).toBe("ab.png");
    expect(cleanFilename("")).toBe("upload");
  });
});

describe("POST /api/v1/media/upload", () => {
  it("requires sign-in", async () => {
    h.user = null;
    const res = await POST(request({ file: png() }));
    expect(res.status).toBe(401);
    expect(h.uploads).toHaveLength(0);
  });

  it("uploads hunt media under the caller's id and returns a public URL", async () => {
    const res = await POST(request({ file: png("..%2f..%2fx.png"), entity_type: "hunt", entity_id: HUNT_ID }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].bucket).toBe("hunt-media");
    expect(h.uploads[0].path).toMatch(/^u1\/[0-9a-f-]{36}\.png$/);
    expect(body.media.url).toBe(`https://public.example/hunt-media/${h.uploads[0].path}`);
    expect(body.media.url_expires_in).toBeNull();
    expect(h.signed).toHaveLength(0);
  });

  it("returns a signed URL, not a public one, for avatars and captures", async () => {
    h.user = { id: "u9", role: "adult" };
    const variants: Record<string, string>[] = [{ purpose: "avatar" }, { bucket: "avatars" }, { bucket: "captures" }];
    for (const fields of variants) {
      h.signed = [];
      const res = await POST(request({ file: png(), ...fields }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.media.url).toMatch(/^https:\/\/signed\.example\//);
      expect(body.media.url_expires_in).toBeGreaterThan(0);
      expect(h.signed[0].path.startsWith("u9/")).toBe(true);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  it("refuses private buckets owned by other routes", async () => {
    for (const bucket of ["geo-selfies", "challenge-audio"]) {
      const res = await POST(request({ file: png(), bucket }));
      expect(res.status).toBe(400);
    }
    expect(h.uploads).toHaveLength(0);
  });

  it("refuses children and players uploading hunt media", async () => {
    h.user = { id: "c1", role: "child" };
    expect((await POST(request({ file: png(), purpose: "avatar" }))).status).toBe(403);
    h.user = { id: "a1", role: "adult" };
    expect((await POST(request({ file: png() }))).status).toBe(403);
    expect(h.uploads).toHaveLength(0);
  });

  it("refuses attaching media to someone else's hunt", async () => {
    h.hunts = { [HUNT_ID]: { created_by: "someone-else" } };
    const res = await POST(request({ file: png(), entity_type: "hunt", entity_id: HUNT_ID }));
    expect(res.status).toBe(403);
    expect(h.uploads).toHaveLength(0);
  });

  it("lets staff attach media to any hunt", async () => {
    h.user = { id: "admin1", role: "admin" };
    h.hunts = { [HUNT_ID]: { created_by: "someone-else" } };
    const res = await POST(request({ file: png(), entity_type: "hunt", entity_id: HUNT_ID }));
    expect(res.status).toBe(201);
  });

  it("rejects disallowed types", async () => {
    const html = new File(["<script>"], "x.html", { type: "text/html" });
    expect((await POST(request({ file: html }))).status).toBe(400);
  });

  it("removes the uploaded object if the media row cannot be written", async () => {
    h.insertError = { message: "boom" };
    const res = await POST(request({ file: png() }));
    expect(res.status).toBe(500);
    expect(h.removed).toEqual([{ bucket: "hunt-media", paths: [h.uploads[0].path] }]);
  });
});
