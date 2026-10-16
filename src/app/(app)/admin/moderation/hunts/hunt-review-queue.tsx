"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type QueueStatus = "pending" | "approved" | "rejected";

interface QueuedStop {
  sort_order: number;
  clue_text: string | null;
  hints: string[];
  task: {
    title: string | null;
    description: string | null;
    challenge_type: string | null;
    content: string[];
    feedback: string[];
  } | null;
  primer: { title: string | null; content: string[] } | null;
  place: { name: string | null; description: string | null; address: string | null; safety_notes: string | null } | null;
}

interface QueuedHunt {
  id: string;
  title: string;
  description: string | null;
  theme: string | null;
  target_audience: string;
  play_mode: string | null;
  grade_range_min: number | null;
  grade_range_max: number | null;
  theme_narrative: string | null;
  review_reason: string | null;
  review_submitted_at: string | null;
  creator: { display_name: string | null; role: string | null } | null;
  finds: QueuedStop[];
}

/** One labelled block of player-visible text; nothing when empty. */
function ReviewText({ label, lines }: { label: string; lines: (string | null | undefined)[] }) {
  const shown = lines.filter((line): line is string => !!line && !!line.trim());
  if (shown.length === 0) return null;
  return (
    <div className="mt-1">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      {shown.map((line, i) => (
        <p key={i} className="text-sm text-gray-700 break-words whitespace-pre-line">{line}</p>
      ))}
    </div>
  );
}

function StopForReview({ stop, index }: { stop: QueuedStop; index: number }) {
  return (
    <li className="rounded-md border border-gray-100 bg-gray-50 p-3">
      <p className="text-sm font-medium text-gray-900">Stop {index + 1}</p>
      <ReviewText label="Clue" lines={[stop.clue_text || "(no clue text)"]} />
      <ReviewText label="Hints" lines={stop.hints} />
      {stop.task && (
        <ReviewText
          label={`Challenge${stop.task.challenge_type ? ` (${stop.task.challenge_type})` : ""}`}
          lines={[stop.task.title, stop.task.description, ...stop.task.content]}
        />
      )}
      {stop.task && <ReviewText label="Feedback" lines={stop.task.feedback} />}
      {stop.primer && <ReviewText label="Primer" lines={[stop.primer.title, ...stop.primer.content]} />}
      {stop.place && (
        <ReviewText label="Place" lines={[stop.place.name, stop.place.address, stop.place.description]} />
      )}
      {stop.place && <ReviewText label="Safety notes" lines={[stop.place.safety_notes]} />}
    </li>
  );
}

type LoadState = "loading" | "ready" | "forbidden" | "error";

