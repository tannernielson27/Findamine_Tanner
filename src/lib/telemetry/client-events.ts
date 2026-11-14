/**
 * Client event logger (pilot 2026-11): screen views, app foreground/background
 * and client errors, batched to POST /api/v1/events/batch (behavioral_events)
 * with the session / platform / app_version envelope.
 *
 * Fire-and-forget: never throws, never blocks the UI. Events are queued and
 * flushed every FLUSH_MS, when the queue reaches FLUSH_AT, and when the page
 * is hidden (keepalive, so a backgrounded app still sends them).
 */

import { eventEnvelope } from "@/lib/telemetry/envelope";

export type ClientEventType = "screen_view" | "app_state" | "client_error";

export const FLUSH_MS = 10_000;
export const FLUSH_AT = 20;
/** Server-side cap per batch (events/batch route). */
export const MAX_BATCH = 50;
/** Errors are capped per page load so a render loop can't flood the table. */
export const MAX_ERRORS_PER_LOAD = 20;

interface QueuedEvent {
  event_type: ClientEventType;
  event_name: string;
  payload: Record<string, unknown>;
  session_id: string;
  platform: string;
  app_version: string;
  client_ts: string;
}

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let errorCount = 0;
const seenErrors = new Set<string>();

function scheduleFlush(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushClientEvents();
  }, FLUSH_MS);
}

/** Send everything queued. `keepalive` for page-hide flushes. */
export async function flushClientEvents(keepalive = false): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length > 0) {
    const batch = queue.slice(0, MAX_BATCH);
    queue = queue.slice(MAX_BATCH);
    try {
      await fetch("/api/v1/events/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive,
      });
    } catch {
      // Dropped: telemetry must never retry-storm a weak connection.
    }
  }
}

/** Queue one event. Never throws. */
export function logClientEvent(
  eventType: ClientEventType,
  eventName: string,
  payload: Record<string, unknown> = {}
): void {
  void (async () => {
    try {
      const envelope = await eventEnvelope();
      queue = [
        ...queue,
        { event_type: eventType, event_name: eventName, payload, ...envelope, client_ts: new Date().toISOString() },
      ];
      if (queue.length >= FLUSH_AT) void flushClientEvents();
      else scheduleFlush();
    } catch {
      // never break the app for telemetry
    }
  })();
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Screen template: no query string or hash (they can carry codes or emails),
 * and every id segment replaced by ":id" (a /profile/<id> path would otherwise
 * record which other person was looked at). Pure.
 */
export function screenPath(pathname: string | null | undefined): string {
  return (pathname ?? "").split(/[?#]/)[0].replace(UUID_RE, ":id").slice(0, 200);
}

/** The hunt id on /play/<id> and /browse/<id> screens (hunts are not people). Pure. */
export function huntIdFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/(?:play|browse)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
    (pathname ?? "").split(/[?#]/)[0]
  );
  return m ? m[1].toLowerCase() : null;
}

const EMAIL_RE = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi;
const QUERY_RE = /\?[^\s"')]*/g;

const FRAGMENT_RE = /#[^\s"')]*/g;
const BEARER_RE = /\bBearer\s+\S+/gi;
const JWT_RE = /\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g;
/** Long hex / base64-ish runs: tokens, keys, codes. */
const TOKEN_RE = /\b[A-Za-z0-9+/_-]{32,}={0,2}/g;

/** Remove emails, ids, tokens, URL query strings and fragments from error text. Pure. */
export function redactErrorText(text: string): string {
  return text
    .replace(BEARER_RE, "Bearer <token>")
    .replace(JWT_RE, "<token>")
    .replace(EMAIL_RE, "<email>")
    .replace(UUID_RE, ":id")
    .replace(TOKEN_RE, "<token>")
    .replace(QUERY_RE, "?…")
    .replace(FRAGMENT_RE, "#…");
}

/**
 * Log a client error once per distinct message per load, up to the cap.
 * Only the message, a trimmed stack and the screen are kept.
 */
export function logClientError(source: string, error: unknown, path?: string): void {
  const message = redactErrorText(error instanceof Error ? error.message : String(error ?? "")).slice(0, 300);
  const key = `${source}::${message}`;
  if (seenErrors.has(key) || errorCount >= MAX_ERRORS_PER_LOAD) return;
  seenErrors.add(key);
  errorCount += 1;
  const stack = error instanceof Error && error.stack ? redactErrorText(error.stack).slice(0, 1000) : undefined;
  logClientEvent("client_error", source, { message, ...(stack ? { stack } : {}), path: screenPath(path) });
}
