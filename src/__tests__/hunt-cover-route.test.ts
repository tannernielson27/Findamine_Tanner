import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";
import {
  COVER_MAX_BYTES,
  buildCoverPath,
  canEditCover,
  checkCoverFile,
  coverObjectPathFromUrl,
  sniffCoverType,
} from "@/lib/hunts/cover-image";
import { REQUEUED_MESSAGE } from "@/lib/hunts/review";

/**
 * POST/DELETE /api/v1/hunts/[id]/cover: owner/staff only, type from magic
 * bytes, 5 MB cap, public URL saved on the hunt, and a cover change on a
 * listed hunt goes back through publish review.
 */

interface StorageState {
  uploads: { bucket: string; path: string; contentType?: string; size: number }[];
  removed: { bucket: string; paths: string[] }[];
  uploadError: { message: string } | null;
}

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  storage: null as unknown as StorageState,
  limited: false,
}));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: Uint8Array, opts?: { contentType?: string }) => {
        if (h.storage.uploadError) return { data: null, error: h.storage.uploadError };
        h.storage.uploads.push({ bucket, path, contentType: opts?.contentType, size: body.byteLength });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        h.storage.removed.push({ bucket, paths });
        return { data: [], error: null };
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` },
      }),
    }),
  };
  const client = async () => ({ ...m.current().client, storage });
  return { createSupabaseServiceClient: client, createSupabaseServerClient: client };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/rate-limit", async () => {
  const { ApiError } = await import("@/lib/utils/api-auth");
  return {
    uploadLimiter: {
      check: async () => {
        if (h.limited) throw new ApiError(429, "Too many attempts.");
      },
    },
  };
});
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST, DELETE } from "@/app/api/v1/hunts/[id]/cover/route";

const HUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_HUNT = "22222222-2222-4222-8222-222222222222";
const BASE = "https://proj.supabase.co/storage/v1/object/public/hunt-covers";
const OLD_COVER = `${BASE}/${HUNT}/0ld-c0ver.jpg`;

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const HEIC = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];
const HTML = Array.from(new TextEncoder().encode("<html><script>alert(1)</script>"));

function bytes(head: number[], size = 64): Uint8Array {
  const out = new Uint8Array(Math.max(size, head.length));
  out.set(head);
  return out;
}

function file(head: number[], type = "image/jpeg", size = 64): File {
  return new File([bytes(head, size) as BlobPart], "cover.jpg", { type });
}

function post(f: File | null, headers: Record<string, string> = {}): NextRequest {
  const form = new FormData();
  if (f) form.append("file", f);
  return new NextRequest(`http://localhost:3000/api/v1/hunts/${HUNT}/cover`, { method: "POST", body: form, headers });
}

