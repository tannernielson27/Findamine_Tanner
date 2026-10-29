import type { Metadata } from "next";

// Metadata-only layout: gives this section its own <title> (the pages below
// are client components and cannot export metadata themselves). The template
// keeps "| findamine" on child titles (Privacy Settings).
export const metadata: Metadata = {
  title: { default: "Settings", template: "%s | findamine" },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
