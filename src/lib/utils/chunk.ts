/**
 * How many ids go into one `.in("id", ids)` filter. PostgREST takes the filter
 * in the URL, so a full leaderboard's worth of uuids in one request can pass
 * the gateway's URL limit; 100 ids keeps each request around 4 KB.
 */
export const ID_BATCH_SIZE = 100;

/** Split a list into consecutive batches of at most `size` items. Never mutates. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
