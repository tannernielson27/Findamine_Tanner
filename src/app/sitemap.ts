import type { MetadataRoute } from "next";

// Only the genuinely public, non-personal pages. Everything a player reaches
// after signing in is deliberately absent, as is the leaderboard: see the note
// in robots.ts about not indexing children's display names.
const ROUTES: Array<{
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}> = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/browse", priority: 0.8, changeFrequency: "weekly" },
  { path: "/browse/standards", priority: 0.6, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://findamine.app";
  const lastModified = new Date();
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
