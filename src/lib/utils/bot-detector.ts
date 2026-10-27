/**
 * Bot detection for findamine.
 *
 * Scores incoming requests based on user-agent patterns, behavioral
 * signals, and request metadata. Sessions scoring 100 (definite bot)
 * are auto-blocked.
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/* ─── Known bot user-agent patterns ─────────────────────────── */

const BOT_UA_PATTERNS = [
  // Search engines (legitimate — don't block, but flag)
  "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
  "yandexbot", "applebot",
  // Social media crawlers
  "facebookexternalhit", "twitterbot", "linkedinbot",
  // Generic bot signatures
  "bot", "crawler", "spider", "scraper",
  // HTTP libraries / automation
  "curl", "wget", "python-requests", "python-urllib", "httpx",
  "node-fetch", "axios", "go-http-client", "java/",
  // Headless browsers
  "headless", "phantomjs", "selenium", "puppeteer", "playwright",
  // Security scanners
  "sqlmap", "nikto", "nmap", "masscan", "zgrab", "censys", "shodan",
  "nuclei", "gobuster", "dirbuster", "wpscan", "burp", "owasp",
  "arachni", "acunetix",
  // SEO / research bots
  "ahrefsbot", "semrushbot", "dotbot", "mj12bot", "rogerbot",
  "screaming frog", "seokicks",
  // Misc
  "scrapy", "mechanize", "httpclient",
];

/** Patterns that are 100% automated — never a real user */
const DEFINITE_BOT_PATTERNS = [
  "sqlmap", "nikto", "nmap", "masscan", "zgrab", "censys", "shodan",
  "nuclei", "gobuster", "dirbuster", "wpscan", "burp", "acunetix",
  "arachni", "scrapy", "mechanize", "curl/", "wget/",
  "python-requests", "python-urllib", "go-http-client",
  "headlesschrome", "phantomjs",
];

/* ─── Suspicious paths (probing for vulnerabilities) ────────── */

const SUSPICIOUS_PATHS = [
  "/wp-admin", "/wp-login", "/wp-content", "/wp-includes",
  "/.env", "/.git", "/.htaccess", "/.aws",
  "/phpmyadmin", "/admin/config", "/xmlrpc",
  "/etc/passwd", "/shell", "/cmd", "/eval",
  "/actuator", "/api/v1/admin",
  "/../", "/cgi-bin",
];

/* ─── Types ─────────────────────────────────────────────────── */

export interface BotScore {
  score: number;          // 0-100
  classification: "human" | "suspicious" | "likely_bot" | "bot";
  reasons: string[];
  definite: boolean;      // true = 100% confident, auto-block
}

/* ─── Scoring ───────────────────────────────────────────────── */

export function detectBot(request: NextRequest): BotScore {
  const ua = (request.headers.get("user-agent") || "").toLowerCase();
  const path = new URL(request.url).pathname.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  let definite = false;

  // 1. Check for definite bot UA (100% confidence)
  for (const pattern of DEFINITE_BOT_PATTERNS) {
    if (ua.includes(pattern)) {
      reasons.push(`Definite bot UA: ${pattern}`);
      score += 80;
      definite = true;
      break;
    }
  }

  // 2. Check for general bot UA patterns
  if (!definite) {
    for (const pattern of BOT_UA_PATTERNS) {
      if (ua.includes(pattern)) {
        reasons.push(`Bot UA pattern: ${pattern}`);
        score += 40;
        break;
      }
    }
  }

  // 3. Missing or empty user agent
  if (!ua || ua.length < 10) {
    reasons.push("Missing or very short user-agent");
    score += 25;
    if (!ua) definite = true; // No UA at all = automated
  }

  // 4. Suspicious path probing
  for (const sus of SUSPICIOUS_PATHS) {
    if (path.includes(sus)) {
      reasons.push(`Suspicious path: ${sus}`);
      score += 30;
      if (path.includes("/.env") || path.includes("/.git") || path.includes("/etc/passwd")) {
        definite = true; // Vulnerability scanning = definite bot
      }
      break;
    }
  }

  // 5. No Accept-Language header (browsers always send this)
  if (!request.headers.get("accept-language")) {
    reasons.push("Missing Accept-Language header");
    score += 15;
  }

  // 6. No Accept header or non-browser Accept
  const accept = request.headers.get("accept") || "";
  if (!accept) {
    reasons.push("Missing Accept header");
    score += 10;
  } else if (!accept.includes("text/html") && !accept.includes("application/json") && !accept.includes("*/*")) {
    reasons.push("Non-standard Accept header");
    score += 10;
  }

  // Cap at 100
  score = Math.min(score, 100);

  // Definite if score hits 100 from multiple signals
  if (score >= 100) definite = true;

  const classification: BotScore["classification"] =
    score >= 75 ? "bot" :
    score >= 50 ? "likely_bot" :
    score >= 25 ? "suspicious" :
    "human";

  return { score, classification, reasons, definite };
}

/* ─── Auto-block logic ──────────────────────────────────────── */

/**
 * Check if an IP is blocked. Returns true if blocked.
 */
const BLOCK_CACHE_TTL_MS = 60_000;
const BLOCK_CACHE_MAX = 5_000;
const blockCache = new Map<string, { blocked: boolean; expiresAt: number }>();

/** Drop cached block decisions (tests, admin changes within this instance). */
export function clearBlockedIpCache(): void {
  blockCache.clear();
}

export async function isIpBlocked(ipHash: string): Promise<boolean> {
  const cached = blockCache.get(ipHash);
  if (cached && cached.expiresAt > Date.now()) return cached.blocked;

  const blocked = await lookupIpBlocked(ipHash);
  if (blockCache.size >= BLOCK_CACHE_MAX) blockCache.clear();
  blockCache.set(ipHash, { blocked, expiresAt: Date.now() + BLOCK_CACHE_TTL_MS });
  return blocked;
}

async function lookupIpBlocked(ipHash: string): Promise<boolean> {
  const supabase = await createSupabaseServiceClient();
  const { data } = await supabase
    .from("blocked_ips")
    .select("id, expires_at")
    .eq("ip_hash", ipHash)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!data) return false;

  // Check expiration
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    // Expired — deactivate
    await supabase.from("blocked_ips").update({ is_active: false }).eq("id", data.id);
    return false;
  }

  return true;
}

/**
 * Get IP hash from request (uses x-forwarded-for or falls back).
 */
export function getIpHash(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  // Simple hash for privacy (not cryptographic, just obscures raw IP)
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    hash = ((hash << 5) - hash + ip.charCodeAt(i)) | 0;
  }
  return `ip_${Math.abs(hash).toString(36)}`;
}

/* ─── Badge helper for UI ───────────────────────────────────── */

export function botBadgeColor(classification: string): string {
  const colors: Record<string, string> = {
    human: "bg-green-100 text-green-800",
    suspicious: "bg-yellow-100 text-yellow-800",
    likely_bot: "bg-orange-100 text-orange-800",
    bot: "bg-red-100 text-red-800",
  };
  return colors[classification] || "bg-gray-100 text-gray-800";
}
