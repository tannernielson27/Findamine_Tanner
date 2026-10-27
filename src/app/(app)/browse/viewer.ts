import { cache } from "react";
import { getViewerRow } from "@/lib/auth/viewer";
import { bandForUser } from "@/lib/utils/age-band";

export interface BrowseViewer {
  id: string;
  role: string;
  /** Age band (lib/utils/age-band): primary | intermediate | teen | adult. */
  band: string;
}

/**
 * The signed-in viewer for the public catalogue pages, or null for a
 * signed-out visitor. Reuses the request-scoped lookup the app layout already
 * made (auth check + users row + stored band), so it costs no extra queries.
 */
export const getBrowseViewer = cache(async (): Promise<BrowseViewer | null> => {
  const row = await getViewerRow();
  if (!row) return null;
  return { id: row.id, role: row.role, band: bandForUser(row.effective_band, row.role) };
});
