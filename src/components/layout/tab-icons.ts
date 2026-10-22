import { Compass, House, Map, Trophy, UserRound, type LucideIcon } from "lucide-react";
import type { TabIconKey } from "./nav-links";

export const TAB_ICONS: Record<TabIconKey, LucideIcon> = {
  home: House,
  explore: Compass,
  ranks: Trophy,
  hunts: Map,
  profile: UserRound,
};
