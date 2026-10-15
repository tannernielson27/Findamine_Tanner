/**
 * Grade bands offered by the hunt builders and the AI content generators.
 *
 * Content stores grades as integers (K = 0). College is stored as 13-16. The
 * shared library only goes up to grade 12, so a college hunt draws on content
 * from high-school level up (libraryRange) and the AI is told to write for
 * adults (promptAudience).
 */

export type HuntAudience = "kids" | "teens" | "adults";

export interface GradeBand {
  value: string;
  label: string;
  range: { min: number; max: number };
  libraryRange: { min: number; max: number };
  audience: HuntAudience;
  promptAudience: string;
}

export const COLLEGE_MIN_GRADE = 13;

export const GRADE_BANDS = [
  {
    value: "K-2",
    label: "K-2 (ages 5-7)",
    range: { min: 0, max: 2 },
    libraryRange: { min: 0, max: 2 },
    audience: "kids",
    promptAudience: "young children in grades K-2 (ages 5-7)",
  },
  {
    value: "3-5",
    label: "3-5 (ages 8-10)",
    range: { min: 3, max: 5 },
    libraryRange: { min: 3, max: 5 },
    audience: "kids",
    promptAudience: "children in grades 3-5 (ages 8-10)",
  },
  {
    value: "6-8",
    label: "6-8 (ages 11-13)",
    range: { min: 6, max: 8 },
    libraryRange: { min: 6, max: 8 },
    audience: "teens",
    promptAudience: "middle schoolers in grades 6-8 (ages 11-13)",
  },
  {
    value: "9-12",
    label: "9-12 (ages 14-18)",
    range: { min: 9, max: 12 },
    libraryRange: { min: 9, max: 12 },
    audience: "teens",
    promptAudience: "high schoolers in grades 9-12 (ages 14-18)",
  },
  {
    value: "college",
    label: "College / Adult (18+)",
    range: { min: COLLEGE_MIN_GRADE, max: 16 },
    libraryRange: { min: 9, max: 16 },
    audience: "adults",
    promptAudience:
      "college undergraduates and other adults (18+). Write for smart adults: wry, concise and specific, with real-world or campus context. Never use a childish or sing-song tone, and don't over-explain",
  },
] as const satisfies readonly GradeBand[];

export type GradeBandValue = (typeof GRADE_BANDS)[number]["value"];

export const DEFAULT_GRADE_BAND: GradeBandValue = "college";

export function gradeBandFor(value: string): GradeBand {
  return (
    GRADE_BANDS.find((b) => b.value === value) ??
    GRADE_BANDS.find((b) => b.value === DEFAULT_GRADE_BAND)!
  );
}

function gradeName(grade: number): string {
  if (grade >= COLLEGE_MIN_GRADE) return "College";
  return grade === 0 ? "K" : String(grade);
}

/** "Gr 3-5", "Gr 9-College", or "College" for content stored with integer grades. */
export function formatGradeRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null) return "";
  if (min >= COLLEGE_MIN_GRADE) return "College";
  const upper = max ?? min;
  return upper === min ? `Gr ${gradeName(min)}` : `Gr ${gradeName(min)}-${gradeName(upper)}`;
}

/**
 * Who the AI should write for, given a stored grade range. Ranges that reach
 * college level are described as adults so the model drops the kid voice.
 */
export function describePlayers(range: { min: number; max: number } | undefined, fallback: string): string {
  if (!range) return fallback;
  if (range.max >= COLLEGE_MIN_GRADE) {
    return range.min >= COLLEGE_MIN_GRADE
      ? gradeBandFor("college").promptAudience
      : `players from grade ${gradeName(range.min)} up to college-age adults; pitch it at the older end`;
  }
  return `students in grades ${gradeName(range.min)}-${gradeName(range.max)}`;
}

/** Grade range implied by a hunt's target audience, or undefined when it's mixed. */
export function gradeRangeForAudience(audience: string | null | undefined): { min: number; max: number } | undefined {
  if (audience === "adults") return { min: COLLEGE_MIN_GRADE, max: 16 };
  if (audience === "teens") return { min: 7, max: 12 };
  if (audience === "kids") return { min: 1, max: 6 };
  return undefined;
}
