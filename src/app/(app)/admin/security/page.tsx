import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import ThreatExportButtons from "@/components/admin/threat-export-buttons";
import { getAdminAreaRole, AdminOnlyNotice } from "../_lib/admin-access";

export default async function SecurityDashboard() {
  const role = await getAdminAreaRole();
  if (role !== "admin") return <AdminOnlyNotice area="Security" />;

  const service = await createSupabaseServiceClient();

  // Fetch summary stats
  const [scores, blocked, labeled, clusters] = await Promise.all([
    service.from("threat_scores").select("*", { count: "exact", head: true }).gte("threat_score", 50),
    service.from("blocked_ips").select("*", { count: "exact", head: true }).eq("is_active", true),
    service.from("threat_classifications").select("*", { count: "exact", head: true }),
    service.from("threat_clusters").select("*", { count: "exact", head: true }),
  ]);

  // Recent high-score threats
  const { data: recentThreats } = await service
    .from("threat_scores")
    .select("session_id, threat_score, classification, created_at")
    .gte("threat_score", 50)
    .order("created_at", { ascending: false })
    .limit(10);

  // Recent blocked IPs
  const { data: recentBlocks } = await service
    .from("blocked_ips")
    .select("ip_hash, reason, expires_at, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(10);

  // Attack type distribution
  const { data: labelDist } = await service
    .from("threat_classifications")
    .select("attack_type");
  const typeCounts: Record<string, number> = {};
  for (const l of labelDist || []) {
    typeCounts[l.attack_type] = (typeCounts[l.attack_type] || 0) + 1;
  }

  const stats = [
    { label: "Active Threats", value: scores.count || 0, color: "text-red-600" },
    { label: "Blocked IPs", value: blocked.count || 0, color: "text-orange-600" },
    { label: "Labeled Sessions", value: labeled.count || 0, color: "text-sky-600" },
    { label: "Clusters Found", value: clusters.count || 0, color: "text-purple-600" },
  ];

  const typeColors: Record<string, string> = {
    safe: "bg-green-100 text-green-800",
    scanner: "bg-yellow-100 text-yellow-800",
    scraper: "bg-orange-100 text-orange-800",
    credential_stuffing: "bg-red-100 text-red-800",
    injection: "bg-red-200 text-red-900",
    ddos: "bg-purple-100 text-purple-800",
    other: "bg-gray-100 text-gray-800",
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link href="/admin" className="text-sm text-brand hover:underline">&larr; Admin</Link>
          <h1 className="text-lg font-semibold text-gray-900 mt-1">Security Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/security/traffic" className="rounded bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
            Traffic Analysis
          </Link>
          <Link href="/admin/security/threats" className="rounded bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100">
            Threat Labeler
          </Link>
          <Link href="/admin/security/model" className="rounded bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100">
            Model Details
          </Link>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Attack type distribution */}
      {Object.keys(typeCounts).length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Attack Type Distribution</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(typeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <span key={type} className={`rounded-full px-3 py-1 text-xs font-medium ${typeColors[type] || typeColors.other}`}>
                  {type.replace(/_/g, " ")} ({count})
                </span>
              ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent high-score threats */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent High-Score Threats</h2>
          {(!recentThreats || recentThreats.length === 0) ? (
            <p className="text-sm text-gray-400">No high-score threats recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {recentThreats.map((t) => (
                <div key={`${t.session_id}-${t.created_at}`} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-gray-600 truncate w-32">{(t.session_id || "unknown").slice(0, 16)}...</span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${
                    t.classification === "threat" ? "bg-red-100 text-red-800" : "bg-orange-100 text-orange-800"
                  }`}>
                    {t.threat_score}
                  </span>
                  <span className="text-gray-400">{new Date(t.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Blocked IPs */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Active Blocked IPs</h2>
          {(!recentBlocks || recentBlocks.length === 0) ? (
            <p className="text-sm text-gray-400">No IPs currently blocked.</p>
          ) : (
            <div className="space-y-2">
              {recentBlocks.map((b, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-gray-600 truncate w-28">{b.ip_hash.slice(0, 16)}...</span>
                  <span className="text-gray-500 truncate w-36">{b.reason}</span>
                  <span className="text-gray-400">
                    {b.expires_at ? `exp ${new Date(b.expires_at).toLocaleDateString()}` : "permanent"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Export */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Data Export</h2>
        <ThreatExportButtons />
      </div>
    </main>
  );
}
