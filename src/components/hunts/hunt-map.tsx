"use client";

import dynamic from "next/dynamic";

/**
 * Hunt overview map. The Google Maps bindings load as their own chunk on the
 * client only, so pages that show it don't ship them in the main bundle.
 */
const HuntMap = dynamic(() => import("./hunt-map-impl"), {
  ssr: false,
  loading: () => (
    <div className="mb-6 rounded-xl border border-themed-border bg-themed-bg fm-shimmer" style={{ width: "100%", height: "300px" }} aria-hidden="true" />
  ),
});

export default HuntMap;
