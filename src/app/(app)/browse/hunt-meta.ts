import { Globe, House, Star, Target, Zap, type LucideIcon } from "lucide-react";

/** Lucide icon per target audience (replaces the old emoji map). */
const AUDIENCE_ICONS: Record<string, LucideIcon> = {
  kids: Star,
  teens: Zap,
  adults: Target,
  family: House,
  all: Globe,
};

/** Decorative audience icon; falls back to a globe for unknown audiences. */
export function AudienceIcon({ audience, className }: { audience: string | null | undefined; className?: string }) {
  const Icon = (audience && AUDIENCE_ICONS[audience]) || Globe;
  return <Icon className={className} aria-hidden="true" />;
}

/** "team_self_select" -> "Team (self-select)", "solo" -> "Solo". */
export function formatPlayMode(playMode: string | null | undefined): string {
  if (!playMode) return "";
  const [head, ...rest] = playMode.split("_");
  const label = head.charAt(0).toUpperCase() + head.slice(1);
  if (rest.length === 0) return label;
  const detail = rest.join(" ").replace("self select", "self-select").replace(/\bai\b/, "AI");
  return `${label} (${detail})`;
}
