"use client";

import { GoogleMap, MarkerF } from "@react-google-maps/api";
import { useGoogleMaps } from "@/components/maps/use-google-maps";

interface StopMapProps {
  lat: number;
  lng: number;
  order: number;
}

/** Map header for the stop detail modal. Renders nothing until Google Maps is ready (or if it can't load). */
export default function StopMap({ lat, lng, order }: StopMapProps) {
  const { isLoaded } = useGoogleMaps();
  if (!isLoaded) return null;

  return (
    <div className="h-48 rounded-t-2xl overflow-hidden">
    <GoogleMap
      mapContainerStyle={{ width: "100%", height: "100%" }}
      center={{ lat, lng }}
      zoom={16}
      options={{
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      }}
    >
      <MarkerF
        position={{ lat, lng }}
        label={{
          text: String(order),
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
  );
}
