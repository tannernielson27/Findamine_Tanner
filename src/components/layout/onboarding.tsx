"use client";

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import {
  ONBOARDING_MILESTONE,
  stepsForUser,
  onboardingDestination,
  finalCtaLabel,
  clampStep,
} from "@/lib/onboarding/steps";
import { clearTourActive, hasPrivacyTourParam, markTourActive } from "@/lib/onboarding/tour-mode";
import { tabsFor } from "./nav-links";
import { TourCard, TourSpotlight } from "./tour-card";
import { useTourAnchor } from "./use-tour-anchor";

interface OnboardingProps {
  role?: string;
  /** Signed-in user's id. Optional: resolved from the browser session when absent. */
  userId?: string;
}

/** Pre-per-user flag. It outlived logout, so the next person on a shared device got no tour. */
const LEGACY_STORAGE_KEY = "onboarding_complete";
/** Any other open modal (consent gate, first-choice gate, feature dialogs). */
const OTHER_MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]:not([data-onboarding-tour])';
/** Where the tour is, so a reload mid-tour resumes on the same step. Per tab. */
const STEP_STORAGE_KEY = "findamine:tour-step";

function storageKeyFor(userId: string): string {
  return `${LEGACY_STORAGE_KEY}:${userId}`;
}

// localStorage can throw (private mode, blocked site data); the API stays authoritative.
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "true");
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Non-fatal: the tour is re-checked against the API next load.
  }
}

