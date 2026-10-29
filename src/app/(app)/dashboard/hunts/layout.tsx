import type { Metadata } from "next";

// Metadata-only layout: gives this section its own <title> (the pages below
// are client components and cannot export metadata themselves).
// `absolute` because the parent dashboard layout sets a plain string title,
// which stops the root "%s | findamine" template reaching this segment.
export const metadata: Metadata = { title: { absolute: "My Hunts | findamine" } };

export default function HuntsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
