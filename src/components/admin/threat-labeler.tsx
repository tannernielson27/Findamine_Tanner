"use client";

import { useState, useEffect } from "react";

interface ThreatSession {
  session_id: string;
  /** Null when no IP hash was recorded for the session (not collected on ordinary events). */
  ip_hash: string | null;
  user_agent: string | null;
  event_count: number;
  first_seen: string;
  last_seen: string;
  threat_score: number;
  classification: string;
  top_contributors: { feature: string; contribution: number; direction: string }[];
  features: Record<string, number>;
}

interface ShapContribution {
  feature: string;
  marginal_contribution: number;
}

const ATTACK_TYPES = ["safe", "scanner", "scraper", "credential_stuffing", "injection", "ddos", "other"];

const scoreBadge = (cls: string) => {
  const colors: Record<string, string> = {
    safe: "bg-green-100 text-green-800",
    suspicious: "bg-yellow-100 text-yellow-800",
    likely_threat: "bg-orange-100 text-orange-800",
    threat: "bg-red-100 text-red-800",
  };
  return colors[cls] || "bg-gray-100 text-gray-800";
};

export default function ThreatLabeler() {
  const [sessions, setSessions] = useState<ThreatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [shap, setShap] = useState<ShapContribution[] | null>(null);
  const [labeled, setLabeled] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unattributed, setUnattributed] = useState(0);

  useEffect(() => {
    fetch("/api/v1/admin/threat-sessions")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
        setSessions(d.sessions || []);
        setUnattributed(typeof d.events_without_session === "number" ? d.events_without_session : 0);
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function post(url: string, body: unknown): Promise<string | null> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return data.error || `request failed (${res.status})`;
    } catch {
      return "network error";
    }
  }

  async function toggleExpand(sid: string) {
    if (expanded === sid) {
      setExpanded(null);
      setShap(null);
      return;
    }
    setExpanded(sid);
    setShap(null);
    try {
      const res = await fetch(`/api/v1/admin/shap-explain?session_id=${encodeURIComponent(sid)}`);
      const data = await res.json().catch(() => ({}));
      setShap(res.ok ? data.contributions || [] : []);
    } catch {
      setShap([]);
    }
  }

  async function labelSession(sessionId: string, ipHash: string | null, attackType: string) {
    setActionError(null);
    const err = await post("/api/v1/admin/label-threat", {
      session_id: sessionId,
      ip_hash: ipHash,
      attack_type: attackType,
    });
    if (err) {
      setActionError(`Label was not saved: ${err}`);
      return;
    }
    setLabeled((prev) => new Set([...prev, sessionId]));
  }

  async function blockIp(ipHash: string) {
    setActionError(null);
    const err = await post("/api/v1/admin/block-ip", {
      ip_hash: ipHash,
      reason: "Manual block from threat labeler",
      expires_in_days: 30,
    });
    if (err) {
      setActionError(`IP was not blocked: ${err}`);
      return;
    }
    setLabeled((prev) => new Set([...prev, `block_${ipHash}`]));
  }

  if (loading) {
    return <div className="fm-shimmer space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded" />)}</div>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        Top Threat Sessions ({sessions.length})
      </h3>

      {loadError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load threat sessions: {loadError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {!loadError && sessions.length === 0 && (
        <p className="text-sm text-gray-500">
          No sessions to score yet.
          {unattributed > 0 &&
            ` ${unattributed} recent event${unattributed === 1 ? " has" : "s have"} no session id or IP hash and cannot be grouped.`}
        </p>
      )}

      {sessions.map((s) => (
        <div key={s.session_id} className="rounded-lg border border-gray-200 bg-white">
          {/* Header row */}
          <button
            onClick={() => toggleExpand(s.session_id)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${scoreBadge(s.classification)}`}>
                {s.threat_score}
              </span>
              <span className="text-sm text-gray-600 truncate font-mono">
                {(s.ip_hash || s.session_id).slice(0, 16)}...
              </span>
              <span className="text-xs text-gray-400">
                {s.event_count} events
              </span>
            </div>
            <span className="text-xs text-gray-400 shrink-0">
              {new Date(s.last_seen).toLocaleDateString()}
            </span>
          </button>

          {/* Expanded details */}
          {expanded === s.session_id && (
            <div className="border-t border-gray-100 px-4 py-3 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                <div><span className="font-medium">Session:</span> {s.session_id}</div>
                <div><span className="font-medium">IP hash:</span> {s.ip_hash || "not collected"}</div>
                <div><span className="font-medium">UA:</span> {s.user_agent?.slice(0, 60) || "not collected"}</div>
                <div><span className="font-medium">First:</span> {new Date(s.first_seen).toLocaleString()}</div>
                <div><span className="font-medium">Last:</span> {new Date(s.last_seen).toLocaleString()}</div>
              </div>

              {/* SHAP contributions */}
              {shap && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-600 mb-2">Feature Contributions (SHAP)</h4>
                  <div className="space-y-1">
                    {shap
                      .sort((a, b) => Math.abs(b.marginal_contribution) - Math.abs(a.marginal_contribution))
                      .slice(0, 8)
                      .map((c) => (
                        <div key={c.feature} className="flex items-center gap-2 text-xs">
                          <span className="w-40 truncate text-gray-600">{c.feature.replace(/_/g, " ")}</span>
                          <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden relative">
                            <div
                              className={`h-full rounded-full ${c.marginal_contribution > 0 ? "bg-red-400" : "bg-blue-400"}`}
                              style={{
                                width: `${Math.min(Math.abs(c.marginal_contribution) * 2, 100)}%`,
                                marginLeft: c.marginal_contribution < 0 ? "auto" : undefined,
                              }}
                            />
                          </div>
                          <span className={`w-10 text-right ${c.marginal_contribution > 0 ? "text-red-600" : "text-blue-600"}`}>
                            {c.marginal_contribution > 0 ? "+" : ""}{c.marginal_contribution.toFixed(1)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Label buttons */}
              <div className="flex flex-wrap gap-1.5">
                {ATTACK_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => labelSession(s.session_id, s.ip_hash, type)}
                    disabled={labeled.has(s.session_id)}
                    className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                      labeled.has(s.session_id)
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : type === "safe"
                        ? "bg-green-50 text-green-700 hover:bg-green-100"
                        : "bg-red-50 text-red-700 hover:bg-red-100"
                    }`}
                  >
                    {type.replace(/_/g, " ")}
                  </button>
                ))}
                <button
                  onClick={() => s.ip_hash && blockIp(s.ip_hash)}
                  disabled={!s.ip_hash || labeled.has(`block_${s.ip_hash}`)}
                  title={s.ip_hash ? undefined : "No IP hash was recorded for this session"}
                  className="rounded px-2 py-1 text-xs font-medium bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50"
                >
                  {s.ip_hash ? "Block IP (30d)" : "Block IP (no IP recorded)"}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
