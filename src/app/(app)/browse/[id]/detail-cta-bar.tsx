import { LogIn, Navigation2, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

interface DetailCtaBarProps {
  huntId: string;
  status: string;
  playable: boolean;
  teamHunt: boolean;
  /** Signed-out visitors may browse; playing needs an account. */
  signedIn: boolean;
}

/**
 * Sticky bottom bar: the screen's one primary action, in the thumb zone.
 *
 * No Save button: there is no saved-hunts feature to back it yet.
 * Team hunts start from the team panel (it knows whether the player is on a
 * team), so the bar scrolls to it instead of offering a second Start.
 */
export function DetailCtaBar({ huntId, status, playable, teamHunt, signedIn }: DetailCtaBarProps) {
  return (
    <div className="fm-glass fixed inset-x-0 bottom-0 z-40 border-t border-themed-border px-4 pt-3.5 pb-[calc(14px+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-3xl gap-3">
        {!playable ? (
          <p className="flex min-h-14 flex-1 items-center justify-center rounded-2xl bg-divider px-4 text-center text-base text-themed-text">
            {status === "draft"
              ? "This hunt is still a draft. Publish it before anyone can play."
              : "This hunt has ended and can no longer be played."}
          </p>
        ) : !signedIn ? (
          <ButtonLink href={`/login?next=${encodeURIComponent(`/browse/${huntId}`)}`} variant="primary" size="lg" block>
            <LogIn className="h-5 w-5" aria-hidden="true" />
            Sign in to play
          </ButtonLink>
        ) : teamHunt ? (
          <ButtonLink href="#team" variant="ink" size="lg" block>
            <Users className="h-5 w-5" aria-hidden="true" />
            Start with your team
          </ButtonLink>
        ) : (
          <ButtonLink href={`/play/${huntId}`} variant="primary" size="lg" block>
            <Navigation2 className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
            Start hunt
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
