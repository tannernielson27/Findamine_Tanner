"use client";

import { useEffect, useState } from "react";
import { MapPinned } from "lucide-react";
import { HuntCard } from "@/components/ui/hunt-card";
import type { HuntCardData } from "@/lib/hunts/card-data";
import { getCurrentLocation } from "@/lib/native/geolocation";
import { queryPlatformPermission } from "@/lib/native/permissions";
import { SectionHeader } from "./section-header";
import { withDistances } from "./home-data";

const SHOWN = 8;

/**
 * "Near you" carousel of shelf cards. The list arrives from the server
 * (published, public, the player's audience band). Distances appear only when
 * location permission is ALREADY granted: Home never triggers the prompt
 * (permission is asked at "Start hunt", OVERHAUL_PLAN.md §4.7).
 */
export function NearYou({ hunts }: { hunts: HuntCardData[] }) {
  const [sorted, setSorted] = useState<HuntCardData[] | null>(null);

  useEffect(() => {
    if (hunts.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        if ((await queryPlatformPermission("location")) !== "granted") return;
        const fix = await getCurrentLocation({ enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 8_000 });
        if (!cancelled) setSorted(withDistances(hunts, { lat: fix.latitude, lng: fix.longitude }));
      } catch {
        // No fix: keep the server order without distances.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hunts]);

  const shown = (sorted ?? hunts).slice(0, SHOWN);

  return (
    <section aria-labelledby="home-near-you" className="mt-7">
      <SectionHeader id="home-near-you" title="Near you" link={{ href: "/browse", label: "See all" }} />
      {shown.length === 0 ? (
        <div className="mx-4 flex items-center gap-3.5 rounded-card border border-themed-border bg-surface p-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-juniper-tint text-juniper" aria-hidden="true">
            <MapPinned className="h-6 w-6" />
          </span>
          <p className="m-0 text-base text-themed-muted">
            No hunts for your age group are published yet. New ones show up here first.
          </p>
        </div>
      ) : (
        <ul className="fm-no-scrollbar m-0 flex snap-x snap-mandatory list-none gap-3 overflow-x-auto px-4 pb-1" aria-label="Hunts near you">
          {shown.map((hunt) => (
            <li key={hunt.id} className="shrink-0 snap-start">
              <HuntCard hunt={hunt} variant="shelf" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Skeleton matching two shelf cards. */
export function NearYouSkeleton() {
  return (
    <div className="mt-7" aria-hidden="true">
      <div className="px-5 pb-3">
        <div className="h-7 w-32 rounded-md bg-divider" />
      </div>
      <div className="flex gap-3 overflow-hidden px-4">
        {[0, 1].map((i) => (
          <div key={i} className="fm-shimmer w-[236px] shrink-0 overflow-hidden rounded-2xl border border-themed-border bg-surface">
            <div className="h-[120px] bg-divider" />
            <div className="flex flex-col gap-2 px-3.5 pb-3.5 pt-3">
              <div className="h-5 w-3/4 rounded-md bg-divider" />
              <div className="h-4 w-1/2 rounded-md bg-divider" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
