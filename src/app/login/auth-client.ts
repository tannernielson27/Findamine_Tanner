/**
 * Small browser-side helpers shared by the auth forms (login, register,
 * forgot/reset password, join class). No server imports: safe in client code.
 */

export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the server. Check your connection and try again.";

export type PostResult =
  | { ok: true; status: number; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * POST JSON and always come back with something a form can show: a network
 * failure, a non-JSON error page and an API error all become `{ ok: false }`.
 * Never throws, so a form can't be left stuck in its loading state.
 */
export async function postJson(url: string, body: unknown, fallbackError: string): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR_MESSAGE };
  }

  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    // Not JSON (e.g. a gateway error page); fall through with an empty body.
  }

  if (res.ok) return { ok: true, status: res.status, data };

  const apiError = typeof data.error === "string" && data.error ? data.error : null;
  if (apiError) return { ok: false, status: res.status, error: apiError };
  if (res.status === 429) {
    return { ok: false, status: 429, error: "Too many attempts. Please wait a few minutes and try again." };
  }
  if (res.status >= 500) {
    return { ok: false, status: res.status, error: "Something went wrong on our end. Please try again in a moment." };
  }
  return { ok: false, status: res.status, error: fallbackError };
}

interface SupabaseAuthErrorLike {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
}

const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";
const SERVER_ERROR_MESSAGE = "Something went wrong on our end. Please try again in a moment.";

function isNetworkError(error: SupabaseAuthErrorLike): boolean {
  return (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    /failed to fetch|network|load failed/i.test(error.message ?? "")
  );
}

function isRateLimited(error: SupabaseAuthErrorLike): boolean {
  return error.status === 429 || (error.code ?? "").includes("rate_limit");
}

/** Human message for a failed supabase.auth.signInWithPassword. */
export function describeSignInError(error: SupabaseAuthErrorLike): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  if (isRateLimited(error)) return RATE_LIMIT_MESSAGE;
  if (error.code === "user_banned") return "This account has been disabled. Please contact support.";
  if (typeof error.status === "number" && error.status >= 500) return SERVER_ERROR_MESSAGE;
  return "Invalid email or password";
}

/** Human message for a failed password update on the reset page. */
export function describePasswordUpdateError(error: SupabaseAuthErrorLike): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  if (isRateLimited(error)) return RATE_LIMIT_MESSAGE;
  if (error.code === "same_password") return "Your new password must be different from your current one.";
  if (error.code === "weak_password") {
    return "That password is too easy to guess. Try a longer one with a mix of letters and numbers.";
  }
  if (error.code === "session_not_found" || error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403) {
    return "This reset link has expired. Please request a new one.";
  }
  if (typeof error.status === "number" && error.status >= 500) return SERVER_ERROR_MESSAGE;
  return "We couldn't update your password. Please try again.";
}
