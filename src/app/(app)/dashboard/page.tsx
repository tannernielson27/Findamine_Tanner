import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { HUNT_CREATOR_ROLES } from "@/components/layout/nav-links";
import { ResumeCard } from "@/components/home/resume-card";
import { WeeklyCard } from "@/components/home/weekly-card";
import { NearYou, NearYouSkeleton } from "@/components/home/near-you";
import { FriendsActivity } from "@/components/home/friends-activity";
import { YourHunts } from "@/components/home/your-hunts";
import { loadCreatorHunts, loadNearHunts } from "@/components/home/home-queries";
import { bandForUser } from "@/lib/utils/age-band";
import type { AgeBand } from "@/lib/themes/tokens";

/**
 * Home: "what should I do next?" (OVERHAUL_PLAN.md §4.2, Main.dc.html).
 * The greeting lives in the top bar (components/layout/top-bar.tsx) so it
 * shares a row with the bell, as in the mockup.
 *
 * Order: resume card → weekly ring → Near you → Friends → (creators) Your hunts.
 * The old shortcut rows are gone: Badges, Teams and Social are in Profile;
 * My Hunts is a tab for creators.
 */
export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const db = await createSupabaseServiceClient();
  const { data: profile } = await db
    .from("users")
    .select("id, role")
    .eq("auth_id", authUser.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!profile) redirect("/login");

  const { data: userProfile } = await db
    .from("user_profiles")
    .select("effective_band")
    .eq("user_id", profile.id)
    .maybeSingle();
  const band = bandForUser(userProfile?.effective_band, profile.role);
  const isCreator = HUNT_CREATOR_ROLES.includes(profile.role);

  return (
    <main className="mx-auto max-w-3xl pb-4">
      <ResumeCard />
      <WeeklyCard />
      <Suspense fallback={<NearYouSkeleton />}>
        <NearYouSection band={band} role={profile.role} />
      </Suspense>
      <FriendsActivity canKudos={profile.role !== "child"} />
      {isCreator && (
        <Suspense fallback={null}>
          <YourHuntsSection userId={profile.id} />
        </Suspense>
      )}
    </main>
  );
}

async function NearYouSection({ band, role }: { band: AgeBand; role: string }) {
  const db = await createSupabaseServiceClient();
  const hunts = await loadNearHunts(db, band, role);
  return <NearYou hunts={hunts} />;
}

async function YourHuntsSection({ userId }: { userId: string }) {
  const db = await createSupabaseServiceClient();
  const { hunts, total } = await loadCreatorHunts(db, userId);
  return <YourHunts hunts={hunts} total={total} />;
}
