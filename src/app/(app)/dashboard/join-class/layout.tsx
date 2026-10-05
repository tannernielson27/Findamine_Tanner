import type { Metadata } from "next";

// Metadata-only layout: gives this section its own <title> (the pages below
// are client components and cannot export metadata themselves).
export const metadata: Metadata = { title: "Join a Class" };

export default function JoinClassLayout({ children }: { children: React.ReactNode }) {
  return children;
}
