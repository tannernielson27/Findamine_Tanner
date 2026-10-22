"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { activeTabHref, type TabLink } from "./nav-links";
import { TAB_ICONS } from "./tab-icons";

/**
 * Floating capsule tab bar (Main.dc.html). Phones and tablets only; lg+ shows
 * the same destinations in the top bar. 68px tall, 24px above the home
 * indicator, frosted (.fm-glass). Geometry matches the --fm-tabbar-* tokens
 * that .fm-tab-safe pads for.
 */
export default function TabBar({ tabs, pathname }: { tabs: readonly TabLink[]; pathname: string }) {
  const active = activeTabHref(tabs, pathname);
  return (
    <nav
      aria-label="Main"
      className="fm-glass fixed inset-x-4 bottom-[calc(var(--fm-tabbar-gap)+env(safe-area-inset-bottom))] z-40 mx-auto grid h-[var(--fm-tabbar-h)] max-w-md gap-0 rounded-[34px] border border-themed-border/90 p-1.5 shadow-float lg:hidden"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.icon];
        const current = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-[28px] text-xs no-underline transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              current ? "bg-brand-light font-bold text-brand-dark" : "font-semibold text-themed-muted hover:text-themed-text"
            )}
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={current ? 2.2 : 2} aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
