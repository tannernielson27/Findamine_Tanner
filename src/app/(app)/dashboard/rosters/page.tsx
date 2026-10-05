"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Roster {
  id: string;
  name: string;
  created_at: string;
  join_code?: string | null;
  roster_entries: { student_id: string }[];
}

const ROLE_MESSAGE =
  "Class rosters are only available to teacher accounts. Your account has a different role, so you can't create or view rosters here — ask an administrator to give you teacher access.";

interface RosterResult<T> {
  data?: T;
  error?: string;
  /** The account's role can't use rosters at all (the API answered 403). */
  notAllowed?: boolean;
}

/** Turn a failed roster API response into a message the user can act on. */
async function describeFailure(res: Response, action: string): Promise<RosterResult<never>> {
  if (res.status === 401) return { error: "You're signed out. Sign in again to manage rosters." };
  if (res.status === 403) return { error: ROLE_MESSAGE, notAllowed: true };
  const data = await res.json().catch(() => null);
  return {
    error: data?.error ? `Couldn't ${action}: ${data.error}` : `Couldn't ${action} (error ${res.status}).`,
  };
}

async function fetchRosterList(): Promise<RosterResult<Roster[]>> {
  try {
    const res = await fetch("/api/v1/roster");
    if (!res.ok) return describeFailure(res, "load your rosters");
    const data = await res.json();
    return { data: data.rosters || [] };
  } catch {
    return { error: "Couldn't load your rosters. Check your connection and reload." };
  }
}

export default function RostersPage() {
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Set when the account's role can't use rosters at all (the API answers 403).
  const [notAllowed, setNotAllowed] = useState(false);

  function applyResult(result: RosterResult<Roster[]>) {
    if (result.notAllowed) setNotAllowed(true);
    if (result.error) setError(result.error);
    else if (result.data) setRosters(result.data);
  }

  useEffect(() => {
    // setState only runs in the promise callback, never synchronously in the effect.
    fetchRosterList().then((result) => {
      if (result.notAllowed) setNotAllowed(true);
      if (result.error) setError(result.error);
      else if (result.data) setRosters(result.data);
      setLoading(false);
    });
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/v1/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        setNewName("");
        applyResult(await fetchRosterList());
      } else {
        applyResult(await describeFailure(res, "create the roster"));
      }
    } catch {
      setError("Couldn't create the roster. Check your connection and try again.");
    }
    setCreating(false);
  }

  async function generateCode(rosterId: string, rotate = false) {
    if (rotate && !confirm("Generate a new class code? The old code will stop working.")) return;
    setBusyCode(rosterId);
    setError("");
    try {
      const res = await fetch("/api/v1/roster/join-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster_id: rosterId, rotate }),
      });
      if (res.ok) {
        const data = await res.json();
        setRosters((prev) =>
          prev.map((r) => (r.id === rosterId ? { ...r, join_code: data.join_code } : r))
        );
      } else {
        applyResult(await describeFailure(res, "generate a class code"));
      }
    } catch {
      setError("Couldn't generate a class code. Check your connection and try again.");
    }
    setBusyCode(null);
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard may be unavailable; the code is still visible to read aloud */
    }
  }

  if (loading) {
    return <main className="mx-auto max-w-3xl px-4 py-4"><p className="text-sm text-gray-500">Loading rosters...</p></main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-4">
      <h1 className="text-base font-semibold text-gray-900 mb-3">Class Rosters</h1>
      <p className="text-xs text-gray-500 mb-4">
        Share a class code so students join themselves — no need to add them one at a time. Rosters
        also power teams and class-level visibility.
      </p>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 border border-red-200 p-2.5 text-sm text-red-700 mb-3">
          {error}
        </div>
      )}

      {/* Create new roster */}
      <div className="flex gap-2 mb-4">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New roster name (e.g. Period 3 Science)"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <button
          onClick={handleCreate}
          disabled={creating || notAllowed || !newName.trim()}
          className="bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors px-4 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create Roster"}
        </button>
      </div>

      {/* Roster list */}
      {notAllowed ? null : rosters.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
          <p className="text-gray-500 text-sm">No rosters yet. Create one above to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rosters.map((roster) => {
            const count = roster.roster_entries?.length || 0;
            return (
              <div
                key={roster.id}
                className="rounded-lg border border-gray-200 bg-white p-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{roster.name}</p>
                    <p className="text-xs text-gray-500">
                      {count} student{count !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/rosters/${roster.id}`}
                    className="text-xs text-brand hover:underline"
                  >
                    View →
                  </Link>
                </div>

                {/* Class join code */}
                <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-400">Class code</span>
                  {roster.join_code ? (
                    <>
                      <code className="rounded bg-gray-100 px-2 py-0.5 text-sm font-mono font-semibold tracking-widest text-gray-800">
                        {roster.join_code}
                      </code>
                      <button
                        onClick={() => copyCode(roster.join_code!)}
                        className="text-xs text-brand hover:underline"
                      >
                        {copied === roster.join_code ? "Copied!" : "Copy"}
                      </button>
                      <button
                        onClick={() => generateCode(roster.id, true)}
                        disabled={busyCode === roster.id}
                        className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
                        title="Generate a new code (invalidates the old one)"
                      >
                        {busyCode === roster.id ? "…" : "Reset"}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => generateCode(roster.id)}
                      disabled={busyCode === roster.id}
                      className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                    >
                      {busyCode === roster.id ? "Generating…" : "Generate code"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
