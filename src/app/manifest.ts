import type { MetadataRoute } from "next";

// Minimal web manifest so "Add to Home Screen" gets the brand mark and name.
// Icons are rasterized from public/icon.svg (the existing compass mark).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "findamine",
    short_name: "findamine",
    description: "Location-based educational scavenger hunts for classrooms and families.",
    start_url: "/",
    display: "standalone",
    background_color: "#FEFCF6",
    theme_color: "#0EA5E9",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
