"use client";

import { useState } from "react";

interface CoverageData {
  subjects: Record<string, number>;
  challengeTypes: Record<string, number>;
  gradeRange: { min: number; max: number } | null;
  totalStops: number;
  estimatedMinutes: number;
}

interface HuntCoverageReportProps {
  huntId: string;
  finds: {
    tasks?: { subject_domain?: string | null; challenge_type?: string; grade_range_min?: number | null; grade_range_max?: number | null; estimated_minutes?: number | null } | null;
  }[];
}

function gradeLabel(grade: number): string {
  return grade === 0 ? "K" : String(grade);
}

export default function HuntCoverageReport({ finds }: HuntCoverageReportProps) {
  const [expanded, setExpanded] = useState(false);

  if (finds.length < 3) return null;

  const coverage: CoverageData = {
    subjects: {},
    challengeTypes: {},
    gradeRange: null,
    totalStops: finds.length,
    estimatedMinutes: 0,
  };

  // Teacher-written tasks have no grade range (the columns are NULL), so only
  // tasks that actually carry one count toward the hunt's range.
  let minGrade: number | null = null;
  let maxGrade: number | null = null;

  for (const find of finds) {
    const task = find.tasks;
    if (!task) continue;

    if (task.subject_domain) {
      coverage.subjects[task.subject_domain] = (coverage.subjects[task.subject_domain] || 0) + 1;
    }
    if (task.challenge_type) {
      coverage.challengeTypes[task.challenge_type] = (coverage.challengeTypes[task.challenge_type] || 0) + 1;
    }
    if (task.grade_range_min != null && (minGrade === null || task.grade_range_min < minGrade)) minGrade = task.grade_range_min;
    if (task.grade_range_max != null && (maxGrade === null || task.grade_range_max > maxGrade)) maxGrade = task.grade_range_max;
    coverage.estimatedMinutes += task.estimated_minutes || 5;
  }

  if (minGrade !== null && maxGrade !== null && minGrade <= maxGrade) {
    coverage.gradeRange = { min: minGrade, max: maxGrade };
  }

  const subjectLabels: Record<string, string> = {
    science_nature: "Science",
    math_real_world: "Math",
    geography_maps: "Geography",
    critical_thinking: "Critical Thinking",
    reading_writing: "Reading & Writing",
    history_community: "History",
  };

  const subjectCount = Object.keys(coverage.subjects).length;
  const challengeCount = Object.keys(coverage.challengeTypes).length;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-xs"
      >
        <span className="font-medium text-gray-700">
          Coverage: {subjectCount} subject{subjectCount !== 1 ? "s" : ""} · {challengeCount} challenge type{challengeCount !== 1 ? "s" : ""} · ~{coverage.estimatedMinutes} min
        </span>
        <span className="text-gray-400">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Subjects */}
          <div>
            <p className="text-[11px] font-medium text-gray-500 mb-1">Subjects Covered</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(coverage.subjects).map(([domain, count]) => (
                <span key={domain} className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700">
                  {subjectLabels[domain] || domain} ({count})
                </span>
              ))}
            </div>
          </div>

          {/* Challenge types */}
          <div>
            <p className="text-[11px] font-medium text-gray-500 mb-1">Challenge Types</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(coverage.challengeTypes).map(([type, count]) => (
                <span key={type} className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
                  {type.replace(/_/g, " ")} ({count})
                </span>
              ))}
            </div>
          </div>

          {/* Grade range */}
          {coverage.gradeRange && (
            <p className="text-[11px] text-gray-500">
              Grade range: {gradeLabel(coverage.gradeRange.min)}
              {coverage.gradeRange.max !== coverage.gradeRange.min && `–${gradeLabel(coverage.gradeRange.max)}`}
            </p>
          )}

          {/* Suggestions */}
          {subjectCount < 3 && (
            <p className="text-[11px] text-amber-600 bg-amber-50 rounded px-2 py-1">
              Tip: Adding stops from different subjects creates a more engaging, interdisciplinary hunt.
            </p>
          )}
          {challengeCount < 3 && (
            <p className="text-[11px] text-amber-600 bg-amber-50 rounded px-2 py-1">
              Tip: Varying challenge types (photo, sketch, data collection, writing) keeps students engaged.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