function readSavedStep(): number {
  try {
    return Number(sessionStorage.getItem(STEP_STORAGE_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function saveStep(step: number | null): void {
  try {
    if (step === null) sessionStorage.removeItem(STEP_STORAGE_KEY);
    else sessionStorage.setItem(STEP_STORAGE_KEY, String(step));
  } catch {
    // Non-fatal: a reload restarts the tour from the top.
  }
}

/**
 * "Run welcome tutorial again" (Settings). The server milestone is history and
 * is never deleted; a replay is a per-tab request that overrides it until the
 * tour is finished or skipped again.
 */
const REPLAY_STORAGE_KEY = "onboarding_replay";
const REPLAY_EVENT = "findamine:onboarding-replay";

function replayRequested(): boolean {
  try {
    return sessionStorage.getItem(REPLAY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function clearReplayRequest(): void {
  try {
    sessionStorage.removeItem(REPLAY_STORAGE_KEY);
  } catch {
    // Non-fatal: at worst the tour is offered once more in this tab.
  }
}

/**
 * Re-open the welcome tour for the signed-in user. Opens it immediately when
 * the tour component is mounted (it is, on every signed-in page), and survives
 * a reload until the tour is finished or skipped.
 */
export function restartOnboardingTour(): void {
  try {
    sessionStorage.setItem(REPLAY_STORAGE_KEY, "true");
  } catch {
    // The event below still opens the tour in this page.
  }
  saveStep(0);
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

function subscribeToModals(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

const noopSubscribe = () => () => {};
const isOtherModalOpen = () => document.querySelector(OTHER_MODAL_SELECTOR) !== null;
const noModalOnServer = () => false;

/** Path + query of the current page, compared against a step's route. */
function currentLocation(pathname: string): string {
  return typeof window === "undefined" ? pathname : `${pathname}${window.location.search}`;
}

/**
 * First-login walkthrough: steps through Home, Explore, Ranks / My Hunts,
 * Profile and the privacy settings screen, opening each page and spotlighting
 * the part being described. Shown once per user (server milestone), replayable
 * from Settings.
 */
export default function Onboarding({ role, userId }: OnboardingProps) {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const storageKeyRef = useRef<string | null>(null);

  // The consent / first-choice gates render above the tour. While one of them
  // (or any other modal) is open the tour stands down entirely: not rendered,
  // no key handling — so Escape meant for the gate can't dismiss a tour the
  // user never saw. It comes back once the modal closes. Only observed while
  // the tour is actually pending.
  const blocked = useSyncExternalStore(
    show ? subscribeToModals : noopSubscribe,
    isOtherModalOpen,
    noModalOnServer
  );
  const visible = show && !blocked;

  const steps = stepsForUser(role, tabsFor(role ? { role } : null).map((t) => t.icon));
  const index = clampStep(step, steps.length);
  const current = steps[index];
  const destination = onboardingDestination(role);
  const finalCta = finalCtaLabel(role);
  const { rect, settled } = useTourAnchor(current?.anchor, `${index}:${current?.id}`, visible);

  const open = useCallback((at: number) => {
    markTourActive();
    setStep(at);
    setShow(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        // The flag is keyed by user so a shared device gives each person the tour.
        let id = userId ?? null;
        if (!id) {
          const { data } = await createSupabaseBrowserClient().auth.getSession();
          id = data.session?.user.id ?? null;
        }
        if (cancelled) return;
        const key = id ? storageKeyFor(id) : null;
        storageKeyRef.current = key;

        // An explicit "run the tour again" beats both completion records.
        if (replayRequested()) {
          open(readSavedStep());
          return;
        }

        // localStorage is the fast path; the API is authoritative.
        if (key && readFlag(key)) return;

        const res = await fetch("/api/v1/onboarding");
        if (cancelled || !res.ok) return;
        const data = await res.json();
        const done =
          data.onboarding_complete ||
          (data.milestones || []).some(
            (m: { milestone_type: string }) =>
              m.milestone_type === ONBOARDING_MILESTONE
          );
        if (cancelled) return;
        if (done) {
          if (key) writeFlag(key);
        } else {
          open(readSavedStep());
        }
      } catch {
        // If the session or API lookup fails, don't block the UI with a tutorial.
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [userId, open]);

  // Settings asked for the tour again while this page is open.
  useEffect(() => {
    const reopen = () => open(0);
    window.addEventListener(REPLAY_EVENT, reopen);
    return () => window.removeEventListener(REPLAY_EVENT, reopen);
  }, [open]);

  // Each step opens its page. Waits while a gate is up so the tour never
  // navigates out from under the consent or first-choice dialog.
  useEffect(() => {
    if (!visible || !current?.route) return;
    if (currentLocation(pathname) !== current.route) router.push(current.route);
  }, [visible, current, pathname, router]);

  useEffect(() => {
    if (show) saveStep(index);
  }, [show, index]);

  const end = useCallback(async () => {
    setShow(false);
    clearReplayRequest();
    clearTourActive();
    saveStep(null);
    if (storageKeyRef.current) writeFlag(storageKeyRef.current);
    try {
      await fetch("/api/v1/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestone_type: ONBOARDING_MILESTONE }),
      });
    } catch {
      // The per-user flag is already set — dismissal sticks even if the API call fails.
    }
  }, []);

  // Skip / Escape: dismiss and stay put — unless the tour left the user on the
  // read-only privacy view, which only exists for the tour.
  const handleSkip = useCallback(() => {
    void end();
    if (hasPrivacyTourParam(window.location.search)) router.replace("/dashboard");
  }, [end, router]);

  // Finish: dismiss AND propel the user into their first fun moment.
  const handleFinish = useCallback(() => {
    void end();
    router.push(destination);
  }, [end, router, destination]);

  const handleNext = useCallback(() => {
    if (index < steps.length - 1) setStep(index + 1);
    else handleFinish();
  }, [index, steps.length, handleFinish]);

  // Escape key + focus trap
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleSkip();
        return;
      }
      if (e.key === "Tab" && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, handleSkip]);

  // Focus the primary action on every step.
  useEffect(() => {
    if (!visible || !settled) return;
    const buttons = cardRef.current?.querySelectorAll<HTMLElement>("button");
    buttons?.[index > 0 ? 1 : 0]?.focus();
  }, [visible, settled, index]);

  if (!visible || !current) return null;

  return (
    <div
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-step-title"
      data-onboarding-tour=""
    >
      <TourSpotlight rect={rect} reducedMotion={reducedMotion} />
      {settled && (
        <TourCard
          ref={cardRef}
          step={current}
          index={index}
          total={steps.length}
          finalCta={finalCta}
          rect={rect}
          reducedMotion={reducedMotion}
          onBack={() => setStep(index - 1)}
          onNext={handleNext}
          onSkip={handleSkip}
        />
      )}
    </div>
  );
}
