import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ChevronRight, Map, Plus, PlusCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Tag } from "@/components/ui/chip";
import { cn } from "@/lib/utils/cn";
import { audienceLabel, huntStatusLabel, stopCountLabel, updatedLabel } from "./hunt-list-format";

/** finds(count) comes back as [{ count }]. */
function stopCountOf(finds: unknown): number {
  const count = Array.isArray(finds) ? (finds[0] as { count?: unknown } | undefined)?.count : undefined;
  return typeof count === "number" ? count : 0;
}

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
    .select("id, title, status, target_audience, play_mode, created_at, updated_at, finds(count)")
    .eq("created_by", profile.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  const now = new Date();

  return (
    <main className="mx-auto max-w-3xl px-4 pb-4 pt-6">
      <div className="mb-5 flex items-center justify-between gap-3 px-1">
        <h1 className="m-0 font-[family-name:var(--font-display)] text-[32px] font-semibold leading-[1.1] text-themed-text">
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
        // Same grouped list as Home's "Your hunts" (components/home/your-hunts.tsx).
        <ul className="m-0 list-none overflow-hidden rounded-card border border-themed-border bg-surface p-0">
          {hunts.map((hunt, i) => {
            const status = huntStatusLabel(hunt.status);
            const details = [
              audienceLabel(hunt.target_audience),
              stopCountLabel(stopCountOf(hunt.finds)),
              updatedLabel(hunt.updated_at ?? hunt.created_at, now),
            ].filter(Boolean);
            return (
              <li key={hunt.id} className={cn(i > 0 && "border-t border-divider")}>
                <Link
                  href={`/dashboard/hunts/${hunt.id}`}
                  className="flex min-h-16 items-center gap-3 px-4 py-3 text-themed-text no-underline transition-colors duration-150 hover:bg-themed-bg"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate font-[family-name:var(--font-display)] text-lg font-semibold">{hunt.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-themed-muted">
                      <Tag tone={status.tone}>{status.label}</Tag>
                      {details.join(" · ")}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-themed-muted" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
