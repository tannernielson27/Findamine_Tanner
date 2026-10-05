"use client";

import { useState } from "react";

/** Datasets served by GET /api/v1/research/export (see that route). */
const DATASETS = [
  { key: "participants", label: "Participants", desc: "One row per participant" },
  { key: "trajectory", label: "Trajectory", desc: "One row per privacy-index snapshot" },
  { key: "events", label: "Events", desc: "One row per raw privacy event" },
  { key: "storylines", label: "Storylines", desc: "One row per notice / check-in" },
] as const;

const FORMATS = ["csv", "tsv", "json"] as const;
type Format = (typeof FORMATS)[number];

interface ResearchExportButtonsProps {
  studyId: string;
  studyCode: string;
}

interface Notice {
  kind: "ok" | "empty" | "err";
  text: string;
}

export default function ResearchExportButtons({ studyId, studyCode }: ResearchExportButtonsProps) {
  const [format, setFormat] = useState<Format>("csv");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function download(dataset: string, label: string) {
    setBusy(dataset);
    setNotice(null);
    try {
      const params = new URLSearchParams({ study_id: studyId, dataset, format });
      const res = await fetch(`/api/v1/research/export?${params}`);
      if (res.status === 404) {
        setNotice({ kind: "empty", text: `${label}: nothing to export yet — no rows recorded for this study.` });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNotice({ kind: "err", text: `${label} export failed: ${body.error || `request failed (${res.status})`}` });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${studyCode}_${dataset}_${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice({ kind: "ok", text: `${label} downloaded (${format.toUpperCase()}).` });
    } catch {
      setNotice({ kind: "err", text: `${label} export failed: network error.` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
        <label htmlFor="export-format">Format</label>
        <select
          id="export-format"
          value={format}
          onChange={(e) => setFormat(e.target.value as Format)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-sky-500 focus:outline-none"
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>{f.toUpperCase()}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {DATASETS.map((d) => (
          <button
            key={d.key}
            onClick={() => download(d.key, d.label)}
            disabled={busy !== null}
            className="rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-sky-200 disabled:opacity-50 transition-colors"
          >
            <span className="block text-sm font-medium text-gray-900">
              {busy === d.key ? "Preparing…" : `Download ${d.label.toLowerCase()}`}
            </span>
            <span className="block text-[11px] text-gray-500">{d.desc}</span>
          </button>
        ))}
      </div>

      {notice && (
        <p
          role={notice.kind === "err" ? "alert" : "status"}
          className={`mt-3 text-sm ${
            notice.kind === "err" ? "text-red-600" : notice.kind === "empty" ? "text-amber-700" : "text-green-600"
          }`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
