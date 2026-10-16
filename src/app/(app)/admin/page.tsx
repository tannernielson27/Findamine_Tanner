import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const serviceClient = await createSupabaseServiceClient();
  const { data: profile } = await serviceClient
    .from("users")
    .select("role")
    .eq("auth_id", authUser.id)
    .single();

  if (!profile || !["admin", "researcher"].includes(profile.role)) {
    redirect("/dashboard");
  }

  const isAdmin = profile.role === "admin";

  const [users, hunts, sessions, reports] = await Promise.all([
    serviceClient.from("users").select("*", { count: "exact", head: true }).is("deleted_at", null),
    serviceClient.from("hunts").select("*", { count: "exact", head: true }).is("deleted_at", null),
    serviceClient.from("play_sessions").select("*", { count: "exact", head: true }),
    serviceClient.from("moderation_reports").select("*", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const stats = [
    { label: "Users", value: users.count || 0 },
    { label: "Hunts", value: hunts.count || 0 },
    { label: "Play Sessions", value: sessions.count || 0 },
    { label: "Pending Reports", value: reports.count || 0 },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <h1 className="text-lg font-semibold text-gray-900 mb-4">Admin Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {isAdmin && (
          <AdminLink href="/admin/security" title="Security &amp; Threats" desc="Threat detection, IP blocking, and traffic analysis" />
        )}
        <AdminLink
          href="/admin/users"
          title="User Management"
          desc={isAdmin ? "View and manage user accounts and roles" : "View user accounts and roles"}
        />
        {isAdmin && (
          <AdminLink href="/admin/moderation" title="Moderation Queue" desc="Review flagged content and reports" />
        )}
        <AdminLink href="/admin/moderation/hunts" title="Hunt Review" desc="Approve hunts before they are listed in Discover" />
        <AdminLink href="/admin/research" title="Research Studies" desc="Manage treatment studies and dimensions" />
        <AdminLink href="/admin/surveys" title="Surveys" desc="Create and manage surveys" />
      </div>

      {!isAdmin && (
        <p className="mt-4 text-xs text-gray-500">
          Security and the moderation queue are admin-only and are hidden for your researcher role. Ask an
          admin to review any pending reports.
        </p>
      )}
    </main>
  );
}

function AdminLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-200 bg-white p-5 hover:border-sky-200 transition-colors"
    >
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500 mt-1">{desc}</p>
    </Link>
  );
}
