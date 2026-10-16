"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const CONFIRM_WORD = "DELETE";

interface DeleteAccountSectionProps {
  role: string;
}

interface ChildSummary {
  id: string;
  display_name: string | null;
  role: string;
}

/**
 * Permanent, immediate account deletion (App Store guideline 5.1.1(v)).
 * Calls DELETE /api/v1/account, signs out locally, then goes to
 * /account-deleted. A parent is told which child accounts go with theirs.
 */
export default function DeleteAccountSection({ role }: DeleteAccountSectionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [children, setChildren] = useState<ChildSummary[]>([]);

  useEffect(() => {
    if (role !== "parent" || !open) return;
    let cancelled = false;
    fetch("/api/v1/auth/children")
      .then((res) => (res.ok ? res.json() : { children: [] }))
      .then((data: { children?: ChildSummary[] }) => {
        if (cancelled) return;
        setChildren((data.children || []).filter((c) => c.role === "child" || c.role === "teen"));
      })
      .catch(() => {
        // The warning below still says child accounts are included.
      });
    return () => {
      cancelled = true;
    };
  }, [role, open]);

  async function deleteAccount() {
    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/v1/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "We couldn't delete your account. Please try again.");
      }
      // The server already expired the session cookies; clear local state too.
      await createSupabaseBrowserClient()
        .auth.signOut({ scope: "local" })
        .catch(() => {});
      router.replace("/account-deleted");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't delete your account. Please try again.");
      setWorking(false);
    }
  }

  const confirmed = typed.trim() === CONFIRM_WORD;

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="mt-6 rounded-2xl bg-white border border-red-200 shadow-sm p-6"
    >
      <h2
        id="delete-account-heading"
        className="font-[family-name:var(--font-display)] font-semibold text-gray-900 flex items-center gap-2"
      >
        <Trash2 className="w-4 h-4 text-red-600" aria-hidden="true" />
        Delete account
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Permanently delete your Findamine account and the data that belongs to it. This happens right
        away and can&apos;t be undone.
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-4 min-h-11 rounded-xl border border-red-300 px-5 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors"
        >
          Delete my account...
        </button>
      ) : (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
          <div className="text-sm text-gray-700 space-y-2">
            <p className="font-medium text-gray-900">What gets deleted</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Your sign-in, email address, name, birthday and profile picture.</li>
              <li>
                Your hunt history, photos, points, badges, messages, posts, friends, kudos, survey
                answers and settings.
              </li>
              <li>Your team, class and crew memberships.</li>
            </ul>
            <p>
              Hunts and other content you made for other people stay available, shown as made by
              &quot;Deleted user&quot;. If you were in the research study, you are withdrawn; only a
              record that a participant withdrew is kept, with nothing that identifies you.
            </p>
            {role === "parent" && (
              <p className="font-medium text-red-800">
                {children.length > 0
                  ? `The child accounts you created will be deleted too: ${children
                      .map((c) => c.display_name || "Unnamed")
                      .join(", ")}.`
                  : "Any child accounts you created will be deleted too."}
              </p>
            )}
          </div>

          <label htmlFor="delete-confirm" className="block text-sm font-medium text-gray-700">
            Type <strong>{CONFIRM_WORD}</strong> to confirm
          </label>
          <input
            id="delete-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={working}
            className="block w-full min-h-11 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
          />

          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={deleteAccount}
              disabled={!confirmed || working}
              className="min-h-11 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {working ? "Deleting..." : "Permanently delete account"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError("");
              }}
              disabled={working}
              className="min-h-11 rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-white disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
