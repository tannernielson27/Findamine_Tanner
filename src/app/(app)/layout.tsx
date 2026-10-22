import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/services/auth-emails";
import TopBar from "@/components/layout/top-bar";
import AppChrome from "@/components/layout/app-chrome";
import Onboarding from "@/components/layout/onboarding";
import ConsentGate from "@/components/layout/consent-gate";
import PrivacyFirstChoiceGate from "@/components/layout/privacy-first-choice-gate";
import { AgeBandProvider } from "@/lib/themes/age-band-provider";
import { enrollParticipant } from "@/lib/services/enrollment";
import type { AgeBand } from "@/lib/themes/tokens";
import { bandForUser } from "@/lib/utils/age-band";
import { researchEligibility } from "@/lib/utils/research-eligibility";
import { applyNonParticipantDefaults } from "@/lib/services/non-participant-defaults";

/** Set by src/proxy.ts: the path + query being requested. */
const REQUEST_PATH_HEADER = "x-findamine-path";

/** The only part of this route group that signed-out visitors may see. */
function isPublicAppPath(path: string): boolean {
  return path === "/browse" || path.startsWith("/browse/") || path.startsWith("/browse?");
}

function loginUrl(path: string): string {
  const next = safeNextPath(path, "");
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  const requestPath = (await headers()).get(REQUEST_PATH_HEADER) ?? "";
  const isPublic = isPublicAppPath(requestPath);

  // Backstop for the route guard in src/proxy.ts: nothing in this group except
  // the public catalogue renders for a signed-out visitor.
  if (!authUser && !isPublic) {
    redirect(loginUrl(requestPath));
  }

  let profile = null;
  let ageBand: AgeBand = "intermediate";
  let privacyFriction: "low" | "high" | null = null;
  // Adults only (owner decision 2026-10-15): one shared rule decides who sees
  // the consent gate, may consent, and may be randomized.
  let researchEligible = false;
  let needsDateOfBirth = false;

  if (authUser) {
    const serviceClient = await createSupabaseServiceClient();
    const { data } = await serviceClient
      .from("users")
      .select("id, display_name, role, avatar_url, metadata, date_of_birth, profile_visibility")
      .eq("auth_id", authUser.id)
      .is("deleted_at", null)
      .maybeSingle();
    // DOB and the visibility map stay on the server: only the fields the
    // navbar needs are passed on to client components.
    const storedVisibility = data?.profile_visibility;
    profile = data
      ? {
          id: data.id,
          display_name: data.display_name,
          role: data.role,
          avatar_url: data.avatar_url,
          metadata: data.metadata,
        }
      : null;
    // Invitable adults see the consent gate; those with no date of birth on
    // file (parent / teacher / hunt_creator) are asked for it there before
    // they can join. Enrollment itself requires an 18+ DOB.
    const eligibility = data
      ? researchEligibility({ role: data.role, date_of_birth: data.date_of_birth })
      : null;
    researchEligible = eligibility?.eligible ?? false;
    needsDateOfBirth = eligibility?.eligible === true && eligibility.ageBasis === "needs_date_of_birth";

    // A session without a (live) profile row cannot use the app. /login tells
    // the person what happened instead of rendering empty pages.
    if (!profile && !isPublic) {
      redirect(loginUrl(requestPath));
    }

    // Auto-enroll into the active study (idempotent; never throws). This is the
    // canonical enrollment trigger — runs once the user is real and authenticated.
    // Ineligible users are never randomized (enrollment re-checks this too).
    if (profile && researchEligible) {
      const enrollment = await enrollParticipant(profile.id);
      const meta = (profile.metadata || {}) as Record<string, unknown>;
      const assigned = enrollment.frictionCondition ?? meta.privacy_friction;
      privacyFriction = assigned === "low" || assigned === "high" ? assigned : null;
    }

    // Get age band
    if (profile) {
      const { data: userProfile } = await serviceClient
        .from("user_profiles")
        .select("effective_band")
        .eq("user_id", profile.id)
        .maybeSingle();
      ageBand = bandForUser(userProfile?.effective_band, profile.role);

      // Anyone outside the study starts private-leaning instead of with an
      // empty map (which is enforced as "everyone"). Skips enrolled users.
      await applyNonParticipantDefaults(
        profile.id,
        ageBand,
        storedVisibility as Record<string, unknown> | null | undefined
      );
    }
  }

  return (
    <AgeBandProvider initialBand={ageBand}>
      {/* Top bar: logo/greeting, bell, and the Privacy shield, which follows
          the same privacy_friction rule the old navbar link did. */}
      <TopBar user={profile ? { ...profile, privacy_friction: privacyFriction } : null} />
      {profile && <Onboarding role={profile.role} />}
      {/* Research-consent gate: adults only. Children, teens, under-18s by date
          of birth, and staff never see it (researchEligibility). */}
      {profile && researchEligible && <ConsentGate needsDateOfBirth={needsDateOfBirth} />}
      {/* Neutral-default participants must make an explicit first privacy choice. */}
      {profile && researchEligible && <PrivacyFirstChoiceGate />}
      {/* Tab bar, active-hunt mini-bar, and the bottom padding they need. */}
      <AppChrome user={profile ? { role: profile.role } : null}>{children}</AppChrome>
    </AgeBandProvider>
  );
}
