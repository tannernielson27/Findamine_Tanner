"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { m } from "framer-motion";
import { backdrop, dialog } from "@/lib/motion";
import { checkResearchDateOfBirth } from "@/lib/utils/research-eligibility";

/**
 * Informed-consent gate for the research study (IRB requirement).
 *
 * Shown once, on first authenticated load, to study-eligible participants who
 * have not yet made a research-consent decision. Consent is the server-side
 * precondition for enrollment/randomization (see lib/services/enrollment.ts),
 * so nothing about the study happens until the participant decides here.
 *
 * Bump CONSENT_FORM_VERSION whenever the wording below changes: it is stored
 * with each decision and exported, so it shows which text a person agreed to.
 * 1.1 added an explicit "I am 18 or older" checkbox. 1.2 replaced it with a
 * required date of birth (owner decision 2026-10-15): parents, teachers and
 * creators register without one, so `needsDateOfBirth` users enter it here;
 * the consent route checks it is 18+ and saves it to their account. Users
 * with a DOB on file were already age-checked and see no extra field.
 * Who sees this gate at all is decided by researchEligibility (research-eligibility.ts).
 */

const CONSENT_FORM_VERSION = "1.2";

interface ConsentDialogProps {
  /** The decision was recorded (or the under-age notice dismissed): stop showing the dialog. */
  onClose: () => void;
  /** No date of birth on file: ask for one before a grant can be recorded. */
  needsDateOfBirth?: boolean;
}

export default function ConsentDialog({ needsDateOfBirth = false, onClose }: ConsentDialogProps) {
  const router = useRouter();
  const [signature, setSignature] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [underAge, setUnderAge] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decidedRef = useRef(false);

  async function decide(granted: boolean) {
    if (decidedRef.current) return;
    if (granted && needsDateOfBirth) {
      const check = checkResearchDateOfBirth(dateOfBirth);
      if (!check.ok) {
        // Under 18: explain kindly and record nothing. Invalid: ask again.
        if (check.reason === "under_18") setUnderAge(true);
        else setError("Please enter a valid date of birth.");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    let ok = false;
    try {
      const res = await fetch("/api/v1/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent_type: "research",
          granted,
          form_version: CONSENT_FORM_VERSION,
          signature_name: granted ? signature.trim() || null : null,
          // Only sent when none is on file; the server re-checks it is 18+ and
          // saves it to the account (it never overwrites a stored one).
          date_of_birth: granted && needsDateOfBirth ? dateOfBirth : undefined,
        }),
      });
      ok = res.ok;
      // The server is the authority on age: honor an adults-only refusal.
      if (res.status === 403 && granted) {
        setSubmitting(false);
        setUnderAge(true);
        return;
      }
    } catch {
      ok = false; // network failure: re-enable the buttons and say so
    }
    setSubmitting(false);
    if (!ok) {
      setError("Something went wrong recording your choice. Please try again.");
      return;
    }
    decidedRef.current = true;
    onClose();
    // A grant makes the user enrollment-eligible; refresh so the server layout
    // re-runs enrollment and assigns their condition.
    if (granted) router.refresh();
  }

  if (underAge) {
    return (
      <m.div
        variants={backdrop}
        initial="hidden"
        animate="visible"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
      >
        <m.div variants={dialog} className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck aria-hidden="true" className="w-6 h-6 text-brand" />
              <h2 id="consent-title" className="text-lg font-bold text-gray-900">
                Thanks for your interest
              </h2>
            </div>
            <p className="text-sm text-gray-600">
              The research study is for adults (18 or older) only, so you won&apos;t be part of it.
              Nothing has been recorded, and you can keep playing Findamine just as before.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => onClose()}
                className="min-h-11 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
              >
                Keep playing
              </button>
            </div>
          </div>
        </m.div>
      </m.div>
    );
  }

  return (
    <m.div
      variants={backdrop}
      initial="hidden"
      animate="visible"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <m.div variants={dialog} className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck aria-hidden="true" className="w-6 h-6 text-brand" />
            <h2 id="consent-title" className="text-lg font-bold text-gray-900">
              Research participation
            </h2>
          </div>

          <div className="space-y-3 text-sm text-gray-600">
            <p>
              Findamine is being used in a student research project about how people manage their
              privacy settings in an app. You&apos;re invited to take part.
            </p>
            <div>
              <p className="font-medium text-gray-900">What taking part involves</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>You use Findamine as you normally would.</li>
                <li>
                  The app records how you use its privacy settings (what you change and when) and
                  your general activity, such as hunts played and points earned.
                </li>
                <li>
                  You&apos;ll be asked to answer three short questionnaires: one near the start, one
                  partway through, and one at the end.
                </li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-gray-900">Your data</p>
              <p className="mt-1">
                Your responses are stored securely and used only for this research. Results are
                reported for the group as a whole, never in a way that identifies you.              </p>
            </div>
            <div>
              <p className="font-medium text-gray-900">Your choice</p>
              <p className="mt-1">
                Taking part is voluntary and open to adults (18 or older). Saying no will not affect
                your grade or standing in any class, and you can still use Findamine normally. If you
                say yes, you can withdraw at any time and study data collection stops from that point.
              </p>
            </div>
            <p>
              By selecting <strong>I consent</strong>, you agree to take part. If you select{" "}
              <strong>I do not consent</strong>, no study data will be collected about you.
            </p>
          </div>

          {needsDateOfBirth && (
            <div className="mt-4">
              <label htmlFor="consent-dob" className="block text-sm font-medium text-gray-700 mb-1">
                Date of birth
              </label>
              <input
                id="consent-dob"
                type="date"
                required
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                max={new Date().toISOString().split("T")[0]}
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base sm:text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition"
              />
              <p className="mt-1.5 text-xs text-gray-500">
                Needed to take part. It is saved to your account and used only to confirm you are 18
                or older.
              </p>
            </div>
          )}

          <label className="mt-4 block text-xs text-gray-500">
            Type your name to sign (optional)
            <input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              placeholder="Your name"
            />
          </label>

          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              onClick={() => decide(false)}
              disabled={submitting}
              className="min-h-11 rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              I do not consent
            </button>
            <button
              onClick={() => decide(true)}
              disabled={submitting || (needsDateOfBirth && !dateOfBirth)}
              className="min-h-11 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
            >
              {submitting ? "Saving..." : "I consent"}
            </button>
          </div>
        </div>
      </m.div>
    </m.div>
  );
}
