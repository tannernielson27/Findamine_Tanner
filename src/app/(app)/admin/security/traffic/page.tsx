"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface TrafficData {
  overview: {
    total_users: number;
    users_today: number;
    total_sessions: number;
    sessions_today: number;
    completed_sessions: number;
    completion_rate: number;
    total_events: number;
    events_today: number;
    blocked_ips: number;
    login_attempts: number;
    failed_logins: number;
  };
  top_hunts: { id: string; title: string; plays: number }[];
  daily_activity: { date: string; sessions: number; completed: number }[];
  event_types: { type: string; count: number }[];
  platforms: { platform: string; count: number }[];
  recent_events: { id: string; event_type: string; event_name: string; payload: Record<string, unknown>; platform: string; created_at: string }[];
  recent_logins: { success: boolean; ip_hash: string; user_agent: string; created_at: string }[];
  bot_events: { event_type: string; payload: Record<string, unknown>; created_at: string }[];
}

const eventBadge = (type: string) => {
  const colors: Record<string, string> = {
    bot_blocked: "bg-red-100 text-red-800",
    bot_suspicious: "bg-orange-100 text-orange-800",
    login_attempt: "bg-blue-100 text-blue-800",
    find_completion: "bg-green-100 text-green-800",
    hint_request: "bg-yellow-100 text-yellow-800",
    team_message: "bg-purple-100 text-purple-800",
    play_start: "bg-sky-100 text-sky-800",
    play_complete: "bg-emerald-100 text-emerald-800",
  };
  return colors[type] || "bg-gray-100 text-gray-700";
};

