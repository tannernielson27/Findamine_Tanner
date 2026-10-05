/**
 * Answer grading for the play flow.
 *
 * Pure so it can be unit-tested without a database. The answer route feeds the
 * result into the scoring engine.
 */

export interface GradableTask {
  content?: Record<string, unknown> | null;
  challenge_type?: string | null;
}

export interface GradeResult {
  isCorrect: boolean;
  /** 0-1 share of credit for an answer that is not fully correct. */
  partialCredit?: number;
  /** True when the task has no answer key, so any real submission counts. */
  openEnded: boolean;
}

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}

/** Parses "5", "5.0", " 5 " to 5; anything that is not a plain number to null. */
function toNumber(value: string): number | null {
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function answersMatch(answer: string, correct: string): boolean {
  if (answer === correct) return true;
  const a = toNumber(answer);
  const c = toNumber(correct);
  return a !== null && c !== null && a === c;
}

function gradeOrdering(answer: unknown, correctOrder: string[]): GradeResult {
  const expected = correctOrder.map(normalize);
  // The play client submits the order as a comma-joined string. Compare the
  // joined forms (split and trimmed the same way on both sides) so items that
  // themselves contain commas still match.
  const canonical = (parts: unknown[]) =>
    parts.map(normalize).join(",").split(",").map((p) => p.trim()).join(",");
  const submittedJoined = canonical(Array.isArray(answer) ? answer : [answer]);

  if (submittedJoined === canonical(correctOrder)) {
    return { isCorrect: true, openEnded: false };
  }

  const submitted = submittedJoined.split(",");
  const inPlace = expected.filter((item, i) => submitted[i] === item).length;
  return {
    isCorrect: false,
    partialCredit: inPlace > 0 ? inPlace / expected.length : undefined,
    openEnded: false,
  };
}

export function gradeAnswer(task: GradableTask | null | undefined, answer: unknown): GradeResult {
  const content = task?.content || {};
  const normalizedAnswer = Array.isArray(answer) ? answer.map(normalize).join(",") : normalize(answer);

  const correctOrder = content.correct_order;
  if (Array.isArray(correctOrder) && correctOrder.length > 0) {
    return gradeOrdering(answer, correctOrder as string[]);
  }

  // The editor stores `correct_answer: null` for text, photo, sketch and audio
  // challenges. No key (or a blank one) means the challenge is open-ended:
  // there is nothing to compare against, so a real submission completes it.
  const correct = normalize(content.correct_answer);
  if (correct === "") {
    return { isCorrect: normalizedAnswer !== "", openEnded: true };
  }

  if (answersMatch(normalizedAnswer, correct)) {
    return { isCorrect: true, openEnded: false };
  }

  const partials = content.partial_answers as Record<string, number> | undefined;
  if (partials && typeof partials === "object" && normalizedAnswer in partials) {
    return { isCorrect: false, partialCredit: partials[normalizedAnswer], openEnded: false };
  }

  return { isCorrect: false, openEnded: false };
}
