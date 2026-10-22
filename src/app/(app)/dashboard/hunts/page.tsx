import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Map, Plus, PlusCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export default async function MyHuntsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const serviceClient = await createSupabaseServiceClient();
  const { data: profile } = await serviceClient
    .from("users")
    .select("id")
    .eq("auth_id", authUser.id)
    .single();

  if (!profile) redirect("/login");

  const { data: hunts } = await serviceClient
    .from("hunts")
    .select("id, title, status, target_audience, play_mode, created_at, finds(count)")
    .eq("created_by", profile.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Map className="w-6 h-6 text-brand" />
          My Hunts
        </h1>
        {/* "Create" is not a tab (tabs are places): it lives here, in My Hunts. */}
        <ButtonLink href="/dashboard/hunts/new" aria-label="Create a hunt" className="rounded-full pl-4">
          <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
          Create
        </ButtonLink>
      </div>

      {!hunts || hunts.length === 0 ? (
        <div className="text-center py-16">
          <Map className="mx-auto mb-3 h-10 w-10 text-themed-muted" aria-hidden="true" />
          <p className="font-[family-name:var(--font-display)] font-semibold text-gray-500 mb-2">No hunts yet</p>
          <p className="font-[family-name:var(--font-handwritten)] text-lg text-gray-400 mb-4">
            Create your first adventure!
          </p>
          <Link
            href="/dashboard/hunts/new"
            className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-themed-border bg-surface px-5 text-base font-semibold text-themed-text hover:bg-themed-bg"
          >
            <PlusCircle className="h-5 w-5" aria-hidden="true" />
            Create Hunt
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {hunts.map((hunt) => (
            <Link
              key={hunt.id}
              href={`/dashboard/hunts/${hunt.id}`}
              className="group flex items-center justify-between rounded-2xl border border-gray-100/80 bg-white p-5 hover:shadow-lg hover:-translate-y-0.5 transition duration-300"
            >
              <div>
                <h3 className="font-[family-name:var(--font-display)] font-semibold text-gray-900 group-hover:text-brand transition-colors">
                  {hunt.title}
                </h3>
                <div className="flex items-center gap-2 mt-1.5 text-xs">
                  <span className={`rounded-full px-2.5 py-0.5 font-medium ${
                    hunt.status === "published"
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-600"
                  }`}>
                    {hunt.status}
                  </span>
                  <span className="text-gray-400">{hunt.target_audience}</span>
                </div>
              </div>
              <span className="text-sm text-gray-400 group-hover:text-brand transition-colors">
                {new Date(hunt.created_at).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
