import type { MetadataRoute } from "next";

/**
 * This is a service used by children, so the default here is closed rather
 * than open.
 *
 * /leaderboard is disallowed deliberately, and it is the one worth explaining:
 * it renders player display names, and letting a search engine index the
 * usernames of minors is exactly the kind of exposure a COPPA service should
 * not create. It stays reachable to players; it just does not get archived
 * into search results.
 *
 * Everything behind a login — dashboards, admin, settings, the consent and
 * password-reset flows — is out for the ordinary reason.
 *
 * AI crawlers are not restricted, per Mark's call across all four properties.
 * Note the limit regardless: robots.txt is a request honoured only by
 * well-behaved crawlers, so it is not a control over anything that does not
 * want to be controlled.
 */
const DISALLOWED_PATHS = [
  "/admin",
  "/dashboard",
  "/settings",
  "/leaderboard",
  "/consent-pending",
  "/consent-verified",
  "/forgot-password",
  "/reset-password",
  "/login",
  "/register",
  "/play",
  "/api/",
];

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://findamine.app";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: DISALLOWED_PATHS }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
