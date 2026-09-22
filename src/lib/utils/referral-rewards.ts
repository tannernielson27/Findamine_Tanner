/**
 * Referral reward amounts, shared by the referral service and the social page.
 * Kept free of server imports so client components can show the numbers.
 */

/**
 * One-time bonus to a recruiter when a minion completes their first find.
 * Paid through the same disclosure gate as the ongoing share, so a hidden
 * recruiter forfeits it — which also brings the first forfeit (and the S3
 * notice) forward.
 */
export const RECRUIT_BONUS = 50;

/** One-time points for joining a crew with a referral code. Not gated. */
export const WELCOME_BONUS = 25;
