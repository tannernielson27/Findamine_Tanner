"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Report {
  id: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  reporter: { display_name: string | null } | null;
}

/** Outcomes the review API accepts (moderation_reports.status CHECK). */
type ReviewStatus = "actioned" | "dismissed";

type LoadState = "loading" | "ready" | "forbidden" | "error";

export default function ModerationPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/moderation?status=pending")
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          setState("forbidden");
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || `Could not load reports (${res.status}).`);
          setState("error");
          return;
        }
        setReports(data.reports || []);
        setState("ready");
      })
      .catch(() => {
        setError("Could not load reports. Check your connection and reload.");
        setState("error");
      });
  }, []);

  const handleReview = async (reportId: string, status: ReviewStatus) => {
    setBusyId(reportId);
    setError(null);
    try {
      const res = await fetch(`/api/v1/moderation/${reportId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`Report was not updated: ${data.error || `request failed (${res.status})`}`);
        return;
      }
      // Only drop the row once the server confirms the new status.
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch {
      setError("Report was not updated: network error.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <Link href="/admin" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Admin
      </Link>
      <h1 className="text-lg font-semibold text-gray-900 mb-4">Moderation Queue</h1>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {state === "loading" ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-lg" />)}
        </div>
      ) : state === "forbidden" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Your role can&apos;t view the moderation queue. Reports are reviewed by admins, teachers, and
          hunt creators — ask an admin to review any pending reports.
        </div>
      ) : state === "error" ? null : reports.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-12 text-center text-gray-500">
          No pending reports. All clear.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {r.entity_type} report · {r.reason.replace(/_/g, " ")}
                  </p>
                  {r.details && <p className="text-sm text-gray-600 mt-1 break-words">{r.details}</p>}
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(r.created_at).toLocaleString()}
                    {r.reporter?.display_name && <> · reported by {r.reporter.display_name}</>}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5 font-mono break-all">{r.entity_id}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleReview(r.id, "actioned")}
                    disabled={busyId === r.id}
                    title="The report was valid and has been dealt with"
                    className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Mark actioned
                  </button>
                  <button
                    onClick={() => handleReview(r.id, "dismissed")}
                    disabled={busyId === r.id}
                    title="No action needed"
                    className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
