/**
 * Pure helpers for the admin survey editor and its questions API: item-code
 * generation, per-type scale defaults, and validation of the full question set
 * before it replaces what is stored in `survey_questions`.
 */

export const QUESTION_TYPES = [
  "likert_5",
  "likert_7",
  "multiple_choice",
  "free_text",
  "slider",
  "ranking",
  "matrix",
] as const;

export interface ScaleConfig {
  min?: number;
  max?: number;
  min_label?: string;
  max_label?: string;
  step?: number;
}

export interface IncomingQuestion {
  item_code?: unknown;
  question_text?: unknown;
  question_type?: unknown;
  subscale?: unknown;
  reverse_coded?: unknown;
  required?: unknown;
  scale_config?: unknown;
  options?: unknown;
}

export interface QuestionRow {
  survey_id: string;
  item_code: string;
  question_text: string;
  question_type: string;
  options: unknown[];
  scale_config: ScaleConfig;
  reverse_coded: boolean;
  subscale: string | null;
  sort_order: number;
  required: boolean;
}

export class SurveyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurveyValidationError";
  }
}

const LIKERT_POINTS: Record<string, number> = { likert_5: 5, likert_7: 7 };

/** First `item_N` code not already used — safe after questions are deleted or reordered. */
export function nextItemCode(existing: string[]): string {
  const used = existing
    .map((code) => /^item_(\d+)$/.exec(code))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  const next = used.length === 0 ? 1 : Math.max(...used) + 1;
  return `item_${next}`;
}

/** The scale config a question should carry after switching to `type`. Labels survive. */
export function scaleConfigForType(type: string, current: ScaleConfig): ScaleConfig {
  const labels = {
    ...(current.min_label !== undefined && { min_label: current.min_label }),
    ...(current.max_label !== undefined && { max_label: current.max_label }),
  };
  const points = LIKERT_POINTS[type];
  if (points) return { min: 1, max: points, ...labels };
  if (type === "slider") return { min: 0, max: 100, step: 1, ...labels };
  return {};
}

export type ChoiceOption = string | { value: string; label: string };

const OPTION_SEPARATOR = " | ";

/**
 * Multiple-choice options as editable text, one per line. A stored {value,label}
 * pair whose label differs from its value shows as "value | label" so the label
 * participants see survives an edit-and-save.
 */
export function optionsToText(options: unknown): string {
  if (!Array.isArray(options)) return "";
  return options
    .map((o) => {
      if (o && typeof o === "object" && "value" in o) {
        const { value, label } = o as { value: unknown; label?: unknown };
        const v = String(value);
        const l = label === undefined ? v : String(label);
        return l === v ? v : `${v}${OPTION_SEPARATOR}${l}`;
      }
      return String(o);
    })
    .join("\n");
}

/** Inverse of optionsToText: blank lines drop, "value | label" becomes a pair. */
export function textToOptions(text: string): ChoiceOption[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(OPTION_SEPARATOR.trim());
      if (at === -1) return line;
      const value = line.slice(0, at).trim();
      const label = line.slice(at + 1).trim();
      return value && label && value !== label ? { value, label } : value || label;
    });
}

function validateScale(label: string, type: string, cfg: ScaleConfig): void {
  const { min, max } = cfg;
  const points = LIKERT_POINTS[type];
  if (points && typeof min === "number" && typeof max === "number" && max - min + 1 !== points) {
    throw new SurveyValidationError(
      `${label}: a ${points}-point Likert needs ${points} points (min ${min}, max ${max} gives ${max - min + 1})`
    );
  }
  if (type === "slider" && typeof min === "number" && typeof max === "number" && max <= min) {
    throw new SurveyValidationError(`${label}: slider max must be greater than min`);
  }
}

function toRow(surveyId: string, q: IncomingQuestion, i: number, seen: Set<string>): QuestionRow {
  const label = `Question ${i + 1}`;
  const itemCode = String(q.item_code ?? "").trim();
  const questionText = String(q.question_text ?? "").trim();
  const questionType = String(q.question_type ?? "");

  if (!itemCode) throw new SurveyValidationError(`${label}: item_code is required`);
  if (!/^[a-zA-Z0-9_]+$/.test(itemCode)) {
    throw new SurveyValidationError(`${label}: item_code must be letters, numbers, or underscores`);
  }
  if (seen.has(itemCode)) throw new SurveyValidationError(`Duplicate item_code "${itemCode}"`);
  seen.add(itemCode);
  if (!questionText) throw new SurveyValidationError(`${label}: question_text is required`);
  if (!(QUESTION_TYPES as readonly string[]).includes(questionType)) {
    throw new SurveyValidationError(`${label}: invalid question_type "${questionType}"`);
  }

  const scaleConfig: ScaleConfig =
    q.scale_config && typeof q.scale_config === "object" ? (q.scale_config as ScaleConfig) : {};
  validateScale(label, questionType, scaleConfig);

  const options = Array.isArray(q.options) ? q.options : [];
  if (questionType === "multiple_choice" && options.length < 2) {
    throw new SurveyValidationError(`${label}: multiple choice needs at least two options`);
  }

  return {
    survey_id: surveyId,
    item_code: itemCode,
    question_text: questionText,
    question_type: questionType,
    options,
    scale_config: scaleConfig,
    reverse_coded: Boolean(q.reverse_coded),
    subscale: q.subscale ? String(q.subscale).trim() : null,
    sort_order: i,
    required: q.required === undefined ? true : Boolean(q.required),
  };
}

/** Validate the editor's full question set and map it to rows; `sort_order` follows array order. */
export function buildQuestionRows(surveyId: string, incoming: IncomingQuestion[]): QuestionRow[] {
  const seen = new Set<string>();
  return incoming.map((q, i) => toRow(surveyId, q, i, seen));
}
