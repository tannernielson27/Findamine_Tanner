"use client";

import { GoogleMap, MarkerF, CircleF } from "@react-google-maps/api";
import { useCallback, useMemo, useState } from "react";
import { useGoogleMaps } from "./use-google-maps";

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onLocationChange: (lat: number, lng: number) => void;
}

const containerStyle = { width: "100%", height: "250px", borderRadius: "8px" };

// Default: BYU campus
const DEFAULT_CENTER = { lat: 40.2338, lng: -111.6585 };

export default function LocationPicker({
  latitude,
  longitude,
  radiusMeters,
  onLocationChange,
}: LocationPickerProps) {
  const { isLoaded, unavailableReason } = useGoogleMaps();

  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [map, setMap] = useState<google.maps.Map | null>(null);

  // Memoized so the map only re-centers when the coordinates really change,
  // not on every keystroke in the search box.
  const position = useMemo(
    () => (latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null),
    [latitude, longitude]
  );

  const center = position || DEFAULT_CENTER;

  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
  }, []);

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (e.latLng) {
        setSearchError("");
        onLocationChange(e.latLng.lat(), e.latLng.lng());
      }
    },
    [onLocationChange]
  );

  const handleSearch = useCallback(() => {
    const address = searchInput.trim();
    if (!address) return;
    if (!map) {
      setSearchError("The map is still loading — try again in a moment.");
      return;
    }

    setSearching(true);
    setSearchError("");
    const geocoder = new google.maps.Geocoder();
    geocoder
      .geocode({ address })
      .then(({ results }) => {
        const loc = results[0]?.geometry.location;
        if (!loc) {
          setSearchError(`No place found for "${address}". Try a fuller address, or click the map instead.`);
          return;
        }
        onLocationChange(loc.lat(), loc.lng());
        map.panTo(loc);
        map.setZoom(17);
      })
      .catch((err: { code?: string }) => {
        setSearchError(
          err?.code === "ZERO_RESULTS"
            ? `No place found for "${address}". Try a fuller address, or click the map instead.`
            : "Address search isn't available right now. Click the map to set the location instead."
        );
      })
      .finally(() => setSearching(false));
  }, [map, searchInput, onLocationChange]);

  if (unavailableReason) {
    return (
      <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {unavailableReason}
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div style={containerStyle} className="bg-gray-100 fm-shimmer flex items-center justify-center">
        <span className="text-sm text-gray-500">Loading map...</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Address search */}
      <div className="flex gap-2">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // This picker is often rendered inside a <form>; Enter here means
            // "search", never "submit the surrounding form".
            e.preventDefault();
            handleSearch();
          }}
          placeholder="Search address or place..."
          aria-label="Search for an address or place"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </div>
      {searchError && (
        <p role="alert" className="text-xs text-red-600">{searchError}</p>
      )}

      {/* Map */}
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={position ? 17 : 14}
        onLoad={onLoad}
        onClick={handleMapClick}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: false,
        }}
      >
        {position && (
          <>
            <MarkerF position={position} />
            <CircleF
              center={position}
              radius={radiusMeters}
              options={{
                fillColor: "#0EA5E9",
                fillOpacity: 0.1,
                strokeColor: "#0EA5E9",
                strokeWeight: 2,
                strokeOpacity: 0.5,
              }}
            />
          </>
        )}
      </GoogleMap>

      <p className="text-[10px] text-gray-500">
        Click the map to set the location, or search for an address above.
      </p>
    </div>
  );
}
