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

export interface Find {
  id: string;
  sort_order: number;
  clue_text: string | null;
  hot_cold_enabled: boolean;
  scaffolding_level: string | null;
  reading_check: { enabled: boolean; questions: ReadingCheckQuestion[] } | null;
  locations: { name: string; latitude: number; longitude: number; radius_meters: number; safety_notes?: string | null } | null;
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
