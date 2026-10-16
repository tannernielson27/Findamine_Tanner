/**
 * Who may read the moderation queue and act on reports.
 *
 * Admin only. "teacher" and "hunt_creator" are self-selectable at signup, so
 * they can't be trusted with other people's reported chat/kudos or with taking
 * content down; researchers are kept out of the queue by the admin area too
 * (see src/app/(app)/admin/page.tsx).
 */
export const MODERATOR_ROLES = ["admin"] as const;
