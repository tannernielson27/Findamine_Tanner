import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

/** Roles allowed into /admin at all (same gate as the /admin home page). */
const ADMIN_AREA_ROLES = ["admin", "researcher"];

/**
 * Resolve the signed-in user's role for an /admin page.
 * Redirects to /login when signed out and to /dashboard for roles that have no
 * business in /admin; returns "admin" or "researcher" otherwise.
 */
export async function getAdminAreaRole(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const service = await createSupabaseServiceClient();
  const { data: profile } = await service
    .from("users")
    .select("role")
    .eq("auth_id", authUser.id)
    .single();

  if (!profile || !ADMIN_AREA_ROLES.includes(profile.role)) redirect("/dashboard");
  return profile.role;
}

/**
 * Shown to a researcher who opens an admin-only section, instead of silently
 * bouncing them to /dashboard with no explanation.
 */
export function AdminOnlyNotice({ area }: { area: string }) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <Link href="/admin" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Admin
      </Link>
      <h1 className="text-lg font-semibold text-gray-900 mb-4">{area}</h1>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        {area} is available to admin accounts only. Your researcher role can&apos;t open it — ask an admin
        if you need something from this section.
      </div>
    </main>
  );
}
