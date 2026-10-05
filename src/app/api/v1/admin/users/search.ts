/**
 * Make a search term safe to embed in a PostgREST `.or()` filter.
 *
 * The term is sent as a double-quoted value, inside which `.`, `,`, `(`, `)`
 * and `@` are literal — so emails stay searchable. Only the characters that
 * could end the quoted value (`"`, `\`) or act as LIKE wildcards (`%`, `*`)
 * are removed.
 */
export function safeSearchTerm(q: string): string {
  return q.replace(/["\\%*]/g, "").trim().slice(0, 100);
}

/** `.or()` filter matching the term against display name or email. */
export function userSearchFilter(term: string): string {
  return `display_name.ilike."%${term}%",email.ilike."%${term}%"`;
}
