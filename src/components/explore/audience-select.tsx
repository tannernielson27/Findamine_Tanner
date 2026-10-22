"use client";

/**
 * "Hunts for: Adults & families" picker. The default comes from the viewer
 * (role + age band, see defaultAudiencesFor) and can be a set; picking a
 * value puts exactly one audience (or "All ages") in the URL. Quiet by
 * design: it sits under the chips, not among them.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  ANY_AUDIENCE,
  AUDIENCE_OPTIONS,
  audienceSetLabel,
  exploreHref,
  type AudienceChoice,
  type FilterId,
} from "@/lib/hunts/explore-filters";

interface AudienceSelectProps {
  q: string;
  filters: FilterId[];
  /** The audience filter in effect. */
  choice: AudienceChoice;
}

/** Option value for "the viewer's default", used only when that default is a set. */
const DEFAULT_VALUE = "";

function selectedValue(choice: AudienceChoice): string {
  if (!choice.audiences) return ANY_AUDIENCE;
  if (choice.audiences.length === 1) return choice.audiences[0];
  return DEFAULT_VALUE;
}

export function AudienceSelect({ q, filters, choice }: AudienceSelectProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const value = selectedValue(choice);
  // A multi-audience default ("Adults & families") has no single option, so it gets its own.
  const showDefault = value === DEFAULT_VALUE;

  return (
    <label className="relative inline-flex min-h-12 items-center gap-1.5 text-base text-themed-muted">
      <span>Hunts for</span>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const audience = e.target.value || null;
          startTransition(() => router.push(exploreHref({ q, filters, audience }), { scroll: false }));
        }}
        className="min-h-12 cursor-pointer appearance-none bg-transparent pr-6 text-base font-semibold text-themed-text underline decoration-themed-border underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {showDefault && <option value={DEFAULT_VALUE}>{audienceSetLabel(choice.audiences)}</option>}
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
