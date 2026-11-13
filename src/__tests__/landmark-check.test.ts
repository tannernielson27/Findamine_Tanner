import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { installDouble, type Row } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  AI_PHOTO_NOTICE_VERSION,
  LANDMARK_CHECK_MODEL,
  checkLandmark,
  isEligibleRole,
  isLandmarkCheckEnabled,
  landmarkCheckApplies,
  minimizePhoto,
  runLandmarkCheck,
} from "@/lib/services/landmark-check";

/** A 2000×1500 JPEG carrying EXIF (including GPS-style fields) like a phone photo. */
async function phonePhoto(): Promise<Buffer> {
  return sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#4a7" } })
    .withExif({ IFD0: { Make: "PhoneCo", Model: "X1", Copyright: "player" } })
    .jpeg()
    .toBuffer();
}

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("switches and eligibility (R2, R7)", () => {
  it("is off unless both the switch and the API key are set", () => {
    expect(isLandmarkCheckEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isLandmarkCheckEnabled({ LANDMARK_PHOTO_CHECK: "on" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isLandmarkCheckEnabled({ ANTHROPIC_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isLandmarkCheckEnabled({ LANDMARK_PHOTO_CHECK: "on", ANTHROPIC_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("excludes children and teens", () => {
    expect(isEligibleRole("child")).toBe(false);
    expect(isEligibleRole("teen")).toBe(false);
    expect(isEligibleRole(null)).toBe(false);
    expect(isEligibleRole("adult")).toBe(true);
    expect(isEligibleRole("teacher")).toBe(true);
  });

  it("applies only to an eligible player who said yes (R1)", async () => {
    process.env.LANDMARK_PHOTO_CHECK = "on";
    process.env.ANTHROPIC_API_KEY = "k";
    const db = installDouble({
      ai_photo_check_choices: [
        { auth_id: "yes", allowed: true },
        { auth_id: "no", allowed: false },
      ],
    });
    expect(await landmarkCheckApplies(db.client as never, { auth_id: "yes", role: "adult" })).toBe(true);
    expect(await landmarkCheckApplies(db.client as never, { auth_id: "no", role: "adult" })).toBe(false);
    expect(await landmarkCheckApplies(db.client as never, { auth_id: "unasked", role: "adult" })).toBe(false);
    expect(await landmarkCheckApplies(db.client as never, { auth_id: "yes", role: "teen" })).toBe(false);
  });
});

describe("minimizePhoto (R3)", () => {
  it("shrinks to 1024 px and drops all metadata", async () => {
    const original = await phonePhoto();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const out = await minimizePhoto(original);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1024);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });
});

describe("checkLandmark (R3, R4)", () => {
  function fakeClient(input: unknown) {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "tool_use", name: "record_landmark_check", input }] });
    return { create, client: { messages: { create } } as never };
  }

  it("sends only the image and the stop text, and forces the answer shape", async () => {
    const { create, client } = fakeClient({ verdict: "match", confidence: 0.9 });
    const result = await checkLandmark(Buffer.from("jpeg"), { name: "Bronze bear", description: "By the library" }, client);
    expect(result).toEqual({ verdict: "match", confidence: 0.9 });
    const req = create.mock.calls[0][0];
    expect(req.model).toBe(LANDMARK_CHECK_MODEL);
    expect(req.tool_choice).toEqual({ type: "tool", name: "record_landmark_check" });
    expect(req.system).toMatch(/Do not describe, identify or comment on any person/);
    expect(req.messages).toHaveLength(1);
    const parts = req.messages[0].content;
    expect(parts.map((p: Row) => p.type)).toEqual(["image", "text"]);
    expect(parts[1].text).toBe("Stop: Bronze bear\nAbout the stop: By the library");
    expect(req.metadata).toBeUndefined(); // no user id goes along
  });

  it("treats anything unexpected as unsure and clamps confidence", async () => {
    const { client } = fakeClient({ verdict: "definitely", confidence: 7 });
    expect(await checkLandmark(Buffer.from("x"), { name: "S", description: null }, client)).toEqual({
      verdict: "unsure",
      confidence: 1,
    });
  });
});

describe("runLandmarkCheck (R5)", () => {
  let file: File;
  beforeEach(async () => {
    file = new File([new Uint8Array(await phonePhoto())], "p.jpg", { type: "image/jpeg" });
  });

  it("stores only the verdict on the photo", async () => {
    const db = installDouble({ find_photos: [{ id: "ph1" }], find_completions: [] });
    const check = vi.fn().mockResolvedValue({ verdict: "no_match", confidence: 0.8 });
    await runLandmarkCheck(db.client as never, { photoId: "ph1", file, stop: { name: "S", description: null } }, check);
    const stored = db.table("find_photos")[0].landmark_check as Row;
    expect(Object.keys(stored).sort()).toEqual(["checked_at", "confidence", "model", "notice_version", "verdict"]);
    expect(stored).toMatchObject({ verdict: "no_match", confidence: 0.8, notice_version: AI_PHOTO_NOTICE_VERSION });
    // The image the model got was the minimized one.
    const sent = check.mock.calls[0][0] as Buffer;
    expect((await sharp(sent).metadata()).exif).toBeUndefined();
  });

  it("clears a photo check-in's review flag on a match, keeping other metadata", async () => {
    const db = installDouble({
      find_photos: [{ id: "ph1" }],
      find_completions: [{ id: "c1", metadata: { arrival_method: "photo", arrival_review: "pending" } }],
    });
    const check = vi.fn().mockResolvedValue({ verdict: "match", confidence: 0.95 });
    await runLandmarkCheck(db.client as never, { photoId: "ph1", arrivalCompletionId: "c1", file, stop: { name: "S", description: null } }, check);
    expect(db.table("find_completions")[0].metadata).toEqual({ arrival_method: "photo", arrival_review: "ai_match" });
  });

  it("leaves the flag for review when the check is unsure or fails", async () => {
    const db = installDouble({
      find_photos: [{ id: "ph1" }],
      find_completions: [{ id: "c1", metadata: { arrival_review: "pending" } }],
    });
    const check = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await runLandmarkCheck(db.client as never, { photoId: "ph1", arrivalCompletionId: "c1", file, stop: { name: "S", description: null } }, check);
    expect(result.verdict).toBe("error");
    expect((db.table("find_photos")[0].landmark_check as Row).verdict).toBe("error");
    expect((db.table("find_completions")[0].metadata as Row).arrival_review).toBe("pending");
  });
});
