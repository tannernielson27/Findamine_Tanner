import Link from "next/link";
import { getAdminAreaRole, AdminOnlyNotice } from "../../_lib/admin-access";
import ThreatLabeler from "@/components/admin/threat-labeler";
import FeatureImportanceChart from "@/components/admin/feature-importance-chart";
import FalsePositiveMetrics from "@/components/admin/false-positive-metrics";

export default async function ThreatsPage() {
  const role = await getAdminAreaRole();
  if (role !== "admin") return <AdminOnlyNotice area="Security" />;

  return (
    <main className="mx-auto max-w-5xl px-4 py-4">
      <div className="flex items-center gap-4 mb-4">
        <Link href="/admin/security" className="text-sm text-brand hover:underline">&larr; Security</Link>
        <h1 className="text-lg font-semibold text-gray-900">Threat Labeler</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main threat list */}
        <div className="lg:col-span-2">
          <ThreatLabeler />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Feature importance */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Feature Importance (PFI)</h2>
            <FeatureImportanceChart />
          </div>

          {/* Model performance */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Model Performance</h2>
            <FalsePositiveMetrics />
          </div>

          <Link
            href="/admin/security/model"
            className="block text-center rounded border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            View Model Details &rarr;
          </Link>
        </div>
      </div>
    </main>
  );
}
