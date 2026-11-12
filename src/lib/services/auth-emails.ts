/**
 * Auth emails (account verification, password reset) sent through Resend.
 *
 * Supabase generates the one-time token server-side (auth.admin.generateLink,
 * which sends nothing); we email a link to /api/auth/confirm, which exchanges
 * the token hash for a session. This keeps auth mail off Supabase's built-in
 * SMTP, which is rate-limited to a few messages an hour.
 */

import { sendEmail, type SendResult } from "./email";

export type AuthLinkType = "signup" | "magiclink" | "recovery";

const AUTH_LINK_TYPES: ReadonlySet<string> = new Set<AuthLinkType>(["signup", "magiclink", "recovery"]);

export function isAuthLinkType(value: string | null): value is AuthLinkType {
  return value !== null && AUTH_LINK_TYPES.has(value);
}

// Lives in a client-safe module so the auth forms can use it too.
export { safeNextPath } from "@/lib/utils/safe-next-path";

/**
 * The public site origin used in emailed links. Production requires
 * NEXT_PUBLIC_SITE_URL so a spoofed Host header can never redirect a token.
 */
export function resolveSiteUrl(requestOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_SITE_URL environment variable is not set");
  }
  return requestOrigin;
}

/**
 * `authUserId` lets /api/auth/confirm tell "this link was already used and the
 * account is confirmed" (often a mail scanner opened it first) apart from a
 * link that is simply dead. It is an opaque id, not a credential.
 *
 * `fromApp` marks a link asked for from the phone app. If such a link is then
 * opened in a phone browser, the person is told to go back to the app; links
 * asked for on the web carry on as before.
 */
export function buildAuthConfirmUrl(
  siteUrl: string,
  tokenHash: string,
  type: AuthLinkType,
  next: string,
  authUserId?: string,
  fromApp = false
): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type, next });
  if (authUserId) params.set("uid", authUserId);
  if (fromApp) params.set(FROM_APP_PARAM, "1");
  return `${siteUrl}/api/auth/confirm?${params.toString()}`;
}

/** Query parameter marking an emailed link as asked for from the phone app. */
export const FROM_APP_PARAM = "app";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Supabase's one-time email code (6 digits by default). Anything else is left
 * out of the email rather than shown, so a provider change can't put
 * something unexpected in front of the reader.
 */
const EMAIL_CODE_PATTERN = /^\d{6,10}$/;

export function displayableEmailCode(code: string | null | undefined): string | null {
  const trimmed = code?.trim();
  return trimmed && EMAIL_CODE_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * The code is there for the phone app: an emailed link opens in Safari, not in
 * the app, so the person can type the code into the app instead.
 */
function codeBlockHtml(code: string, codeHint: string): string {
  return `
      <p style="color: #4B5563; font-size: 14px; line-height: 1.6; margin-bottom: 8px;">${codeHint}</p>
      <p style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #111827; margin: 0 0 24px;">${escapeHtml(code)}</p>`;
}

function authEmailHtml(opts: {
  greeting: string;
  body: string;
  cta: string;
  url: string;
  code: string | null;
  codeHint: string;
  footnote: string;
}): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p style="color: #4B5563; font-size: 14px; line-height: 1.6;">${opts.greeting}</p>
      <p style="color: #4B5563; font-size: 14px; line-height: 1.6;">${opts.body}</p>
      <div style="margin: 24px 0;">
        <a href="${escapeHtml(opts.url)}"
           style="display: inline-block; background-color: #0EA5E9; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
          ${opts.cta}
        </a>
      </div>${opts.code ? codeBlockHtml(opts.code, opts.codeHint) : ""}
      <p style="color: #9CA3AF; font-size: 12px; line-height: 1.6;">${opts.footnote}</p>
      <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
      <p style="color: #9CA3AF; font-size: 11px;">findamine — GPS scavenger hunts</p>
    </div>
  `;
}

export async function sendVerificationEmail(opts: {
  to: string;
  displayName: string | null;
  confirmUrl: string;
  /** Supabase's email_otp for the same token as the link. */
  code?: string | null;
}): Promise<SendResult> {
  const name = opts.displayName ? escapeHtml(opts.displayName) : "there";
  const code = displayableEmailCode(opts.code);
  return sendEmail({
    to: opts.to,
    subject: "Confirm your findamine account",
    html: authEmailHtml({
      greeting: `Hi ${name},`,
      body: "Confirm your email address to finish creating your findamine account.",
      cta: "Confirm my account",
      url: opts.confirmUrl,
      code,
      codeHint: "Signing up in the findamine app? Enter this code there instead:",
      footnote: code
        ? "The link and the code work once and expire in 24 hours. If you did not sign up, you can ignore this email."
        : "This link works once and expires in 24 hours. If you did not sign up, you can ignore this email.",
    }),
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  confirmUrl: string;
  /** Supabase's email_otp for the same token as the link. */
  code?: string | null;
}): Promise<SendResult> {
  const code = displayableEmailCode(opts.code);
  return sendEmail({
    to: opts.to,
    subject: "Reset your findamine password",
    html: authEmailHtml({
      greeting: "Hi there,",
      body: "Someone asked to reset the password for this findamine account. Use the button below to choose a new one.",
      cta: "Choose a new password",
      url: opts.confirmUrl,
      code,
      codeHint: "Using the findamine app? Enter this code there instead:",
      footnote: code
        ? "The link and the code work once and expire in 1 hour. If you did not ask for this, you can ignore this email; your password has not changed."
        : "This link works once and expires in 1 hour. If you did not ask for this, you can ignore this email; your password has not changed.",
    }),
  });
}
