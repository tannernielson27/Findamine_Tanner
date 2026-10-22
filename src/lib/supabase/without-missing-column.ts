/**
 * Tolerates a select list that names a column a database doesn't have yet
 * (a migration written but not applied everywhere). If the query fails with
 * Postgres `42703` (undefined_column), it is retried once without the
 * optional columns. Any other error, or a second failure, is returned as is.
 *
 * Generic: works with any query builder that resolves to `{ error }`.
 */

/** Postgres SQLSTATE for "column does not exist". */
export const UNDEFINED_COLUMN_CODE = "42703";

export interface QueryErrorLike {
  code?: string | null;
}

export interface QueryResultLike {
  error: QueryErrorLike | null;
}

/** Splits a PostgREST select list on top-level commas (commas inside embeds are kept). Pure. */
export function splitSelectColumns(columns: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of columns) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.filter((p) => p.length > 0);
}

/** The select list without the named top-level columns. Pure. */
export function removeSelectColumns(columns: string, remove: readonly string[]): string {
  return splitSelectColumns(columns)
    .filter((part) => !remove.includes(part))
    .join(", ");
}

/** True when the error is Postgres "column does not exist". */
export function isMissingColumnError(error: QueryErrorLike | null | undefined): boolean {
  return error?.code === UNDEFINED_COLUMN_CODE;
}

/**
 * Runs `run(columns)`; on an undefined-column error, runs it once more with
 * `optional` columns removed from the list.
 *
 * @example
 * const { data, error } = await withoutMissingColumn(
 *   (cols) => db.from("hunts").select(cols).eq("is_public", true),
 *   "id, title, cover_image_url",
 *   ["cover_image_url"],
 * );
 */
export async function withoutMissingColumn<R extends QueryResultLike>(
  run: (columns: string) => PromiseLike<R>,
  columns: string,
  optional: readonly string[]
): Promise<R> {
  const first = await run(columns);
  if (!isMissingColumnError(first.error)) return first;
  const reduced = removeSelectColumns(columns, optional);
  if (reduced === removeSelectColumns(columns, [])) return first;
  return run(reduced);
}
