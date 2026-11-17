import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn() }));

import { openWaveNotification } from "@/lib/services/qualtrics-surveys";
import { WAVE_DEFINITIONS } from "@/lib/research/qualtrics";

/**
 * Player-facing study copy stays neutral: it may say "study" or "survey",
 * but never names what the research is about (privacy, location, conditions).
 */
const REVEALING = /privacy|location|tracking|condition|experiment|hypothes/i;

describe("study survey notification copy", () => {
  it("names no research topic and does not point at an old page name", () => {
    for (const def of Object.values(WAVE_DEFINITIONS)) {
      const note = openWaveNotification({
        wave: "T1",
        title: def.title,
        minutes: def.minutes,
        status: "open",
        opensAt: null,
        url: null,
      });
      expect(note.title).not.toMatch(REVEALING);
      expect(note.body).not.toMatch(REVEALING);
      expect(note.body).not.toContain("Your study");
    }
  });

  it("keeps the singular/plural minutes wording", () => {
    const one = openWaveNotification({ wave: "MID", title: "Week 2 check-in", minutes: 1, status: "open", opensAt: null, url: null });
    expect(one.body).toBe("It takes about 1 minute. Tap to start it.");
    expect(one.title).toBe("Week 2 check-in is ready");
  });
});
