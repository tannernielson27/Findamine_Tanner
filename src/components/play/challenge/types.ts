/** Props every challenge-type input takes. */
export interface ChallengeFieldProps {
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (a: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}
