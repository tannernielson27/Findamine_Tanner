"use client";

import { MultipleChoice } from "./challenge/multiple-choice";
import { NumericEntry } from "./challenge/numeric-entry";
import { SortingOrdering } from "./challenge/sorting-ordering";
import { PhotoObservation } from "./challenge/photo-observation";
import { SketchDraw } from "./challenge/sketch-draw";
import { AudioResponse } from "./challenge/audio-response";
import { TextInput } from "./challenge/text-input";

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
}: ChallengeInputProps) {
  const field = { content, answer, onAnswerChange, onSubmit, disabled };
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
