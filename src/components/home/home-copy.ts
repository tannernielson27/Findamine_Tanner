/**
 * Small pieces of Home copy that depend on counts. Pure, so they are unit
 * tested (src/__tests__/home-copy.test.ts).
 */

/** "1 completion", "0 hunts", "2 categories". */
export function countLabel(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Subtitle for the creator insights card, or null to hide it. The API counts
 * hunts with enough plays to compare separately from every completed session,
 * so with no comparable hunts the line would read "0 hunts · 1 completion".
 * Hide it then, and never show fewer completions than listed hunts.
 */
export function insightsSummary(huntsWithData: number, completions: number): string | null {
  if (huntsWithData <= 0) return null;
  const shownCompletions = Math.max(completions, huntsWithData);
  return `${countLabel(huntsWithData, "hunt")} · ${countLabel(shownCompletions, "completion")}`;
}

/** "See all 4" when Home previews only some of the creator's hunts. */
export function yourHuntsLinkLabel(total: number): string {
  return total > 0 ? `See all ${total}` : "My Hunts";
}
