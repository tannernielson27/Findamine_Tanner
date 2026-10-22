import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { bandForUser } from "@/lib/utils/age-band";

export interface BrowseViewer {
  id: string;
  role: string;
  /** Age band (lib/utils/age-band): primary | intermediate | teen | adult. */
  band: string;
}

/**
 * The signed-in viewer for the public catalogue pages, or null for a
 * signed-out visitor. Same lookups as the app layout (users row + stored
 * band), without anything study-related.
 */
export async function getBrowseViewer(): Promise<BrowseViewer | null> {
  const authClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return null;

  const supabase = await createSupabaseServiceClient();
  const { data: row } = await supabase
    .from("users")
    .select("id, role")
    .eq("auth_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("effective_band")
    .eq("user_id", row.id)
    .maybeSingle();

  return { id: row.id, role: row.role, band: bandForUser(profile?.effective_band, row.role) };
}