const TABS: { status: QueueStatus; label: string }[] = [
  { status: "pending", label: "Waiting" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
];

/** Admin/researcher queue for publish review (POST /api/v1/hunts/{id}/review). */
export default function HuntReviewQueue() {
  const [tab, setTab] = useState<QueueStatus>("pending");
  const [hunts, setHunts] = useState<QueuedHunt[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Inline fetch so setState runs in callbacks, not synchronously in the effect.
    fetch(`/api/v1/hunts/review-queue?status=${tab}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setState("forbidden");
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || `Could not load hunts (${res.status}).`);
          setState("error");
          return;
        }
        setHunts(data.hunts || []);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load hunts. Check your connection and reload.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const switchTab = (status: QueueStatus) => {
    if (status === tab) return;
    setState("loading");
    setError(null);
    setRejecting(null);
    setTab(status);
  };

  const decide = async (hunt: QueuedHunt, decision: "approve" | "reject") => {
    const huntId = hunt.id;
    if (decision === "reject" && !reason.trim()) {
      setError("Add a short reason for the creator before rejecting.");
      return;
    }
    setBusyId(huntId);
    setError(null);
    try {
      const res = await fetch(`/api/v1/hunts/${huntId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The submission time this reviewer saw: if the hunt was edited since,
        // the server refuses (409) instead of approving content nobody read.
        body: JSON.stringify(
          decision === "reject"
            ? { decision, reason: reason.trim(), review_submitted_at: hunt.review_submitted_at }
            : { decision, review_submitted_at: hunt.review_submitted_at }
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`Hunt was not updated: ${data.error || `request failed (${res.status})`}`);
        if (res.status === 409) {
          // Changed or already decided elsewhere: drop the stale copy; reload shows the latest.
          setHunts((prev) => prev.filter((h) => h.id !== huntId));
        }
        return;
      }
      // Only drop the row once the server confirms the decision.
      setHunts((prev) => prev.filter((h) => h.id !== huntId));
      setRejecting(null);
      setReason("");
    } catch {
      setError("Hunt was not updated: network error.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="Review status" className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.status}
            role="tab"
            aria-selected={tab === t.status}
            onClick={() => switchTab(t.status)}
            className={`min-h-11 rounded-md px-3 text-sm font-medium ${
              tab === t.status ? "bg-sky-600 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {state === "loading" ? (
        <div className="fm-shimmer space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-lg" />)}
        </div>
      ) : state === "forbidden" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Only admins and researchers can review hunts.
        </div>
      ) : state === "error" ? null : hunts.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-12 text-center text-gray-500">
          {tab === "pending" ? "No hunts waiting for review." : "Nothing here yet."}
        </div>
      ) : (
        <ul className="space-y-3">
          {hunts.map((h) => (
            <li key={h.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 break-words">{h.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    by {h.creator?.display_name || "unknown"} ({h.creator?.role || "?"}) · {h.target_audience}
                    {h.play_mode && <> · {h.play_mode}</>}
                    {(h.grade_range_min != null || h.grade_range_max != null) && (
                      <> · grades {h.grade_range_min ?? "?"}–{h.grade_range_max ?? "?"}</>
                    )}
                    {h.review_submitted_at && <> · submitted {new Date(h.review_submitted_at).toLocaleString()}</>}
                  </p>
                  {h.description && <p className="text-sm text-gray-700 mt-2 break-words">{h.description}</p>}
                  {h.theme && <p className="text-sm text-gray-600 mt-1 break-words">Theme: {h.theme}</p>}
                  {h.theme_narrative && (
                    <p className="text-sm text-gray-600 mt-1 break-words italic">{h.theme_narrative}</p>
                  )}
                  {h.finds.length > 0 && (
                    <ol className="mt-3 space-y-2">
                      {h.finds.map((f, i) => (
                        <StopForReview key={i} stop={f} index={i} />
                      ))}
                    </ol>
                  )}
                  {h.review_reason && tab !== "pending" && (
                    <p className="text-xs text-gray-500 mt-2 break-words">Reviewer note: {h.review_reason}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={`/browse/${h.id}`}
                    className="inline-flex min-h-11 items-center rounded-md border border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Open full hunt
                  </Link>
                  {tab === "pending" && (
                    <button
                      onClick={() => decide(h, "approve")}
                      disabled={busyId === h.id}
                      className="min-h-11 rounded-md bg-green-600 px-3 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  {tab !== "rejected" && (
                    <button
                      onClick={() => {
                        setRejecting(rejecting === h.id ? null : h.id);
                        setReason("");
                      }}
                      disabled={busyId === h.id}
                      className="min-h-11 rounded-md bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {tab === "approved" ? "Take down" : "Reject"}
                    </button>
                  )}
                </div>
              </div>
              {rejecting === h.id && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <label htmlFor={`reason-${h.id}`} className="block text-xs text-gray-600 mb-1">
                    Reason (sent to the creator)
                  </label>
                  <textarea
                    id={`reason-${h.id}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, 1000))}
                    rows={2}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-base"
                  />
                  <button
                    onClick={() => decide(h, "reject")}
                    disabled={busyId === h.id || !reason.trim()}
                    className="mt-2 min-h-11 rounded-md bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Confirm {tab === "approved" ? "take down" : "rejection"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
