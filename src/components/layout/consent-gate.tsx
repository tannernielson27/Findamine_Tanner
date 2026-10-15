"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { backdrop, dialog } from "@/lib/motion";

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
 */

const CONSENT_FORM_VERSION = "1.0";

interface ConsentRecord {
  consent_type: string;
  granted: boolean;
}

export default function ConsentGate() {
  const router = useRouter();
  const [needsDecision, setNeedsDecision] = useState<boolean | null>(null);
  const [signature, setSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decidedRef = useRef(false);

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

  async function decide(granted: boolean) {
    if (decidedRef.current) return;
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
        }),
      });
      ok = res.ok;
    } catch {
      ok = false; // network failure: re-enable the buttons and say so
    }
    setSubmitting(false);
    if (!ok) {
      setError("Something went wrong recording your choice. Please try again.");
      return;
    }
    decidedRef.current = true;
    setNeedsDecision(false);
    // A grant makes the user enrollment-eligible; refresh so the server layout
    // re-runs enrollment and assigns their condition.
    if (granted) router.refresh();
  }

  if (needsDecision !== true) return null;

  return (
    <motion.div
      variants={backdrop}
      initial="hidden"
      animate="visible"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <motion.div variants={dialog} className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
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
              By selecting <strong>I consent</strong>, you confirm that you are 18 or older and agree
              to take part. If you select <strong>I do not consent</strong>, no study data will be
              collected about you.
            </p>
          </div>

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
              disabled={submitting}
              className="min-h-11 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
            >
              {submitting ? "Saving..." : "I consent"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
