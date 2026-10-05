"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface RosterMember {
  student_id: string;
  added_at: string;
  users: { id: string; display_name: string | null; role: string } | null;
}

interface Roster {
  id: string;
  name: string;
  roster_entries: RosterMember[];
}

/** Read the server's error message off a failed response, with a fallback. */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error || `${fallback} (${res.status})`;
}

async function loadRoster(id: string): Promise<{ roster?: Roster; error?: string }> {
  try {
    const res = await fetch(`/api/v1/roster/${id}`);
    if (res.ok) {
      const data = await res.json();
      return { roster: data.roster };
    }
    if (res.status === 404) return { error: "Roster not found." };
    if (res.status === 403) {
      return { error: "You don't have access to this roster. Rosters can only be opened by the teacher who created them." };
    }
    return { error: await errorFrom(res, "Could not load this roster") };
  } catch {
    return { error: "Could not load this roster. Check your connection and reload." };
  }
}

export default function RosterDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const applyLoaded = useCallback((result: { roster?: Roster; error?: string }) => {
    if (result.roster) setRoster(result.roster);
    setLoadError(result.error || "");
    setLoading(false);
  }, []);

  const fetchRoster = useCallback(
    async () => applyLoaded(await loadRoster(String(id))),
    [id, applyLoaded]
  );

  useEffect(() => {
    let cancelled = false;
    loadRoster(String(id)).then((result) => {
      if (!cancelled) applyLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id, applyLoaded]);

  async function handleAddMember() {
    const email = addEmail.trim();
    if (!email) return;
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/v1/roster/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setAddEmail("");
        setNotice(`Added ${email} to the roster.`);
        await fetchRoster();
      } else {
        setError(await errorFrom(res, "Failed to add student"));
      }
    } catch {
      setError("Failed to add student. Check your connection and try again.");
    }
    setAdding(false);
  }

  async function handleRemoveMember(studentId: string) {
    if (!confirm("Remove this student from the roster?")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(
        `/api/v1/roster/${id}/members?student_id=${encodeURIComponent(studentId)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setNotice("Student removed from the roster.");
      } else {
        setError(await errorFrom(res, "Failed to remove student"));
      }
      await fetchRoster();
    } catch {
      setError("Failed to remove student. Check your connection and try again.");
    }
    setBusy(false);
  }

  async function handleDeleteRoster() {
    if (!confirm("Delete this roster? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/roster/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(await errorFrom(res, "Failed to delete roster"));
        setBusy(false);
        return;
      }
      router.push("/dashboard/rosters");
    } catch {
      setError("Failed to delete roster. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="mx-auto max-w-3xl px-4 py-4"><p className="text-sm text-gray-500">Loading...</p></main>;
  }

  if (!roster) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-4">
        <Link href="/dashboard/rosters" className="text-sm text-brand hover:underline mb-3 inline-block">
          &larr; All Rosters
        </Link>
        <p role="alert" className="text-sm text-gray-500">{loadError || "Roster not found."}</p>
      </main>
    );
  }

  const members = roster.roster_entries || [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-4">
      <Link href="/dashboard/rosters" className="text-sm text-brand hover:underline mb-3 inline-block">
        &larr; All Rosters
      </Link>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-base font-bold text-gray-900">{roster.name}</h1>
          <p className="text-xs text-gray-500">{members.length} student{members.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={handleDeleteRoster}
          disabled={busy}
          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
        >
          Delete Roster
        </button>
      </div>

      {/* Add student */}
      <div className="flex gap-2 mb-1">
        <input
          value={addEmail}
          onChange={(e) => setAddEmail(e.target.value)}
          type="email"
          placeholder="Student email address"
          aria-label="Student email address"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          onKeyDown={(e) => e.key === "Enter" && handleAddMember()}
        />
        <button
          onClick={handleAddMember}
          disabled={adding || !addEmail.trim()}
          className="bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors px-4 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {adding ? "Adding..." : "Add Student"}
        </button>
      </div>
      <p className="text-[11px] text-gray-500 mb-4">
        Use the email the student signed up with. Students who don&apos;t have an account yet can join with the class code instead.
      </p>

      {(error || loadError) && (
        <div role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700 mb-3">{error || loadError}</div>
      )}
      {notice && !error && (
        <div role="status" className="rounded-md bg-green-50 p-2 text-xs text-green-700 mb-3">{notice}</div>
      )}

      {/* Student list */}
      {members.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
          <p className="text-gray-500 text-sm">No students yet. Add students by email above, or share the class code.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.student_id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
              <p className="text-sm text-gray-900">
                {m.users?.display_name || <span className="text-gray-500">Student (no display name yet)</span>}
              </p>
              <button
                onClick={() => handleRemoveMember(m.student_id)}
                disabled={busy}
                className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
