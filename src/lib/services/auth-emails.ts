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

/**
 * Only same-site relative paths are allowed as post-confirm / post-login
 * destinations. Whitespace and control characters are refused because
 * browsers strip them while parsing, which can turn "/\t/evil" into "//evil".
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    /[\s\u0000-\u001f\u007f]/.test(next)
  ) {
    return fallback;
  }
  return next;
}

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
 */
export function buildAuthConfirmUrl(
  siteUrl: string,
  tokenHash: string,
  type: AuthLinkType,
  next: string,
  authUserId?: string
): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type, next });
  if (authUserId) params.set("uid", authUserId);
  return `${siteUrl}/api/auth/confirm?${params.toString()}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function authEmailHtml(opts: { greeting: string; body: string; cta: string; url: string; footnote: string }): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p style="color: #4B5563; font-size: 14px; line-height: 1.6;">${opts.greeting}</p>
      <p style="color: #4B5563; font-size: 14px; line-height: 1.6;">${opts.body}</p>
      <div style="margin: 24px 0;">
        <a href="${escapeHtml(opts.url)}"
           style="display: inline-block; background-color: #0EA5E9; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
          ${opts.cta}
        </a>
      </div>
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
}): Promise<SendResult> {
  const name = opts.displayName ? escapeHtml(opts.displayName) : "there";
  return sendEmail({
    to: opts.to,
    subject: "Confirm your findamine account",
    html: authEmailHtml({
      greeting: `Hi ${name},`,
      body: "Confirm your email address to finish creating your findamine account.",
      cta: "Confirm my account",
      url: opts.confirmUrl,
      footnote: "This link works once and expires in 24 hours. If you did not sign up, you can ignore this email.",
    }),
  });
}

export async function sendPasswordResetEmail(opts: { to: string; confirmUrl: string }): Promise<SendResult> {
  return sendEmail({
    to: opts.to,
    subject: "Reset your findamine password",
    html: authEmailHtml({
      greeting: "Hi there,",
      body: "Someone asked to reset the password for this findamine account. Use the button below to choose a new one.",
      cta: "Choose a new password",
      url: opts.confirmUrl,
      footnote: "This link works once and expires in 1 hour. If you did not ask for this, you can ignore this email; your password has not changed.",
    }),
  });
}
