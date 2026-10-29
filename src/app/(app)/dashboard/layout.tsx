import type { Metadata } from "next";

// Metadata-only layout: gives this section its own <title> (the pages below
// are client components and cannot export metadata themselves). The template
// re-brands the child sections' titles; a plain string here would drop the
// root "%s | findamine" template for every page below.
export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s | findamine" },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
