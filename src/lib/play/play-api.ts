/**
 * Fetch helpers for the play loop.
 */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** fetch() that throws an HttpError carrying the server's message on a non-2xx reply. */
export async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new HttpError(res.status, body.error || `HTTP ${res.status}`);
  }
  return res;
}

/** POST JSON and report whether the server accepted it. Never throws. */
export async function postJson(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** POST a JSON body through safeFetch and parse the reply. */
export async function postJsonStrict<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  const res = await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
