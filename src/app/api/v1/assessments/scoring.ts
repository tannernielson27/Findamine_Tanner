/**
 * Items and scoring for the self-assessment (TIPI Big Five + a 4-item growth
 * mindset scale). No server imports: the assessment page shows these items and
 * the API scores the answers with the same code, so a stored score can never
 * disagree with what the page would have computed.
 *
 * Scores are stored as the raw trait on the 1-7 scale. In particular
 * `neuroticism` is stored as neuroticism (anxious = high); the page shows it
 * inverted as "Emotional Stability", and that inversion is display-only.
 */

export type AssessmentType = "personality" | "growth_mindset";

export interface AssessmentItem {
  text: string;
  dimension: string;
  /** 1 = agreeing raises the score, -1 = reverse-coded. */
  direction: 1 | -1;
}

// TIPI (Ten Item Personality Inventory) — validated short Big 5 measure
export const TIPI_ITEMS: AssessmentItem[] = [
  { text: "I see myself as extraverted, enthusiastic", dimension: "extraversion", direction: 1 },
  { text: "I see myself as critical, quarrelsome", dimension: "agreeableness", direction: -1 },
  { text: "I see myself as dependable, self-disciplined", dimension: "conscientiousness", direction: 1 },
  { text: "I see myself as anxious, easily upset", dimension: "neuroticism", direction: 1 },
  { text: "I see myself as open to new experiences, complex", dimension: "openness", direction: 1 },
  { text: "I see myself as reserved, quiet", dimension: "extraversion", direction: -1 },
  { text: "I see myself as sympathetic, warm", dimension: "agreeableness", direction: 1 },
  { text: "I see myself as disorganized, careless", dimension: "conscientiousness", direction: -1 },
  { text: "I see myself as calm, emotionally stable", dimension: "neuroticism", direction: -1 },
  { text: "I see myself as conventional, uncreative", dimension: "openness", direction: -1 },
];

// Growth Mindset Scale — 4 items (adapted from Dweck, 2006)
export const GROWTH_MINDSET_ITEMS: AssessmentItem[] = [
  { text: "Your intelligence is something very basic about you that you can't change very much", dimension: "growth_mindset", direction: -1 },
  { text: "No matter how much intelligence you have, you can always change it quite a bit", dimension: "growth_mindset", direction: 1 },
  { text: "You can learn new things, but you can't really change how intelligent you are", dimension: "growth_mindset", direction: -1 },
  { text: "You can always substantially change how intelligent you are", dimension: "growth_mindset", direction: 1 },
];

export const ALL_ITEMS: AssessmentItem[] = [...TIPI_ITEMS, ...GROWTH_MINDSET_ITEMS];

export const SCALE_MIN = 1;
export const SCALE_MAX = 7;

export type Scores = Record<string, number>;

/** One whole-number answer (1-7) per item, in ALL_ITEMS order; otherwise null. */
export function parseResponses(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== ALL_ITEMS.length) return null;
  const valid = raw.every(
    (r) => typeof r === "number" && Number.isInteger(r) && r >= SCALE_MIN && r <= SCALE_MAX
  );
  return valid ? (raw as number[]) : null;
}

/** Mean of each dimension's (reverse-coded where needed) answers, to 1 decimal. */
function scoreItems(items: AssessmentItem[], answers: number[]): Scores {
  const byDimension: Record<string, number[]> = {};
  items.forEach((item, i) => {
    const value = item.direction === 1 ? answers[i] : SCALE_MIN + SCALE_MAX - answers[i];
    (byDimension[item.dimension] ||= []).push(value);
  });
  const scores: Scores = {};
  for (const [dimension, values] of Object.entries(byDimension)) {
    scores[dimension] = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  }
  return scores;
}

/**
 * Score a complete, validated set of answers into one flat `scores` object per
 * assessment type, which is the shape player_assessments.scores readers expect
 * (teams/form reads the "personality" row; the profile route reads both).
 */
export function scoreResponses(responses: number[]): Record<AssessmentType, { responses: number[]; scores: Scores }> {
  const tipi = responses.slice(0, TIPI_ITEMS.length);
  const mindset = responses.slice(TIPI_ITEMS.length);
  return {
    personality: { responses: tipi, scores: scoreItems(TIPI_ITEMS, tipi) },
    growth_mindset: { responses: mindset, scores: scoreItems(GROWTH_MINDSET_ITEMS, mindset) },
  };
}
