"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
  created_at: string;
}

interface Viewer {
  id: string;
  role: string;
}

const ROLES = ["child", "teen", "adult", "parent", "teacher", "hunt_creator", "researcher", "admin"];
const PAGE_SIZE = 50;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search.trim()) params.set("q", search.trim());
      try {
        const res = await fetch(`/api/v1/admin/users?${params}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(
            res.status === 403
              ? "Your role can't view user accounts."
              : `Could not load users: ${data.error || `request failed (${res.status})`}`
          );
          setUsers([]);
          setTotal(0);
        } else {
          setLoadError(null);
          setUsers(data.users || []);
          setTotal(typeof data.total === "number" ? data.total : (data.users || []).length);
          setViewer(data.viewer || null);
        }
      } catch {
        if (!cancelled) setLoadError("Could not load users: network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const timer = setTimeout(load, search ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, page]);

  const isAdmin = viewer?.role === "admin";
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);

  async function updateUser(u: UserRow, patch: { role?: string; status?: string }, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusyId(u.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${u.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(`${u.email} was not changed: ${data.error || `request failed (${res.status})`}`);
        return;
      }
      setUsers((prev) => prev.map((row) => (row.id === u.id ? { ...row, ...patch } : row)));
    } catch {
      setActionError(`${u.email} was not changed: network error.`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-4">
      <Link href="/admin" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Admin
      </Link>
      <h1 className="text-lg font-semibold text-gray-900 mb-4">User Management</h1>

      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        placeholder="Search by name or email..."
        aria-label="Search users by name or email"
        className="mb-4 block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
      />

      {actionError && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </div>
      ) : users.length === 0 ? (
        <p className="text-sm text-gray-500">
          {search.trim() ? `No users match "${search.trim()}".` : "No users found."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Joined</th>
                  {isAdmin && <th className="px-4 py-2">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => {
                  const isSelf = viewer?.id === u.id;
                  const status = u.status || "active";
                  const busy = busyId === u.id;
                  return (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">
                        {u.display_name || "—"}
                        {isSelf && <span className="ml-1 text-xs font-normal text-gray-400">(you)</span>}
                      </td>
                      <td className="px-4 py-2 text-gray-600">{u.email}</td>
                      <td className="px-4 py-2">
                        {isAdmin && !isSelf ? (
                          <select
                            value={u.role}
                            disabled={busy}
                            aria-label={`Role for ${u.email}`}
                            onChange={(e) =>
                              updateUser(
                                u,
                                { role: e.target.value },
                                `Change ${u.email} from ${u.role} to ${e.target.value}?`
                              )
                            }
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-sky-500 focus:outline-none disabled:opacity-50"
                          >
                            {(ROLES.includes(u.role) ? ROLES : [u.role, ...ROLES]).map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{u.role}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <span className={status === "active" ? "text-gray-500" : "font-medium text-amber-700"}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">{new Date(u.created_at).toLocaleDateString()}</td>
                      {isAdmin && (
                        <td className="px-4 py-2">
                          {isSelf ? (
                            <span className="text-xs text-gray-400" title="Another admin must change your own account">
                              —
                            </span>
                          ) : status === "active" ? (
                            <button
                              onClick={() =>
                                updateUser(u, { status: "inactive" }, `Deactivate ${u.email}? Their status becomes "inactive".`)
                              }
                              disabled={busy}
                              className="rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                updateUser(u, { status: "active" }, `Set ${u.email} (currently ${status}) back to active?`)
                              }
                              disabled={busy}
                              className="rounded-md border border-green-300 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
                            >
                              Activate
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>
              Showing {firstShown}–{lastShown} of {total} user{total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-md border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {page} of {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount}
                className="rounded-md border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
