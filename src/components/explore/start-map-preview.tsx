"use client";

import dynamic from "next/dynamic";

/**
 * "Where it starts" map preview. Google Maps loads as its own chunk on the
 * client; until then (and if it never loads) the plain topo art stands in.
 */
export const StartMapPreview = dynamic(
  () => import("./start-map-preview-impl").then((mod) => mod.StartMapPreview),
  {
    ssr: false,
    loading: () => (
      <div
        role="img"
        aria-label="Map of the area where this hunt starts"
        className="relative h-[150px] overflow-hidden rounded-[18px] border border-themed-border bg-map-ground"
      >
        <div className="fm-cover-juniper absolute inset-0" aria-hidden="true">
          <span className="absolute left-1/2 top-[40%] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-brand bg-brand/15" />
        </div>
        <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1.5 text-[13px] font-semibold text-themed-text">
          Start area
        </span>
      </div>
    ),
  }
);
