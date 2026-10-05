"use client";

import { useState } from "react";

type WithdrawOutcome = "withdrawn" | "already_withdrawn" | "not_enrolled";

/**
 * Lets a participant withdraw from the research study (consent promise), and
 * says exactly what withdrawing does: study data collection stops AND the
 * participant's crew links are removed (POST /api/v1/research/withdraw).
 *
 * Debrief-local successor to components/research/withdraw-button.tsx, which
 * told participants they could "keep playing normally" while the route removed
 * their crew, and stayed disabled after a network error.
 */
export default function WithdrawControl() {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [outcome, setOutcome] = useState<WithdrawOutcome | null>(null);

  async function withdraw() {
    setWorking(true);
    setFailed(false);
    try {
      const res = await fetch("/api/v1/research/withdraw", { method: "POST" });
      if (!res.ok) throw new Error("Withdraw failed");
      const data = (await res.json().catch(() => ({}))) as { status?: WithdrawOutcome };
      setOutcome(data.status ?? "withdrawn");
      setConfirming(false);
    } catch {
      setFailed(true); // includes a network failure — the button comes back
    } finally {
      setWorking(false);
    }
  }

  if (outcome === "not_enrolled") {
    return (
      <p className="text-sm text-gray-700">
        You aren&apos;t enrolled in the study, so there was nothing to withdraw from. Nothing
        about your account has changed.
      </p>
    );
  }

  if (outcome) {
    return (
      <p className="text-sm text-green-700">
        {outcome === "already_withdrawn"
          ? "You had already withdrawn from the study. Your study data is not being collected."
          : "You've been withdrawn from the study. Your study data will no longer be collected or included in analysis, and your crew links have been removed. You can keep using Findamine."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="inline-flex min-h-11 items-center text-sm font-medium text-red-600 hover:underline"
        >
          Withdraw from the study
        </button>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-gray-700 mb-2">
            Withdraw from the research study? Your study data won&apos;t be collected or analyzed
            after this. Withdrawing also removes your crew links: the people you recruited leave
            your crew and you leave your recruiter&apos;s, so crew points stop in both
            directions. You can keep playing Findamine.
          </p>
          <div className="flex gap-2">
            <button
              onClick={withdraw}
              disabled={working}
              className="min-h-11 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {working ? "Withdrawing..." : "Yes, withdraw"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={working}
              className="min-h-11 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {failed && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              Something went wrong and you have not been withdrawn. Please try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
