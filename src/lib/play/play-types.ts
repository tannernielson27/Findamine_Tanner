/**
 * Shared types for the play loop (/play/[huntId]).
 */

export type StopStep = "prime" | "reading_check" | "clue" | "navigate" | "challenge" | "capture" | "feedback";

/** Step order within a stop, for deciding which way step content slides in. */
export const STEP_ORDER: Record<StopStep, number> = {
  prime: 0, reading_check: 1, clue: 2, navigate: 3, challenge: 4, capture: 5, feedback: 6,
};

export interface ReadingCheckQuestion {
  question: string;
  options: string[];
  correct_answer: string;
}

/**
 * A stop as the play API sends it (GET /api/v1/play/[huntId]/stops).
 *
 * Until the player starts the stop (`started_at` is null) the server sends no
 * clue, place, challenge or reading check: those fields are null. The primer
 * is the "before you start" reading, so it comes with a stop that is `open`.
 */
export interface Find {
  id: string;
  sort_order: number;
  /** When this player started the stop (server time); null until they tap "I'm ready". */
  started_at: string | null;
  /** The player's clue order lets them start (or keep working on) this stop now. */
  open: boolean;
  clue_text: string | null;
  hot_cold_enabled: boolean | null;
  scaffolding_level: string | null;
  reading_check: { enabled: boolean; questions: ReadingCheckQuestion[] } | null;
  /**
   * The stop's place. On Medium and Hard hunts (lib/play/navigation-help) the
   * name and coordinates are null until the player has completed the stop.
   */
  locations: {
    name: string | null;
    latitude: number | null;
    longitude: number | null;
    radius_meters: number;
    safety_notes?: string | null;
  } | null;
  tasks: { title: string; challenge_type: string; content: Record<string, unknown> } | null;
  primers: { title: string; content: Record<string, unknown> } | null;
}

/** Hunt metadata for anxiety-sensitive mode and scoring. */
export interface HuntMetadata {
  hide_scores?: boolean;
  hide_leaderboard?: boolean;
  hide_timer?: boolean;
  growth_only_feedback?: boolean;
  scoring_mode?: string;
  preset?: string;
  /** Legacy: each player gets their own random order. Read via lib/play/clue-delivery. */
  shuffle_stops?: boolean;
  /** How clues are handed out (lib/play/clue-delivery). */
  clue_delivery?: string;
  /** How much navigation help players get: "Difficulty" (lib/play/navigation-help). */
  navigation_help?: string;
}

export interface HotCold {
  zone: string;
  color: string;
  label: string;
  emoji: string;
  distanceLabel: string;
}

export interface AnswerFeedback {
  type: string;
  main: string;
  explanation: string;
  next_steps: string;
}

export interface HuntSummaryData {
  totalScore: number;
  findsCompleted: number;
  totalFinds: number;
  startedAt: string;
  completedAt: string;
}

export type GpsStatus = "waiting" | "active" | "denied" | "unavailable" | "timeout";
/**
 * "granted" once the player has gone past the location primer. There is no
 * "declined": the primer always leads to the OS prompt (App Store 5.1.1(iv)),
 * and a "no" there shows up as gpsStatus "denied".
 */
export type LocationConsent = "pending" | "granted";

export interface StartOptions {
  codename?: string;
  assign_codename?: boolean;
}
