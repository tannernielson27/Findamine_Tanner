/**
 * Where to send a participant after a survey, taken from the `?return=` query
 * parameter. The value is untrusted, so only a same-origin, in-app path is
 * accepted — never an absolute or protocol-relative URL (open redirect).
 */

/** The path if it is a safe in-app destination, else null. Pure. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  if (!raw.startsWith("/")) return null; // relative or absolute-with-scheme
  if (raw.startsWith("//")) return null; // protocol-relative → another origin
  // Browsers treat "\" like "/" and strip tabs/newlines when resolving URLs.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

/** Button label for a return destination. Pure. */
export function returnLabel(path: string): string {
  return path.startsWith("/settings/privacy") ? "Back to privacy settings" : "Continue";
}
