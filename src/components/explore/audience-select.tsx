"use client";

/**
 * "Hunts for: Adults" picker. The default comes from the viewer's age band
 * (so adults don't see kids' hunts first); picking another value puts it in
 * the URL. Quiet by design: it sits under the chips, not among them.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { ANY_AUDIENCE, AUDIENCE_OPTIONS, exploreHref, type Audience, type FilterId } from "@/lib/hunts/explore-filters";

interface AudienceSelectProps {
  q: string;
  filters: FilterId[];
  /** The audience in effect (null = every age). */
  current: Audience | null;
}

export function AudienceSelect({ q, filters, current }: AudienceSelectProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="relative inline-flex min-h-12 items-center gap-1.5 text-[15px] text-themed-muted">
      <span>Hunts for</span>
      <select
        value={current ?? ANY_AUDIENCE}
        disabled={pending}
        onChange={(e) => {
          const audience = e.target.value;
          startTransition(() => router.push(exploreHref({ q, filters, audience }), { scroll: false }));
        }}
        className="min-h-12 cursor-pointer appearance-none bg-transparent pr-6 font-semibold text-themed-text underline decoration-themed-border underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {AUDIENCE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-themed-text" aria-hidden="true" />
    </label>
  );
}
