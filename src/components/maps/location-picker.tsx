"use client";

import dynamic from "next/dynamic";

/**
 * Location picker map. Google Maps loads as its own chunk on the client only,
 * so hunt-builder pages don't ship it in their initial bundle.
 */
const LocationPicker = dynamic(() => import("./location-picker-impl"), {
  ssr: false,
  loading: () => (
    <div
      style={{ width: "100%", height: "250px", borderRadius: "8px" }}
      className="bg-gray-100 fm-shimmer flex items-center justify-center"
    >
      <span className="text-sm text-gray-500">Loading map...</span>
    </div>
  ),
});

export default LocationPicker;
