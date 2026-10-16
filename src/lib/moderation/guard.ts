import { ApiError } from "@/lib/utils/api-auth";
import { checkText, filterLevelForRole } from "./content-filter";

/**
 * Reject user-generated text that fails the objectionable-content filter.
 * Children's text is checked at the strict level. The error names the field
 * but never echoes the matched word back.
 *
 * Status 422 keeps it a 4xx, so clients show the message as-is
 * (see socialErrorMessage).
 */
export function assertCleanText(
  text: string | null | undefined,
  opts: { role?: string | null; label?: string } = {}
): void {
  if (!text) return;
  const result = checkText(text, filterLevelForRole(opts.role));
  if (result.allowed) return;
  const label = opts.label ?? "That message";
  throw new ApiError(
    422,
    `${label} includes language that isn't allowed on Findamine. Please rephrase it and try again.`
  );
}
