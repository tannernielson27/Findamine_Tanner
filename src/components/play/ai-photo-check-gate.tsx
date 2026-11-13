"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

type GateState = "loading" | "ask" | "open";

const ENDPOINT = "/api/v1/account/ai-photo-check";

/**
 * Asks once, before the first stop photo, whether the player allows an AI
 * service to check their photos for the stop's landmark (privacy rule R1,
 * Apple guideline 5.1.2(i)). Renders its children straight away when there is
 * nothing to ask: feature off, child/teen account, or already answered.
 * Either answer lets the player carry on; "No thanks" only means a person may
 * review the photo instead.
 */
export function AiPhotoCheckGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(ENDPOINT)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (live) setState(data?.ask === true ? "ask" : "open");
      })
      // Can't tell: don't block the photo. Nothing is sent to the AI service
      // without a stored yes, so failing open here is safe.
      .catch(() => live && setState("open"));
    return () => {
      live = false;
    };
  }, []);

  async function choose(allowed: boolean) {
    setSaving(true);
    setProblem(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed }),
      });
      if (!res.ok) throw new Error("save failed");
      setState("open");
    } catch {
      setProblem("We couldn't save that. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Until we know there's a question, show the camera as usual: no photo is
  // sent to the AI service without a stored yes, so nothing leaks meanwhile.
  if (state !== "ask") return <>{children}</>;

  return (
    <section aria-labelledby="ai-photo-check-title" className="flex flex-col gap-3 rounded-2xl border border-ink/15 bg-white p-4 text-left">
      <div className="flex items-start gap-3">
        <ScanSearch className="mt-0.5 h-6 w-6 shrink-0 text-link" aria-hidden="true" />
        <div>
          <h3 id="ai-photo-check-title" className="font-semibold text-ink">Check your photos with AI?</h3>
          <p className="mt-1 text-sm text-ink/80">
            We can send your stop photos to an AI service (Anthropic) to confirm the stop&apos;s landmark is
            in them. We shrink each photo and remove its location and other hidden details first, and we
            keep only the result. If you say no, a Findamine admin may look at the photo instead. Either
            way, you keep playing.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Equal weight on purpose: no nudge either way (this app runs a privacy study). */}
        <Button variant="secondary" onClick={() => void choose(true)} disabled={saving} block>
          Allow AI check
        </Button>
        <Button variant="secondary" onClick={() => void choose(false)} disabled={saving} block>
          No thanks
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-error">
          {problem}
        </p>
      )}
    </section>
  );
}
