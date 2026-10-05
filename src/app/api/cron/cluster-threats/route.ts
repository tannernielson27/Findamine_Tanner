/**
 * Nightly DBSCAN threat clustering cron job.
 *
 * Groups the last 48 hours of sessions by IP, extracts features,
 * scores threats, runs DBSCAN clustering, and auto-blocks IPs
 * in high-threat clusters.
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { extractThreatFeatures, FEATURE_NAMES, type ThreatFeatures } from "@/lib/ml/threat-features";
import { scoreThreat } from "@/lib/ml/threat-scorer";
import {
  THREAT_EVENT_COLUMNS,
  groupThreatEvents,
  groupIpHash,
  toFeatureEvents,
  type ThreatEventRow,
} from "@/app/api/v1/admin/_lib/threat-events";

export const maxDuration = 60; // seconds

export async function GET(request: NextRequest) {
  // Verify cron secret
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseServiceClient();
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();

  // Fetch events from last 48 hours
  // behavioral_events has no ip_address/user_agent column (see threat-events.ts).
  const { data, error } = await supabase
    .from("behavioral_events")
    .select(THREAT_EVENT_COLUMNS)
    .gte("created_at", since)
    .order("created_at")
    .limit(10_000);
  if (error) {
    return Response.json({ error: `behavioral_events read failed: ${error.message}` }, { status: 500 });
  }

  const events = (data || []) as ThreatEventRow[];
  if (events.length === 0) {
    return Response.json({ sessions_analyzed: 0, clusters_found: 0 });
  }

  // Group by session (falling back to a recorded ip hash); events with
  // neither cannot be attributed and are skipped.
  const { groups, ungrouped } = groupThreatEvents(events);
  if (groups.size === 0) {
    return Response.json({ sessions_analyzed: 0, clusters_found: 0, events_without_session: ungrouped });
  }

  // Extract features and score each session. `ip` is null when no ip hash was
  // recorded for the session — such sessions are scored but never auto-blocked.
  const sessions: { key: string; ip: string | null; features: ThreatFeatures; score: number; vector: number[] }[] = [];
  for (const [key, sessionEvents] of groups) {
    const features = extractThreatFeatures(toFeatureEvents(sessionEvents));
    const result = scoreThreat(features);
    const vector = FEATURE_NAMES.map((f) => features[f]);
    const ip = groupIpHash(sessionEvents);
    sessions.push({ key, ip, features, score: result.score, vector });

    // Store threat score
    await supabase.from("threat_scores").insert({
      session_id: key,
      ip_hash: ip,
      threat_score: result.score,
      classification: result.classification,
      features,
      feature_importance: result.feature_contributions,
    });
  }

  // DBSCAN clustering
  const epsilon = 0.8;
  const minPoints = 3;
  const clusters = dbscan(sessions.map((s) => s.vector), epsilon, minPoints);

  // Group sessions by cluster
  const clusterMap = new Map<number, typeof sessions>();
  for (let i = 0; i < sessions.length; i++) {
    const cid = clusters[i];
    if (cid === -1) continue; // noise
    if (!clusterMap.has(cid)) clusterMap.set(cid, []);
    clusterMap.get(cid)!.push(sessions[i]);
  }

  // Get auto-block threshold (default 70)
  const autoBlockThreshold = 70;

  let autoBlocked = 0;
  for (const [clusterId, members] of clusterMap) {
    const avgScore = members.reduce((s, m) => s + m.score, 0) / members.length;
    const center = computeCenter(members.map((m) => m.vector));
    const memberIps = [...new Set(members.map((m) => m.ip).filter((ip): ip is string => ip !== null))];

    // Store cluster
    await supabase.from("threat_clusters").insert({
      cluster_id: clusterId,
      cluster_center: center,
      member_count: members.length,
      avg_threat_score: avgScore,
      member_ips: memberIps,
      auto_blocked: avgScore >= autoBlockThreshold,
    });

    // Auto-block if avg score exceeds threshold
    if (avgScore >= autoBlockThreshold) {
      for (const ip of memberIps) {
        await supabase.from("blocked_ips").upsert(
          {
            ip_hash: ip,
            reason: `Auto-blocked: cluster ${clusterId} avg score ${Math.round(avgScore)}`,
            expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            is_active: true,
          },
          { onConflict: "ip_hash" }
        );
        autoBlocked++;
      }
    }
  }

  const noiseCount = clusters.filter((c) => c === -1).length;

  return Response.json({
    sessions_analyzed: sessions.length,
    clusters_found: clusterMap.size,
    noise_points: noiseCount,
    auto_blocked: autoBlocked,
    events_without_session: ungrouped,
  });
}

/* ─── DBSCAN ────────────────────────────────────────────────── */

function dbscan(points: number[][], epsilon: number, minPoints: number): number[] {
  const n = points.length;
  const labels = new Array<number>(n).fill(-2); // -2 = unvisited
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;
    const neighbors = rangeQuery(points, i, epsilon);
    if (neighbors.length < minPoints) {
      labels[i] = -1; // noise
      continue;
    }
    labels[i] = clusterId;
    const seeds = [...neighbors];
    for (let j = 0; j < seeds.length; j++) {
      const q = seeds[j];
      if (labels[q] === -1) labels[q] = clusterId;
      if (labels[q] !== -2) continue;
      labels[q] = clusterId;
      const qNeighbors = rangeQuery(points, q, epsilon);
      if (qNeighbors.length >= minPoints) {
        for (const nn of qNeighbors) {
          if (!seeds.includes(nn)) seeds.push(nn);
        }
      }
    }
    clusterId++;
  }

  return labels;
}

function rangeQuery(points: number[][], idx: number, epsilon: number): number[] {
  const result: number[] = [];
  const p = points[idx];
  for (let i = 0; i < points.length; i++) {
    if (i === idx) continue;
    if (euclidean(p, points[i]) <= epsilon) result.push(i);
  }
  return result;
}

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function computeCenter(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const center = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) center[i] += v[i];
  }
  return center.map((c) => c / vectors.length);
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
