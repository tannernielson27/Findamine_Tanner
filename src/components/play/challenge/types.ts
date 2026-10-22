/** Props every challenge-type input takes. */
export interface ChallengeFieldProps {
  content: Record<string, unknown>;
  answer: string;
  onAnswerChange: (a: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /**
   * Render the question text above the input. The challenge sheet shows the
   * question as its own heading and passes false.
   */
  showQuestion?: boolean;
}

/** The challenge's question text, from either content field. */
export function questionOf(content: Record<string, unknown>, fallback = ""): string {
  return (content.question as string) || (content.text as string) || fallback;
}
