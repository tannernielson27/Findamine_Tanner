/**
 * Only same-site relative paths are allowed as post-confirm / post-login
 * destinations. Whitespace and control characters are refused because
 * browsers strip them while parsing, which can turn "/\t/evil" into "//evil".
 *
 * No server imports: used by both route handlers and the auth forms.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    /[\s\u0000-\u001f\u007f]/.test(next)
  ) {
    return fallback;
  }
  return next;
}
