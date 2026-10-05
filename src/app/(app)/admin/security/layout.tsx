import { getAdminAreaRole, AdminOnlyNotice } from "../_lib/admin-access";

/**
 * Admin-only gate for every /admin/security page, including the client-rendered
 * ones (traffic, model) that cannot check the role themselves. The server pages
 * keep their own check as well: a layout is not re-run on client-side
 * navigation between sibling pages.
 */
export default async function SecurityLayout({ children }: { children: React.ReactNode }) {
  const role = await getAdminAreaRole();
  if (role !== "admin") return <AdminOnlyNotice area="Security" />;
  return <>{children}</>;
}
