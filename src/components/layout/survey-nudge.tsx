"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList } from "lucide-react";

/**
 * Navbar affordance that surfaces pending survey deliveries so participants
 * actually see and complete T1/T2/T3 check-ins. Renders nothing when there is
 * nothing due. Re-checks on route change so the badge clears after submitting.
 */
export default function SurveyNudge() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/surveys?pending=true")
      .then((r) => (r.ok ? r.json() : { deliveries: [] }))
      .then((data) => {
        if (!cancelled) setCount((data.deliveries || []).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (count === 0) return null;

  return (
    <Link
      href="/surveys"
      title={`${count} survey${count === 1 ? "" : "s"} to complete`}
      aria-label={`${count} survey${count === 1 ? "" : "s"} to complete`}
      className="relative flex h-12 w-12 items-center justify-center rounded-full border border-themed-border bg-surface text-themed-text transition-colors duration-150 hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
    >
      <ClipboardList className="h-[22px] w-[22px]" aria-hidden="true" />
      <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-brand px-1 text-xs font-bold leading-none text-white tabular-nums">
        {count}
      </span>
    </Link>
  );
}
