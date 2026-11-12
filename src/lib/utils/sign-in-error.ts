import { ApiError } from "./api-auth";

/** The fields of a Supabase AuthError that tell failure kinds apart. */
export interface SignInErrorLike {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
}

const RATE_LIMITED = "Too many attempts. Please wait a few minutes and try again.";
const UNAVAILABLE = "Sign-in is busy right now. Please try again in a moment.";

function isRateLimited(error: SignInErrorLike): boolean {
  return error.status === 429 || (error.code ?? "").includes("rate_limit");
}

function isUnavailable(error: SignInErrorLike): boolean {
  return (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (typeof error.status === "number" && error.status >= 500)
  );
}

/**
 * Map a failed signInWithPassword to the API error to return. Only a real
 * credential failure is "Invalid email or password": telling people their
 * password is wrong when the auth server is overloaded makes them retry and
 * deepens the overload.
 */
export function signInFailure(error: SignInErrorLike): ApiError {
  if (isRateLimited(error)) return new ApiError(429, RATE_LIMITED);
  if (isUnavailable(error)) return new ApiError(503, UNAVAILABLE);
  if (error.code === "email_not_confirmed") {
    return new ApiError(403, "Please confirm your email first. Check your inbox for the link we sent.");
  }
  if (error.code === "user_banned") return new ApiError(403, "This account has been disabled. Please contact support.");
  return new ApiError(401, "Invalid email or password");
}
