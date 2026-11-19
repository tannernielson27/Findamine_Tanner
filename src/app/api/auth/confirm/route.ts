import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { FROM_APP_PARAM, isAuthLinkType, safeNextPath, type AuthLinkType } from "@/lib/services/auth-emails";
import { logger } from "@/lib/utils/logger";
import { isAppUserAgent, isPhoneBrowserOutsideApp } from "@/lib/native/user-agent";
import { isTrustedOrigin } from "@/lib/utils/trusted-origins";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page that asks the person to press a button before a link is used. */
const CONFIRM_PAGE_PATH = "/confirm-email";

/** 303: the browser follows a form POST with a GET of the destination. */
const SEE_OTHER = 303;

/**
 * True when the account the link was issued for has a confirmed email. A dead
 * confirmation link on a confirmed account almost always means something else
 * (the emailed code, a double click, another device) used it first.
 */
async function isAlreadyConfirmed(authUserId: string | null): Promise<boolean> {
  if (!authUserId || !UUID_PATTERN.test(authUserId)) return false;
  try {
    const supabase = await createSupabaseServiceClient();
    const { data } = await supabase.auth.admin.getUserById(authUserId);
    return Boolean(data?.user?.email_confirmed_at);
  } catch (error) {
    logger.error("auth.confirm.lookup_failed", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function loginRedirect(origin: string, params: Record<string, string>, next: string | null, status?: number): NextResponse {
  const query = new URLSearchParams(params);
  const safeNext = safeNextPath(next, "");
  if (safeNext) query.set("next", safeNext);
  return NextResponse.redirect(`${origin}/login?${query.toString()}`, status);
}

/**
 * A link asked for from the Findamine app was opened in a phone browser, which
 * is what mail apps do: show "go back to the app and sign in" before carrying
 * on on the web.
 */
function phoneBrowserLanding(origin: string, continueTo: string, status?: number): NextResponse {
  const query = new URLSearchParams({ continue: continueTo });
  return NextResponse.redirect(`${origin}/email-confirmed?${query.toString()}`, status);
}

interface LinkParams {
  tokenHash: string;
  type: AuthLinkType;
  next: string | null;
  uid: string | null;
  fromApp: boolean;
}

function readLinkParams(get: (key: string) => string | null): LinkParams | null {
  const tokenHash = get("token_hash");
  const type = get("type");
  if (!tokenHash || !isAuthLinkType(type)) return null;
  return { tokenHash, type, next: get("next"), uid: get("uid"), fromApp: get(FROM_APP_PARAM) === "1" };
}

/**
 * Spend the one-time token: sign the person in and send them on. `status` is
 * the redirect status (303 after a form POST).
 */
async function exchange(origin: string, link: LinkParams, userAgent: string | null, status?: number): Promise<NextResponse> {
  const outsideApp = link.fromApp && isPhoneBrowserOutsideApp(userAgent);
  let failed: boolean;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
    failed = Boolean(error);
  } catch (error) {
    // The auth service could not be reached: nothing was spent, so the same
    // link (or the code) can be tried again.
    logger.error("auth.confirm.exchange_failed", { error: error instanceof Error ? error.message : String(error) });
    return loginRedirect(origin, { error: "confirm_link_invalid" }, link.next, status);
  }
  if (!failed) {
    const destination = safeNextPath(link.next, "/dashboard");
    return outsideApp
      ? phoneBrowserLanding(origin, destination, status)
      : NextResponse.redirect(`${origin}${destination}`, status);
  }

  // The link is dead. If the email is confirmed anyway, the link (or the code
  // from the same email) did its job already and all that is left is to sign in.
  if (await isAlreadyConfirmed(link.uid)) {
    if (outsideApp) {
      const login = new URLSearchParams({ notice: "confirmed" });
      const safeNext = safeNextPath(link.next, "");
      if (safeNext) login.set("next", safeNext);
      return phoneBrowserLanding(origin, `/login?${login.toString()}`, status);
    }
    return loginRedirect(origin, { notice: "confirmed" }, link.next, status);
  }
  return loginRedirect(origin, { error: "confirm_link_invalid" }, link.next, status);
}

/**
 * Landing point for emailed auth links (verification, resend, password reset).
 *
 * Opening a link never spends its token. Mail systems open every link in a
 * message to scan it, seconds after it is sent, and a spent token also kills
 * the code in the same email: in the 2026-11-18 pilot that made the code fail
 * for more than half of the campus addresses. So:
 *
 *   - a reset link goes to the reset page, which exchanges the token when the
 *     new password is submitted;
 *   - a confirmation link goes to a page with one button, and the token is
 *     exchanged when that button is pressed (POST below);
 *   - inside the Findamine app (a universal link) the confirmation is
 *     exchanged at once: a scanner never presents the app's user agent.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const link = readLinkParams((key) => searchParams.get(key));
  if (!link) return loginRedirect(origin, { error: "link_invalid" }, null);

  if (link.type === "recovery") {
    const query = new URLSearchParams({ token_hash: link.tokenHash });
    if (link.fromApp) query.set(FROM_APP_PARAM, "1");
    return NextResponse.redirect(`${origin}/reset-password?${query.toString()}`);
  }

  const userAgent = request.headers.get("user-agent");
  if (isAppUserAgent(userAgent)) return exchange(origin, link, userAgent);

  const query = new URLSearchParams({ token_hash: link.tokenHash, type: link.type });
  const safeNext = safeNextPath(link.next, "");
  if (safeNext) query.set("next", safeNext);
  if (link.uid && UUID_PATTERN.test(link.uid)) query.set("uid", link.uid);
  if (link.fromApp) query.set(FROM_APP_PARAM, "1");
  return NextResponse.redirect(`${origin}${CONFIRM_PAGE_PATH}?${query.toString()}`);
}

/**
 * Did this form post come from one of our own pages? Browsers say so in up to
 * three headers; the first one present decides, and a request carrying none of
 * them is refused (every current browser sends Origin on a form POST).
 */
function postedFromOurPages(request: NextRequest): boolean {
  const sender = request.headers.get("origin");
  if (sender !== null) return isTrustedOrigin(request, sender);

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin";

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return isTrustedOrigin(request, new URL(referer).origin);
  } catch {
    return false;
  }
}

/**
 * The "Confirm my email" button on the confirmation page: a plain form POST,
 * so it works without scripts. This is where a confirmation token is spent.
 */
export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url);

  // Only our own pages may submit this form. Otherwise another site could post
  // its own valid token from a visitor's browser and sign them in to an
  // account that is not theirs.
  if (!postedFromOurPages(request)) {
    return loginRedirect(origin, { error: "link_invalid" }, null, SEE_OTHER);
  }

  const form = await request.formData().catch(() => null);
  const field = (key: string): string | null => {
    const value = form?.get(key);
    return typeof value === "string" && value ? value : null;
  };
  const link = readLinkParams(field);
  // A reset token is never exchanged here: the reset page does that.
  if (!link || link.type === "recovery") {
    return loginRedirect(origin, { error: "link_invalid" }, null, SEE_OTHER);
  }
  return exchange(origin, link, request.headers.get("user-agent"), SEE_OTHER);
}
