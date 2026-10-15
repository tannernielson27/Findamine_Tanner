import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // Sections set a short title (metadata-only layout.tsx files); the template
  // brands it. Pages with no title of their own fall back to `default`.
  title: {
    default: "findamine - GPS Treasure Hunting Adventures",
    template: "%s | findamine",
  },
  description:
    "Location-based educational scavenger hunts for classrooms, campuses, and curious explorers.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// Mobile is the primary device (GPS field app). Next auto-injects
// width=device-width, initial-scale=1; we keep zoom ENABLED (no maximum-scale /
// user-scalable=no) so the viewport stays accessible, and add a theme color.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0EA5E9",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: "16px" }}>
        {children}
      </body>
    </html>
  );
}
