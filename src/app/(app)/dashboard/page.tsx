import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login");
  }

  const serviceClient = await createSupabaseServiceClient();
  const { data: profile } = await serviceClient
    .from("users")
    .select("id, email, display_name, role, avatar_url, created_at")
    .eq("auth_id", authUser.id)
    .is("deleted_at", null)
    .single();

  if (!profile) {
    redirect("/login");
  }

  return <DashboardClient user={profile} />;
}
