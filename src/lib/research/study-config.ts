/**
 * Pilot-wide research switches (2026-11-14).
 *
 * IN_APP_SURVEYS_ENABLED: Qualtrics is the survey source of record (owner
 * decision 2026-11-14). The app's own T1/T2/T3 instruments stay in the
 * database but are switched off here, so no delivery is ever created, no
 * reminder is sent, the privacy-page Save is never gated on one, and the
 * export carries no empty survey_* columns. Flip to true only together with
 * an IRB change.
 */
export const IN_APP_SURVEYS_ENABLED = false;

export interface TestAccountSubject {
  email?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Accounts that must never be randomized or exported, whatever their role and
 * consent: demo accounts (metadata.demo_account), load-test and QA accounts on
 * the reserved `.invalid` domain, and anything explicitly flagged
 * metadata.research_excluded. Staff roles are excluded separately
 * (research-eligibility.ts). Pure.
 */
export function isTestAccount(subject: TestAccountSubject | null | undefined): boolean {
  if (!subject) return false;
  const meta = subject.metadata ?? {};
  if (meta.demo_account === true || meta.research_excluded === true) return true;
  const email = (subject.email ?? "").trim().toLowerCase();
  return email.endsWith(".invalid");
}
