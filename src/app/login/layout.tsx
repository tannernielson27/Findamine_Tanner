import type { Metadata } from "next";

// Metadata-only layout: gives this section its own <title> (the pages below
// are client components and cannot export metadata themselves).
export const metadata: Metadata = { title: "Sign in" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
