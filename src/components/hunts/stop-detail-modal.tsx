"use client";

import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { GoogleMap, useJsApiLoader, Marker } from "@react-google-maps/api";

interface StopData {
  id: string;
  order: number;
  clue_text: string | null;
  clue_hints: string[];
  location_name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  challenge_type: string | null;
  challenge_title: string | null;
  primer_title: string | null;
  primer_text: string | null;
}

interface StopDetailModalProps {
  stop: StopData;
  onClose: () => void;
}

export default function StopDetailModal({ stop, onClose }: StopDetailModalProps) {
  const [showHints, setShowHints] = useState(false);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
  });

  const hasCoords = stop.lat !== 0 && stop.lng !== 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-detail-title"
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-surface shadow-xl"
      >
        {/* Map header */}
        {hasCoords && isLoaded && (
          <div className="h-48 rounded-t-2xl overflow-hidden">
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "100%" }}
              center={{ lat: stop.lat, lng: stop.lng }}
              zoom={16}
              options={{
                disableDefaultUI: true,
                zoomControl: true,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
              }}
            >
              <Marker
                position={{ lat: stop.lat, lng: stop.lng }}
                label={{
                  text: String(stop.order),
                  color: "white",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
                icon={{
                  path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
                  fillColor: "#C2410C",
                  fillOpacity: 0.9,
                  strokeColor: "#9A3412",
                  strokeWeight: 1,
                  scale: 1.8,
                  anchor: new google.maps.Point(12, 24),
                  labelOrigin: new google.maps.Point(12, 9),
                }}
              />
            </GoogleMap>
          </div>
        )}

        <div className="p-5">
          {/* Header */}
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-sm font-bold tabular-nums text-brand-dark">
                  {stop.order}
                </span>
                <h2 id="stop-detail-title" className="min-w-0 font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text text-balance">
                  {stop.location_name}
                </h2>
              </div>
              {stop.challenge_type && (
                <span className="text-sm capitalize text-secondary">{stop.challenge_type.replace(/_/g, " ")}</span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-themed-muted transition-colors hover:bg-themed-bg hover:text-themed-text"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Primer */}
          {stop.primer_title && (
            <div className="mb-3 rounded-lg border border-secondary/30 bg-secondary/10 p-3">
              <p className="mb-1 text-sm font-semibold text-secondary">Primer: {stop.primer_title}</p>
              {stop.primer_text && (
                <p className="text-sm text-themed-text">{stop.primer_text}</p>
              )}
            </div>
          )}

          {/* Clue */}
          {stop.clue_text && (
            <div className="mb-3 rounded-lg border border-brand/30 bg-brand-light p-3">
              <p className="mb-1 text-sm font-semibold text-brand-dark">Clue</p>
              <p className="text-base text-themed-text">{stop.clue_text}</p>
            </div>
          )}

          {/* Clue hints */}
          {stop.clue_hints.length > 0 && (
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setShowHints(!showHints)}
                aria-expanded={showHints}
                className="inline-flex min-h-11 items-center text-sm font-medium text-link transition-colors hover:text-link-dark hover:underline"
              >
                {showHints ? "Hide" : "Show"} location hints ({stop.clue_hints.length})
              </button>
              {showHints && (
                <div className="mt-1 space-y-1.5">
                  {stop.clue_hints.map((hint, i) => (
                    <div key={i} className="rounded-lg border border-themed-border bg-themed-bg px-3 py-2">
                      <p className="text-sm font-medium text-themed-muted">Hint {i + 1}</p>
                      <p className="text-sm text-themed-text">{hint}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Challenge */}
          {stop.challenge_title && (
            <div className="mb-3 rounded-lg border border-themed-border bg-themed-bg p-3">
              <p className="text-sm font-medium text-themed-text">Challenge: {stop.challenge_title}</p>
            </div>
          )}

          {/* Location details */}
          {hasCoords && (
            <p className="text-sm tabular-nums text-themed-muted">
              Location: {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)} · Radius: {stop.radius_meters}m
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Clickable stop list that opens the detail modal.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function StopList({ finds }: { finds: any[] }) {
  const [selectedStop, setSelectedStop] = useState<StopData | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleClick(find: any, index: number) {
    const locations = find.locations;
    const tasks = find.tasks;
    const primers = find.primers;
    const clueHints = (find.clue_hints || []) as string[];

    setSelectedStop({
      id: find.id as string,
      order: index + 1,
      clue_text: find.clue_text as string | null,
      clue_hints: clueHints,
      location_name: locations?.name || `Stop ${index + 1}`,
      lat: locations?.latitude || 0,
      lng: locations?.longitude || 0,
      radius_meters: locations?.radius_meters || 50,
      challenge_type: tasks?.challenge_type || null,
      challenge_title: tasks?.title || null,
      primer_title: primers?.title || null,
      primer_text: typeof primers?.content === "object" ? (primers.content as Record<string, unknown>)?.text as string || null : null,
    });
  }

  return (
    <>
      <ol className="space-y-2">
        {finds.map((find, i) => {
          const locations = find.locations as { name: string } | null;
          const tasks = find.tasks as { title: string; challenge_type: string } | null;
          return (
            <li key={find.id as string}>
              <button
                onClick={() => handleClick(find, i)}
                type="button"
                className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-themed-border bg-surface p-3 text-left transition-colors hover:border-secondary/40 hover:bg-themed-bg"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary/10 text-sm font-semibold tabular-nums text-secondary">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-themed-text">
                    {locations?.name || `Stop ${i + 1}`}
                  </span>
                  {find.clue_text && (
                    <span className="mt-0.5 block line-clamp-1 text-sm text-themed-muted">{find.clue_text as string}</span>
                  )}
                  {tasks && (
                    <span className="block text-sm capitalize text-secondary">
                      {tasks.challenge_type.replace(/_/g, " ")}
                    </span>
                  )}
                </span>
                <span className="inline-flex shrink-0 items-center gap-0.5 text-sm text-link">
                  View
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {selectedStop && (
        <StopDetailModal stop={selectedStop} onClose={() => setSelectedStop(null)} />
      )}
    </>
  );
}
