import { appleAppSiteAssociation } from "@/lib/native/universal-links";

// The same file on every host (findamine-tanner.vercel.app and findamine.app).
export const dynamic = "force-static";

/** Served as JSON with no extension and no redirect, as iOS requires. */
export function GET(): Response {
  return Response.json(appleAppSiteAssociation(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
