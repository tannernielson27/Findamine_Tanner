/**
 * Email service — wraps Resend for transactional emails.
 * To migrate to Amazon SES later, only this file needs to change.
 */

import { Resend } from "resend";

// Lazy initialization — avoids build failure when RESEND_API_KEY isn't set
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM_ADDRESS = process.env.EMAIL_FROM || "findamine <noreply@findamine.app>";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://findamine.app";

export interface SendResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Send one transactional email. Never throws: a missing key or a provider
 * error comes back as { success: false } so callers decide how to recover.
 */
export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<SendResult> {
  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_ADDRESS,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });

    if (error) {
      console.error("Email send error:", error);
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err) {
    console.error("Email service error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}

/**
 * Send the COPPA parental consent verification email.
 */
export async function sendConsentVerificationEmail(opts: {
  parentEmail: string;
  parentName: string | null;
  childName: string;
  childId: string;
  verificationToken: string;
}): Promise<SendResult> {
  const verifyUrl = `${SITE_URL}/api/v1/consent/coppa/verify?token=${opts.verificationToken}&child_id=${opts.childId}`;

  return sendEmail({
      to: opts.parentEmail,
      subject: `Verify your child's findamine account`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h1 style="font-size: 20px; color: #111827; margin-bottom: 16px;">
            Parental Consent Required
          </h1>
          <p style="color: #4B5563; font-size: 14px; line-height: 1.6;">
            Hi ${opts.parentName || "there"},
          </p>
          <p style="color: #4B5563; font-size: 14px; line-height: 1.6;">
            An account has been created for <strong>${opts.childName}</strong> on findamine,
            a GPS-powered educational scavenger hunt platform. Because ${opts.childName} is
            under 13, we need your consent before they can use the app.
          </p>
          <p style="color: #4B5563; font-size: 14px; line-height: 1.6;">
            <strong>What findamine does:</strong> Students navigate to real-world locations,
            solve educational challenges, and earn points — all while learning.
          </p>
          <p style="color: #4B5563; font-size: 14px; line-height: 1.6;">
            <strong>How we protect your child:</strong>
          </p>
          <ul style="color: #4B5563; font-size: 14px; line-height: 1.8; padding-left: 20px;">
            <li>Photos stay on their device only (never uploaded)</li>
            <li>They appear as codenames on leaderboards (not real names)</li>
            <li>Social features (friends, messaging) are disabled</li>
            <li>We never sell or share personal data</li>
          </ul>
          <div style="margin: 24px 0;">
            <a href="${verifyUrl}"
               style="display: inline-block; background-color: #0EA5E9; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
              Verify and Activate Account
            </a>
          </div>
          <p style="color: #9CA3AF; font-size: 12px; line-height: 1.6;">
            If you did not request this account, you can safely ignore this email.
            The account will remain inactive.
          </p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
          <p style="color: #9CA3AF; font-size: 11px;">
            findamine — GPS Educational Scavenger Hunts<br />
            Brigham Young University &middot; 450 TNRB, Provo, UT 84602<br />
            Questions? Contact mark_keith@byu.edu
          </p>
        </div>
      `,
  });
}
