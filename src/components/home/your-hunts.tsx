import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import InsightsPanel from "@/components/hunts/insights-panel";
import { Tag } from "@/components/ui/chip";
import { cn } from "@/lib/utils/cn";
import { SectionHeader } from "./section-header";
import { yourHuntsLinkLabel } from "./home-copy";

export interface CreatorHuntSummary {
  id: string;
  title: string;
  status: string;
  stopCount: number;
}

interface YourHuntsProps {
  hunts: CreatorHuntSummary[];
  /** All of the creator's live hunts, not just the ones listed. */
  total: number;
}

function statusTag(status: string) {
  if (status === "published" || status === "enrollment_open" || status === "in_progress") return <Tag tone="juniper">Live</Tag>;
  if (status === "ended") return <Tag tone="sky">Ended</Tag>;
  return <Tag tone="neutral">Draft</Tag>;
}

/**
 * Creators only: the three most recently edited hunts, a create shortcut, and
 * the existing play insights panel (renders nothing until there's data).
 */
export function YourHunts({ hunts, total }: YourHuntsProps) {
  return (
    <section aria-labelledby="home-your-hunts" className="mx-4 mt-7">
      <SectionHeader
        id="home-your-hunts"
        title="Your hunts"
        link={{ href: "/dashboard/hunts", label: yourHuntsLinkLabel(total) }}
        className="px-1"
      />
      {hunts.length === 0 ? (
        <Link
          href="/dashboard/hunts/new"
          className="flex min-h-16 items-center gap-3.5 rounded-card border border-dashed border-themed-border bg-surface p-5 text-themed-text no-underline hover:bg-themed-bg"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-light text-brand-dark" aria-hidden="true">
            <Plus className="h-6 w-6" />
          </span>
          <span className="flex flex-col">
            <span className="font-[family-name:var(--font-display)] text-lg font-semibold">Create your first hunt</span>
            <span className="text-sm text-themed-muted">Drop stops on a map and write the clues.</span>
          </span>
        </Link>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-card border border-themed-border bg-surface p-0">
          {hunts.map((hunt, i) => (
            <li key={hunt.id} className={cn(i > 0 && "border-t border-divider")}>
              <Link
                href={`/dashboard/hunts/${hunt.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 text-themed-text no-underline hover:bg-themed-bg"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-[family-name:var(--font-display)] text-lg font-semibold">{hunt.title}</span>
                  <span className="flex items-center gap-2 text-sm text-themed-muted">
                    {statusTag(hunt.status)}
                    {hunt.stopCount} {hunt.stopCount === 1 ? "stop" : "stops"}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-themed-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 empty:hidden">
        <InsightsPanel />
      </div>
    </section>
  );
}
