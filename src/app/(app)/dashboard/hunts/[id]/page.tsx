"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import FindEditor, { type EditableFind } from "@/components/hunts/find-editor";
import HuntCoverageReport from "@/components/hunts/hunt-coverage-report";
import LocationPicker from "@/components/maps/location-picker";

interface HuntDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_audience: string;
  play_mode: string;
  identity_mode: string;
  estimated_duration_min: number | null;
  center_latitude: number | null;
  center_longitude: number | null;
  search_radius_km: number | null;
  metadata: Record<string, unknown> | null;
  finds: FindItem[];
}

interface FindItem extends EditableFind {
  sort_order: number;
}

interface ApiResult {
  ok: boolean;
  data: Record<string, unknown> | null;
  /** The server's own message when the request failed. */
  error: string;
}

/** Run one API call and always come back with either success or a reason. */
async function api(url: string, init?: RequestInit): Promise<ApiResult> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data, error: "" };
    return { ok: false, data, error: data?.error || `Request failed (error ${res.status})` };
  } catch {
    return { ok: false, data: null, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

type EditorState = { mode: "closed" } | { mode: "add" } | { mode: "edit"; find: FindItem };

export default function HuntDetailPage() {
  const { id } = useParams();
  const router = useRouter();

  const [hunt, setHunt] = useState<HuntDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [loadError, setLoadError] = useState("");
  // Outcome of the last action: every mutation ends in one of these.
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  const applyLoaded = useCallback((result: ApiResult) => {
    if (!result.ok || !result.data?.hunt) {
      setLoadError(result.error || "Hunt not found");
      setLoading(false);
      return;
    }
    const h = result.data.hunt as HuntDetail;
    const finds = [...(h.finds || [])].sort((a, b) => a.sort_order - b.sort_order);
    setHunt({ ...h, finds });
    setLoadError("");
    setLoading(false);
  }, []);

  const fetchHunt = useCallback(
    async () => applyLoaded(await api(`/api/v1/hunts/${id}`)),
    [id, applyLoaded]
  );

  useEffect(() => {
    let cancelled = false;
    api(`/api/v1/hunts/${id}`).then((result) => {
      if (!cancelled) applyLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id, applyLoaded]);

  const succeed = (text: string) => setFeedback({ kind: "success", text });
  const fail = (what: string, reason: string) => setFeedback({ kind: "error", text: `${what}: ${reason}` });

  /** Save hunt-level fields, report the outcome, and reload. */
  const saveHunt = async (changes: Record<string, unknown>, successText: string): Promise<boolean> => {
    if (!hunt) return false;
    setActionLoading(true);
    const result = await api(`/api/v1/hunts/${hunt.id}`, jsonBody("PUT", changes));
    if (result.ok) succeed(successText);
    else fail("Couldn't save", result.error);
    await fetchHunt();
    setActionLoading(false);
    return result.ok;
  };

  const handlePublish = async () => {
    if (!hunt) return;
    const unpublishing = hunt.status !== "draft";
    if (
      unpublishing &&
      !confirm(
        "Unpublish this hunt?\n\nIt goes back to a draft so you can edit it. While it is unpublished nobody can start it, and anyone in the middle of playing may be cut off."
      )
    ) {
      return;
    }
    setActionLoading(true);
    const result = await api(`/api/v1/hunts/${hunt.id}/${unpublishing ? "unpublish" : "publish"}`, { method: "POST" });
    if (result.ok) {
      succeed(unpublishing ? "Hunt unpublished. It is a draft again and can be edited." : "Hunt published. Players can now find and play it.");
    } else {
      fail(unpublishing ? "Couldn't unpublish" : "Couldn't publish", result.error);
    }
    await fetchHunt();
    setActionLoading(false);
  };

  const handleClone = async () => {
    if (!hunt) return;
    setActionLoading(true);
    const result = await api(`/api/v1/hunts/${hunt.id}/clone`, { method: "POST" });
    const copy = result.data?.hunt as { id?: string } | undefined;
    if (result.ok && copy?.id) {
      router.push(`/dashboard/hunts/${copy.id}`);
      return;
    }
    fail("Couldn't clone this hunt", result.error || "the server returned no copy");
    setActionLoading(false);
  };

  const handleDeleteHunt = async () => {
    if (!hunt) return;
    if (!confirm(`Delete "${hunt.title}"?\n\nThe hunt and its stops will be removed from your hunts and players will no longer be able to find it. This cannot be undone here.`)) return;
    setActionLoading(true);
    const result = await api(`/api/v1/hunts/${hunt.id}`, { method: "DELETE" });
    if (result.ok) {
      router.push("/dashboard/hunts");
      return;
    }
    fail("Couldn't delete this hunt", result.error);
    setActionLoading(false);
  };

  const handleSaveDetails = async () => {
    if (!titleDraft.trim()) {
      fail("Couldn't save", "the hunt needs a title");
      return;
    }
    const saved = await saveHunt(
      { title: titleDraft.trim(), description: descriptionDraft.trim() || null },
      "Title and description saved."
    );
    if (saved) setEditingDetails(false);
  };

  const handleDeleteFind = async (findId: string) => {
    if (!confirm("Remove this stop from the hunt?")) return;
    setActionLoading(true);
    const result = await api(`/api/v1/hunts/${id}/finds/${findId}`, { method: "DELETE" });
    if (result.ok) succeed("Stop removed.");
    else fail("Couldn't remove the stop", result.error);
    await fetchHunt();
    setActionLoading(false);
  };

  const handleMoveFind = async (findId: string, direction: "up" | "down") => {
    if (!hunt) return;
    const finds = [...hunt.finds];
    const idx = finds.findIndex((f) => f.id === findId);
    if (idx < 0) return;

    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= finds.length) return;

    [finds[idx], finds[targetIdx]] = [finds[targetIdx], finds[idx]];

    // Renumber the whole list 0..n-1 rather than swapping two sort_order values:
    // stops can share a sort_order (e.g. after a delete + add), and swapping two
    // equal numbers changes nothing.
    setActionLoading(true);
    const results = await Promise.all(
      finds.flatMap((find, position) =>
        find.sort_order === position
          ? []
          : [api(`/api/v1/hunts/${id}/finds/${find.id}`, jsonBody("PUT", { sort_order: position }))]
      )
    );
    const failed = results.find((r) => !r.ok);
    if (failed) fail("Couldn't reorder the stops", failed.error);
    else succeed("Stop order saved.");

    await fetchHunt();
    setActionLoading(false);
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-4">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-gray-200 rounded w-1/4" />
          <div className="h-8 bg-gray-200 rounded w-1/2" />
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      </main>
    );
  }

  if (!hunt) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12 text-center text-gray-500">
        <p role="alert">{loadError || "Hunt not found"}</p>
        <Link href="/dashboard/hunts" className="text-sm text-brand hover:underline mt-3 inline-block">
          &larr; My Hunts
        </Link>
      </main>
    );
  }

  const isDraft = hunt.status === "draft";
  const finds = hunt.finds || [];
  const showEditor = editor.mode !== "closed";
  const unplacedCount = finds.filter((f) => f.metadata?.needs_placement === true).length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <Link href="/dashboard/hunts" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; My Hunts
      </Link>

      {/* Hunt header */}
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-900">{hunt.title}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-xs ${
              hunt.status === "published"
                ? "bg-green-50 text-green-700"
                : "bg-gray-100 text-gray-600"
            }`}>
              {hunt.status.replace(/_/g, " ")}
            </span>
            <span className="text-xs text-gray-500">{hunt.target_audience}</span>
            <span className="text-xs text-gray-500">{hunt.play_mode.replace(/_/g, " ")}</span>
            <span className="text-xs text-gray-500">
              {hunt.identity_mode === "codename_assigned"
                ? "Random codenames"
                : hunt.identity_mode === "codename_chosen"
                ? "Player-chosen names"
                : "Real names"}
            </span>
            {hunt.estimated_duration_min && (
              <span className="text-xs text-gray-500">{hunt.estimated_duration_min} min</span>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handlePublish}
            disabled={actionLoading}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              isDraft
                ? "bg-sky-600 text-white hover:bg-sky-700"
                : "border border-gray-300 text-gray-700 hover:bg-gray-50"
            } disabled:opacity-50`}
          >
            {isDraft ? "Publish" : "Unpublish"}
          </button>
          <button
            onClick={handleClone}
            disabled={actionLoading}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Clone
          </button>
          <Link
            href={`/dashboard/hunts/${hunt.id}/analytics`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Analytics
          </Link>
          <button
            onClick={handleDeleteHunt}
            disabled={actionLoading}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Outcome of the last action */}
      {feedback && (
        <div
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm mb-4 ${
            feedback.kind === "error"
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-green-50 border-green-200 text-green-700"
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="shrink-0 text-xs underline opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Why the editing controls are gone */}
      {!isDraft && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 mb-4">
          <strong>This hunt is {hunt.status.replace(/_/g, " ")}, so its stops and settings are locked.</strong>{" "}
          To add, edit, reorder or remove stops, click <em>Unpublish</em> first, make your changes, then publish again.
          Unpublishing takes the hunt offline: nobody can start it, and anyone in the middle of playing may be cut off.
        </div>
      )}

      {/* Title & description */}
      {editingDetails ? (
        <div className="rounded-lg border border-gray-200 p-3 mb-4 space-y-2">
          <label className="block text-xs text-gray-500" htmlFor="hunt-title">Hunt title</label>
          <input
            id="hunt-title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <label className="block text-xs text-gray-500" htmlFor="hunt-description">Description</label>
          <textarea
            id="hunt-description"
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            rows={3}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSaveDetails}
              disabled={actionLoading}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {actionLoading ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setEditingDetails(false)}
              disabled={actionLoading}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-4">
          {hunt.description && <p className="text-gray-600">{hunt.description}</p>}
          <button
            type="button"
            onClick={() => {
              setTitleDraft(hunt.title);
              setDescriptionDraft(hunt.description || "");
              setEditingDetails(true);
            }}
            className="text-xs text-sky-600 hover:underline mt-1"
          >
            Edit title &amp; description
          </button>
        </div>
      )}

      {/* Hunt settings */}
      {isDraft && (
        <details className="mb-4">
          <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
            Hunt Settings
          </summary>
          <div className="mt-2 rounded-lg border border-gray-200 p-3 space-y-3">
            {/* Anxiety-Sensitive Mode */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!hunt.metadata?.hide_scores}
                disabled={actionLoading}
                onChange={(e) => {
                  const anxietyMode = e.target.checked;
                  const metadata = { ...(hunt.metadata || {}), hide_scores: anxietyMode, hide_leaderboard: anxietyMode, hide_timer: anxietyMode, growth_only_feedback: anxietyMode };
                  saveHunt({ metadata }, `Anxiety-Sensitive Mode turned ${anxietyMode ? "on" : "off"}.`);
                }}
                className="rounded accent-green-600"
              />
              <span className="text-sm text-gray-700">Anxiety-Sensitive Mode</span>
              <span className="text-[11px] text-gray-400">(hides scores, leaderboards, timers)</span>
            </label>

            {/* Scoring Mode */}
            <div>
              <label className="block text-xs text-gray-500 mb-1" htmlFor="scoring-mode">Scoring Mode</label>
              <select
                id="scoring-mode"
                value={(hunt.metadata?.scoring_mode as string) || "standard"}
                disabled={actionLoading}
                onChange={(e) => {
                  const metadata = { ...(hunt.metadata || {}), scoring_mode: e.target.value };
                  saveHunt({ metadata }, "Scoring mode saved.");
                }}
                className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="standard">Standard — balanced scoring with hints and retries</option>
                <option value="binary">Binary — correct (100) or incorrect (0), no partial credit</option>
                <option value="lenient">Lenient — extra growth credit, free hints</option>
                <option value="mastery">Mastery — must score 80%+ to advance</option>
              </select>
            </div>
          </div>
        </details>
      )}

      {/* Hunt center point */}
      {isDraft && (
        <details className="mb-4">
          <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
            Hunt Center Point {hunt.center_latitude != null ? `(${hunt.center_latitude.toFixed(4)}, ${hunt.center_longitude?.toFixed(4)})` : "(not set)"}
          </summary>
          <div className="mt-2 rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500 mb-2">Click the map or search to set where this hunt is centered. This appears as a blue marker on the hunt map.</p>
            <LocationPicker
              latitude={hunt.center_latitude}
              longitude={hunt.center_longitude}
              radiusMeters={((hunt.search_radius_km || 5) * 1000)}
              onLocationChange={(lat, lng) => {
                saveHunt({ center_latitude: lat, center_longitude: lng }, "Hunt center point saved.");
              }}
            />
          </div>
        </details>
      )}

      {/* Finds section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">
            Stops ({finds.length})
          </h2>
          {isDraft && !showEditor && (
            <button
              onClick={() => setEditor({ mode: "add" })}
              className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
            >
              + Add Stop
            </button>
          )}
        </div>

        {isDraft && unplacedCount > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 mb-3">
            {unplacedCount} stop{unplacedCount !== 1 ? "s" : ""} from the AI builder still {unplacedCount !== 1 ? "have" : "has"} a placeholder location near the hunt center.
            Use <em>Edit</em> on each one to move it to its real spot — the hunt can&apos;t be published until you do.
          </div>
        )}

        {finds.length === 0 && !showEditor && (
          <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
            <p className="text-gray-500 mb-3">
              {isDraft
                ? "No stops yet. Add your first stop to start building the hunt."
                : "This hunt has no stops."}
            </p>
            {isDraft && (
              <button
                onClick={() => setEditor({ mode: "add" })}
                className="bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors px-5 py-2 text-sm font-medium"
              >
                Add First Stop
              </button>
            )}
          </div>
        )}

        {finds.length > 0 && (
          <div className="space-y-3">
            {finds.map((find, i) => (
              <div key={find.id} className="flex gap-3 rounded-lg border border-gray-200 bg-white p-4">
                {/* Number badge */}
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-medium text-sky-700">
                  {i + 1}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {find.locations?.name || `Stop ${i + 1}`}
                  </p>
                  {find.clue_text && (
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{find.clue_text}</p>
                  )}
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {find.tasks && (
                      <span className="text-xs bg-sky-50 text-sky-700 rounded px-1.5 py-0.5">
                        {find.tasks.challenge_type.replace(/_/g, " ")}
                      </span>
                    )}
                    {find.primers && (
                      <span className="text-xs bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">
                        has primer
                      </span>
                    )}
                    {find.metadata?.needs_placement === true && (
                      <span className="text-xs bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
                        needs placement
                      </span>
                    )}
                    {find.locations ? (
                      <span className="text-xs text-gray-500">
                        {find.locations.latitude.toFixed(4)}, {find.locations.longitude.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-xs bg-red-50 text-red-700 rounded px-1.5 py-0.5">
                        no location — edit to set one
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {isDraft && (
                  <div className="flex flex-col gap-1 shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => handleMoveFind(find.id, "up")}
                      disabled={i === 0 || actionLoading}
                      className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 text-sm"
                      aria-label={`Move ${find.locations?.name || `stop ${i + 1}`} up`}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveFind(find.id, "down")}
                      disabled={i === finds.length - 1 || actionLoading}
                      className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 text-sm"
                      aria-label={`Move ${find.locations?.name || `stop ${i + 1}`} down`}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFeedback(null);
                        setEditor({ mode: "edit", find });
                      }}
                      disabled={actionLoading || showEditor}
                      className="h-8 px-1 flex items-center justify-center rounded text-xs text-sky-600 hover:bg-sky-50 disabled:opacity-30"
                      aria-label={`Edit ${find.locations?.name || `stop ${i + 1}`}`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFind(find.id)}
                      disabled={actionLoading || showEditor}
                      className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 text-sm"
                      aria-label={`Delete ${find.locations?.name || `stop ${i + 1}`}`}
                    >
                      &times;
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Find editor (inline) */}
        {isDraft && editor.mode !== "closed" && (
          <div className="mt-4">
            <FindEditor
              // Remount per stop so the form always starts from that stop's saved values.
              key={editor.mode === "edit" ? editor.find.id : "new"}
              huntId={hunt.id}
              audience={hunt.target_audience}
              find={editor.mode === "edit" ? editor.find : undefined}
              onSaved={() => {
                succeed(editor.mode === "edit" ? "Stop saved." : "Stop added.");
                setEditor({ mode: "closed" });
                fetchHunt();
              }}
              onCancel={() => setEditor({ mode: "closed" })}
            />
          </div>
        )}
        {/* Coverage report */}
        <HuntCoverageReport huntId={hunt.id} finds={finds} />
      </div>
    </main>
  );
}
