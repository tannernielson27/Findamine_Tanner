"use client";

import { useState } from "react";

const TABLES = [
  { table: "threat_scores", label: "Export Scores" },
  { table: "threat_classifications", label: "Export Labels" },
  { table: "blocked_ips", label: "Export Blocked IPs" },
];

export default function ThreatExportButtons() {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "err"; text: string } | null>(null);

  async function download(table: string, label: string) {
    setBusy(table);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/threat-export?table=${table}`);
      if (res.status === 204) {
        setNotice({ kind: "info", text: `${label}: no rows to export yet.` });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNotice({ kind: "err", text: `${label} failed: ${body.error || `request failed (${res.status})`}` });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${table}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setNotice({ kind: "err", text: `${label} failed: network error.` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {TABLES.map((t) => (
          <button
            key={t.table}
            onClick={() => download(t.table, t.label)}
            disabled={busy !== null}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {busy === t.table ? "Preparing…" : t.label}
          </button>
        ))}
      </div>
      {notice && (
        <p
          role={notice.kind === "err" ? "alert" : "status"}
          className={`mt-2 text-xs ${notice.kind === "err" ? "text-red-600" : "text-gray-500"}`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
