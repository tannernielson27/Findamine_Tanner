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
      className="relative flex h-10 w-10 items-center justify-center rounded-lg text-themed-muted hover:bg-themed-bg transition-colors"
    >
      <ClipboardList className="w-5 h-5" aria-hidden="true" />
      <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">
        {count}
      </span>
    </Link>
  );
}