function del(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/hunts/${HUNT}/cover`, { method: "DELETE" });
}

const params = (id = HUNT) => ({ params: Promise.resolve({ id }) });

function seed(extra: Row = {}): SupabaseDouble {
  return installDouble({
    hunts: [
      {
        id: HUNT,
        created_by: "owner",
        status: "draft",
        review_status: "not_submitted",
        is_public: false,
        cover_image_url: null,
        deleted_at: null,
        ...extra,
      },
    ],
  });
}

function huntRow(db: SupabaseDouble): Row {
  return db.table("hunts")[0];
}

beforeEach(() => {
  h.user = { id: "owner", role: "hunt_creator" };
  h.storage = { uploads: [], removed: [], uploadError: null };
  h.limited = false;
});

describe("cover image checks (pure)", () => {
  it("identifies images by their bytes", () => {
    expect(sniffCoverType(bytes(JPEG))).toBe("image/jpeg");
    expect(sniffCoverType(bytes(PNG))).toBe("image/png");
    expect(sniffCoverType(bytes(WEBP))).toBe("image/webp");
    expect(sniffCoverType(bytes(HEIC))).toBe("image/heic");
    expect(sniffCoverType(bytes(HTML))).toBeNull();
    expect(sniffCoverType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    // RIFF but not WebP (e.g. a WAV file).
    expect(sniffCoverType(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });

  it("enforces size and type", () => {
    expect(checkCoverFile(0, bytes(JPEG))).toMatchObject({ ok: false, status: 400 });
    expect(checkCoverFile(COVER_MAX_BYTES + 1, bytes(JPEG))).toMatchObject({ ok: false, status: 413 });
    expect(checkCoverFile(100, bytes(HTML))).toMatchObject({ ok: false, status: 415 });
    expect(checkCoverFile(COVER_MAX_BYTES, bytes(PNG))).toEqual({ ok: true, mime: "image/png", ext: "png" });
  });

  it("lets only the owner (in a creator role) or staff edit", () => {
    expect(canEditCover({ id: "owner", role: "hunt_creator" }, "owner")).toBe(true);
    expect(canEditCover({ id: "owner", role: "teacher" }, "owner")).toBe(true);
    expect(canEditCover({ id: "x", role: "hunt_creator" }, "owner")).toBe(false);
    expect(canEditCover({ id: "x", role: "admin" }, "owner")).toBe(true);
    expect(canEditCover({ id: "x", role: "researcher" }, "owner")).toBe(true);
    expect(canEditCover({ id: "owner", role: "child" }, "owner")).toBe(false);
  });

  it("keeps object paths inside the hunt's folder and only deletes its own objects", () => {
    expect(buildCoverPath(HUNT, "abc-123", "jpg")).toBe(`${HUNT}/abc-123.jpg`);
    expect(buildCoverPath(HUNT, "../x/y", "/../evil")).toBe(`${HUNT}/xy.bin`);
    expect(coverObjectPathFromUrl(OLD_COVER, HUNT)).toBe(`${HUNT}/0ld-c0ver.jpg`);
    expect(coverObjectPathFromUrl(`${BASE}/${OTHER_HUNT}/a.jpg`, HUNT)).toBeNull();
    expect(coverObjectPathFromUrl(`${BASE}/${HUNT}/../${OTHER_HUNT}/a.jpg`, HUNT)).toBeNull();
    expect(coverObjectPathFromUrl(`https://proj.supabase.co/storage/v1/object/public/hunt-media/${HUNT}/a.jpg`, HUNT)).toBeNull();
    expect(coverObjectPathFromUrl("not a url", HUNT)).toBeNull();
    expect(coverObjectPathFromUrl(null, HUNT)).toBeNull();
  });
});

