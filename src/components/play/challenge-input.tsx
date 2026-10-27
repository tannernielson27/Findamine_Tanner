"use client";

import dynamic from "next/dynamic";
import { MultipleChoice } from "./challenge/multiple-choice";
import { NumericEntry } from "./challenge/numeric-entry";
import { TextInput } from "./challenge/text-input";

// The heavier challenge types (drawing canvas, recorder, camera, drag sorting)
// load as separate chunks, only when a stop actually uses them. Multiple
// choice, numeric and text stay in the main play bundle: they cover most stops.
function ChallengeSkeleton() {
  return <div className="min-h-24 rounded-xl fm-shimmer" aria-hidden="true" />;
}
const SortingOrdering = dynamic(() => import("./challenge/sorting-ordering").then((mod) => mod.SortingOrdering), { loading: ChallengeSkeleton });
const PhotoObservation = dynamic(() => import("./challenge/photo-observation").then((mod) => mod.PhotoObservation), { loading: ChallengeSkeleton });
const SketchDraw = dynamic(() => import("./challenge/sketch-draw").then((mod) => mod.SketchDraw), { loading: ChallengeSkeleton });
const AudioResponse = dynamic(() => import("./challenge/audio-response").then((mod) => mod.AudioResponse), { loading: ChallengeSkeleton });

interface ChallengeInputProps {
  challengeType: string;
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (answer: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** Needed by audio_response, which uploads the recording for this stop. */
  huntId?: string;
  findId?: string;
  /** False when the surrounding sheet already shows the question as its heading. */
  showQuestion?: boolean;
}

/**
 * Renders the appropriate input UI based on challenge type.
 * Falls back to text input for unrecognized types.
 */
export default function ChallengeInput({
  challengeType,
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
  huntId,
  findId,
  showQuestion = true,
}: ChallengeInputProps) {
  const field = { content, answer, onAnswerChange, onSubmit, disabled, showQuestion };
  switch (challengeType) {
    case "multiple_choice":
      return <MultipleChoice {...field} />;
    case "numeric_entry":
      return <NumericEntry {...field} />;
    case "sorting_ordering":
      return <SortingOrdering {...field} />;
    case "photo_observation":
      return <PhotoObservation {...field} />;
    case "sketch_draw":
      return <SketchDraw {...field} />;
    case "audio_response":
      return <AudioResponse {...field} huntId={huntId} findId={findId} />;
    default:
      // short_text, creative_writing, data_collection, team_debate
      return <TextInput {...field} challengeType={challengeType} />;
  }
}
