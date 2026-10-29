import { Eye, LogIn, Navigation2, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { detailCta } from "./cta-state";

interface DetailCtaBarProps {
  huntId: string;
  status: string;
  playable: boolean;
  teamHunt: boolean;
  /** Signed-out visitors may browse; playing needs an account. */
  signedIn: boolean;
  /** The viewer runs this team hunt and isn't on a team (see cta-state). */
  ownerPreview: boolean;
}

/**
 * Sticky bar: the screen's one primary action, in the thumb zone.
 *
 * No Save button: there is no saved-hunts feature to back it yet.
 * Team hunts start from the team panel (it knows whether the player is on a
 * team), so the bar scrolls to it instead of offering a second Start. A hunt
 * manager who isn't on a team gets Preview here, matching the panel.
 */
export function DetailCtaBar({ huntId, status, playable, teamHunt, signedIn, ownerPreview }: DetailCtaBarProps) {
  const loginHref = `/login?next=${encodeURIComponent(`/browse/${huntId}`)}`;
  const playHref = `/play/${huntId}`;
  const closedNote =
    status === "draft"
      ? "This hunt is still a draft. Publish it before anyone can play."
      : "This hunt has ended and can no longer be played.";
  const cta = detailCta({ playable, signedIn, teamHunt, ownerPreview });

  return (
    <div className="fm-glass fixed inset-x-0 bottom-0 z-40 border-t border-themed-border pt-3.5 pb-[calc(14px+env(safe-area-inset-bottom))]">
      {/* Same box as the content sheet above (max-w-3xl, px-5), so the
          button lines up with the cards at every width. */}
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5">
        {cta === "sign_in_closed" ? (
          // Signed-out visitors always get a way in, even on a closed hunt
          // (the top bar is hidden on this page).
          <>
            <p className="text-center text-base text-themed-muted">{closedNote}</p>
            <ButtonLink href={loginHref} variant="primary" size="lg" block>
              <LogIn className="h-5 w-5" aria-hidden="true" />
              Sign in
            </ButtonLink>
          </>
        ) : cta === "closed" ? (
          <p className="flex min-h-14 items-center justify-center rounded-2xl bg-divider px-4 text-center text-base text-themed-text">
            {closedNote}
          </p>
        ) : cta === "sign_in" ? (
          <ButtonLink href={loginHref} variant="primary" size="lg" block>
            <LogIn className="h-5 w-5" aria-hidden="true" />
            Sign in to play
          </ButtonLink>
        ) : cta === "preview" ? (
          <ButtonLink href={playHref} variant="primary" size="lg" block>
            <Eye className="h-5 w-5" aria-hidden="true" />
            Preview hunt
          </ButtonLink>
        ) : cta === "team" ? (
          <ButtonLink href="#team" variant="ink" size="lg" block>
            <Users className="h-5 w-5" aria-hidden="true" />
            Start with your team
          </ButtonLink>
        ) : (
          <ButtonLink href={playHref} variant="primary" size="lg" block>
            <Navigation2 className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
            Start hunt
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