describe("POST /api/v1/hunts/[id]/cover", () => {
  it("401s when signed out", async () => {
    h.user = null;
    seed();
    expect((await POST(post(file(JPEG)), params())).status).toBe(401);
  });

  it("403s for a role that can't create hunts", async () => {
    h.user = { id: "owner", role: "adult" };
    seed();
    expect((await POST(post(file(JPEG)), params())).status).toBe(403);
  });

  it("403s for a creator who doesn't own the hunt, and stores nothing", async () => {
    h.user = { id: "someone-else", role: "hunt_creator" };
    const db = seed();
    const res = await POST(post(file(JPEG)), params());
    expect(res.status).toBe(403);
    expect(h.storage.uploads).toHaveLength(0);
    expect(huntRow(db).cover_image_url).toBeNull();
  });

  it("403s a request from an untrusted origin", async () => {
    seed();
    const res = await POST(post(file(JPEG), { origin: "https://evil.example" }), params());
    expect(res.status).toBe(403);
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("429s when rate limited", async () => {
    h.limited = true;
    seed();
    expect((await POST(post(file(JPEG)), params())).status).toBe(429);
  });

  it("404s for a missing, deleted, or malformed hunt id", async () => {
    seed({ deleted_at: "2026-10-01T00:00:00Z" });
    expect((await POST(post(file(JPEG)), params())).status).toBe(404);
    expect((await POST(post(file(JPEG)), params("not-a-uuid"))).status).toBe(404);
  });

  it("400s with no file", async () => {
    seed();
    expect((await POST(post(null), params())).status).toBe(400);
  });

  it("415s a file whose bytes aren't an image, even when it claims to be one", async () => {
    seed();
    const res = await POST(post(file(HTML, "image/jpeg")), params());
    expect(res.status).toBe(415);
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("415s a non-image declared type", async () => {
    seed();
    expect((await POST(post(file(JPEG, "text/html")), params())).status).toBe(415);
  });

  it("413s a file over 5 MB", async () => {
    seed();
    const res = await POST(post(file(JPEG, "image/jpeg", COVER_MAX_BYTES + 1)), params());
    expect(res.status).toBe(413);
    expect(h.storage.uploads).toHaveLength(0);
  });

  it("stores the image under the hunt's folder with the sniffed type and saves the URL", async () => {
    const db = seed();
    // Declared as PNG but really a JPEG: the bytes win.
    const res = await POST(post(file(JPEG, "image/png")), params());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(h.storage.uploads).toHaveLength(1);
    const [upload] = h.storage.uploads;
    expect(upload.bucket).toBe("hunt-covers");
    expect(upload.contentType).toBe("image/jpeg");
    expect(upload.path).toMatch(new RegExp(`^${HUNT}/[0-9a-f-]{36}\\.jpg$`));
    expect(body).toEqual({ data: { cover_image_url: `${BASE}/${upload.path}` } });
    expect(huntRow(db).cover_image_url).toBe(`${BASE}/${upload.path}`);
    expect(h.storage.removed).toHaveLength(0);
  });

  it("lets an admin set the cover of someone else's hunt", async () => {
    h.user = { id: "staff", role: "admin" };
    seed();
    expect((await POST(post(file(PNG, "image/png")), params())).status).toBe(201);
  });

  it("removes the replaced cover object", async () => {
    seed({ cover_image_url: OLD_COVER });
    expect((await POST(post(file(WEBP, "image/webp")), params())).status).toBe(201);
    expect(h.storage.removed).toEqual([{ bucket: "hunt-covers", paths: [`${HUNT}/0ld-c0ver.jpg`] }]);
  });

  it("500s when storage fails, leaving the hunt unchanged", async () => {
    h.storage.uploadError = { message: "boom" };
    const db = seed({ cover_image_url: OLD_COVER });
    expect((await POST(post(file(JPEG)), params())).status).toBe(500);
    expect(huntRow(db).cover_image_url).toBe(OLD_COVER);
  });

  it("sends a listed hunt back to review and says so", async () => {
    const db = seed({ status: "published", review_status: "approved", is_public: true });
    const res = await POST(post(file(JPEG)), params());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ review_status: "pending", message: REQUEUED_MESSAGE });
    expect(huntRow(db)).toMatchObject({ review_status: "pending", is_public: false });
  });

  it("leaves a draft's review state alone", async () => {
    const db = seed();
    await POST(post(file(JPEG)), params());
    expect(huntRow(db).review_status).toBe("not_submitted");
  });
});

describe("DELETE /api/v1/hunts/[id]/cover", () => {
  it("401s when signed out and 403s for a non-owner", async () => {
    h.user = null;
    seed({ cover_image_url: OLD_COVER });
    expect((await DELETE(del(), params())).status).toBe(401);
    h.user = { id: "someone-else", role: "teacher" };
    expect((await DELETE(del(), params())).status).toBe(403);
  });

  it("clears the cover and removes the object", async () => {
    const db = seed({ cover_image_url: OLD_COVER });
    const res = await DELETE(del(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { cover_image_url: null } });
    expect(huntRow(db).cover_image_url).toBeNull();
    expect(h.storage.removed).toEqual([{ bucket: "hunt-covers", paths: [`${HUNT}/0ld-c0ver.jpg`] }]);
  });

  it("is a no-op when there is no cover", async () => {
    seed();
    const res = await DELETE(del(), params());
    expect(await res.json()).toEqual({ data: { cover_image_url: null } });
    expect(h.storage.removed).toHaveLength(0);
  });

  it("does not delete an object outside the hunt's folder", async () => {
    const db = seed({ cover_image_url: `${BASE}/${OTHER_HUNT}/x.jpg` });
    expect((await DELETE(del(), params())).status).toBe(200);
    expect(huntRow(db).cover_image_url).toBeNull();
    expect(h.storage.removed).toHaveLength(0);
  });

  it("sends a listed hunt back to review", async () => {
    const db = seed({ status: "published", review_status: "approved", is_public: true, cover_image_url: OLD_COVER });
    const body = await (await DELETE(del(), params())).json();
    expect(body.data.review_status).toBe("pending");
    expect(huntRow(db).review_status).toBe("pending");
  });
});
