/** "team_self_select" -> "Team (self-select)", "solo" -> "Solo". */
export function formatPlayMode(playMode: string | null | undefined): string {
  if (!playMode) return "";
  const [head, ...rest] = playMode.split("_");
  const label = head.charAt(0).toUpperCase() + head.slice(1);
  if (rest.length === 0) return label;
  const detail = rest.join(" ").replace("self select", "self-select").replace(/\bai\b/, "AI");
  return `${label} (${detail})`;
}
