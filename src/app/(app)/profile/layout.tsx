import type { Metadata } from "next";

// Metadata-only layout: gives this section its own <title> (the pages below
// are client components and cannot export metadata themselves).
export const metadata: Metadata = { title: "Profile" };

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
