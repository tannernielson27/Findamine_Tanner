"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

/**
 * Informed-consent gate for the research study (IRB requirement).
 *
 * Shown once, on first authenticated load, to study-eligible participants who
 * have not yet made a research-consent decision. Consent is the server-side
 * precondition for enrollment/randomization (see lib/services/enrollment.ts),
 * so nothing about the study happens until the participant decides here.
 *
 * Bump CONSENT_FORM_VERSION whenever the wording in consent-dialog.tsx changes: it is stored
 * with each decision and exported, so it shows which text a person agreed to.
 * 1.1 added an explicit "I am 18 or older" checkbox. 1.2 replaced it with a
 * required date of birth (owner decision 2026-10-15): parents, teachers and
 * creators register without one, so `needsDateOfBirth` users enter it here;
 * the consent route checks it is 18+ and saves it to their account. Users
 * with a DOB on file were already age-checked and see no extra field.
 * Who sees this gate at all is decided by researchEligibility (research-eligibility.ts).
 */

// The dialog (form, framer-motion, DOB validation) is only fetched when a decision is actually needed.
// While it loads, a hidden modal placeholder keeps the welcome tour (which stands
// down for any open aria-modal dialog) from flashing in ahead of the consent form.
const ConsentDialog = dynamic(() => import("./consent-dialog"), {
  ssr: false,
  loading: () => <div role="dialog" aria-modal="true" aria-label="Loading" hidden />,
});

interface ConsentGateProps {
  /** No date of birth on file: ask for one before a grant can be recorded. */
  needsDateOfBirth?: boolean;
}

interface ConsentRecord {
  consent_type: string;
  granted: boolean;
}

export default function ConsentGate({ needsDateOfBirth = false }: ConsentGateProps) {
  const [needsDecision, setNeedsDecision] = useState(false);

  useEffect(() => {
    fetch("/api/v1/consent")
      .then((r) => (r.ok ? r.json() : { consent_records: [] }))
      .then((data) => {
        const records: ConsentRecord[] = data.consent_records || [];
        const hasResearchDecision = records.some((r) => r.consent_type === "research");
        setNeedsDecision(!hasResearchDecision);
      })
      .catch(() => setNeedsDecision(false)); // fail open: never trap the user in a broken gate
  }, []);

  if (!needsDecision) return null;
  return <ConsentDialog needsDateOfBirth={needsDateOfBirth} onClose={() => setNeedsDecision(false)} />;
}
