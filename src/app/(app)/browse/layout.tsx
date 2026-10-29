import type { Metadata } from "next";

// Metadata-only layout: gives this section its own <title> (the pages below
// are client components and cannot export metadata themselves). The template
// keeps "| findamine" on child titles (Browse by Standard).
export const metadata: Metadata = {
  title: { default: "Explore", template: "%s | findamine" },
};

export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
