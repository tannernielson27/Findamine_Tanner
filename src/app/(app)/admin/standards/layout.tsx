import { getAdminAreaRole } from "../_lib/admin-access";

/**
 * Same gate as the other /admin pages (admin or researcher); the standards page
 * is client-rendered and cannot check the role itself.
 */
export default async function StandardsLayout({ children }: { children: React.ReactNode }) {
  await getAdminAreaRole();
  return <>{children}</>;
}