export default function TrafficPage() {
  const [data, setData] = useState<TrafficData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/traffic-stats")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        // An error body has no overview/daily_activity; rendering it would crash.
        if (!r.ok) throw new Error(r.status === 403 ? "Admin accounts only." : body.error || `Request failed (${r.status})`);
        setData(body);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-4">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-gray-200 rounded" />
          <div className="grid grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-lg" />)}
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-4">
        <Link href="/admin/security" className="text-sm text-brand hover:underline">&larr; Security</Link>
        <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load traffic data{error ? `: ${error}` : "."}
        </div>
      </main>
    );
  }

  const o = data.overview;
  const maxSessions = Math.max(...data.daily_activity.map((d) => d.sessions), 1);

  return (
    <main className="mx-auto max-w-5xl px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link href="/admin/security" className="text-sm text-brand hover:underline">&larr; Security</Link>
          <h1 className="text-lg font-semibold text-gray-900 mt-1">Traffic &amp; Activity Analysis</h1>
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-6">
        <StatCard label="Total Users" value={o.total_users} sub={`+${o.users_today} today`} />
        <StatCard label="Play Sessions" value={o.total_sessions} sub={`+${o.sessions_today} today`} />
        <StatCard label="Completion Rate" value={`${o.completion_rate}%`} sub={`${o.completed_sessions} completed`} />
        <StatCard label="Events Tracked" value={o.total_events} sub={`+${o.events_today} today`} />
        <StatCard label="Login Attempts" value={o.login_attempts} sub={`${o.failed_logins} failed`} color={o.failed_logins > 10 ? "text-red-600" : undefined} />
        <StatCard label="Blocked IPs" value={o.blocked_ips} color={o.blocked_ips > 0 ? "text-orange-600" : undefined} />
      </div>

      {/* Daily activity chart */}
      {data.daily_activity.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Daily Activity (Last 30 Days)</h2>
          <div className="flex items-end gap-1 h-32">
            {data.daily_activity.map((day) => (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${day.date}: ${day.sessions} sessions, ${day.completed} completed`}>
                <div className="w-full rounded-t relative" style={{ height: `${(day.sessions / maxSessions) * 100}%`, minHeight: "2px" }}>
                  <div className="absolute inset-0 bg-sky-200 rounded-t" />
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-sky-500 rounded-t"
                    style={{ height: day.sessions > 0 ? `${(day.completed / day.sessions) * 100}%` : "0" }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{data.daily_activity[0]?.date}</span>
            <div className="flex gap-3">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-sky-200" /> Started</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-sky-500" /> Completed</span>
            </div>
            <span>{data.daily_activity[data.daily_activity.length - 1]?.date}</span>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {/* Hunt popularity */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Hunt Popularity</h2>
          {data.top_hunts.length === 0 ? (
            <p className="text-sm text-gray-400">No play sessions yet.</p>
          ) : (
            <div className="space-y-2">
              {data.top_hunts.map((h) => (
                <div key={h.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{h.title}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-sky-400 rounded-full"
                        style={{ width: `${(h.plays / (data.top_hunts[0]?.plays || 1)) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{h.plays}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Event type breakdown */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Event Types (7 Days)</h2>
          {data.event_types.length === 0 ? (
            <p className="text-sm text-gray-400">No events tracked yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.event_types.slice(0, 12).map((e) => (
                <div key={e.type} className="flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${eventBadge(e.type)}`}>
                    {e.type.replace(/_/g, " ")}
                  </span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gray-400 rounded-full"
                      style={{ width: `${(e.count / (data.event_types[0]?.count || 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-gray-500 w-8 text-right">{e.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {/* Platform breakdown */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Platform Breakdown (7 Days)</h2>
          {data.platforms.length === 0 ? (
            <p className="text-sm text-gray-400">No platform data yet.</p>
          ) : (
            <div className="space-y-2">
              {data.platforms.map((p) => {
                const total = data.platforms.reduce((s, x) => s + x.count, 0);
                const pct = total > 0 ? Math.round((p.count / total) * 100) : 0;
                return (
                  <div key={p.platform} className="flex items-center gap-3 text-sm">
                    <span className="w-20 text-gray-700 capitalize">{p.platform}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-sky-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bot activity */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Bot Activity</h2>
          {data.bot_events.length === 0 ? (
            <p className="text-sm text-gray-400">No bot activity detected yet. Bots scoring 100% confidence are auto-blocked.</p>
          ) : (
            <div className="space-y-2">
              {data.bot_events.map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${b.event_type === "bot_blocked" ? "bg-red-100 text-red-800" : "bg-orange-100 text-orange-800"}`}>
                    {b.event_type === "bot_blocked" ? "Blocked" : "Suspicious"}
                  </span>
                  <span className="text-gray-500 truncate flex-1">
                    {(b.payload?.reasons as string[])?.join(", ") || "—"}
                  </span>
                  <span className="text-gray-400 shrink-0">{new Date(b.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent logins */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Login Attempts</h2>
        {data.recent_logins.length === 0 ? (
          <p className="text-sm text-gray-400">No login attempts recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">IP Hash</th>
                  <th className="px-3 py-2">User Agent</th>
                  <th className="px-3 py-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.recent_logins.slice(0, 15).map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${l.success ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                        {l.success ? "OK" : "Failed"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-600">{l.ip_hash?.slice(0, 16) || "—"}</td>
                    <td className="px-3 py-1.5 text-gray-500 truncate max-w-[200px]">{l.user_agent?.slice(0, 60) || "—"}</td>
                    <td className="px-3 py-1.5 text-gray-400">{new Date(l.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent events feed */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Events</h2>
        {data.recent_events.length === 0 ? (
          <p className="text-sm text-gray-400">No events recorded yet. Events will appear here as users interact with the app.</p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {data.recent_events.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${eventBadge(e.event_type)}`}>
                  {e.event_type.replace(/_/g, " ")}
                </span>
                <span className="text-gray-500 truncate flex-1">{e.event_name || "—"}</span>
                <span className="text-gray-300 shrink-0">{e.platform || ""}</span>
                <span className="text-gray-400 shrink-0">{new Date(e.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${color || "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
