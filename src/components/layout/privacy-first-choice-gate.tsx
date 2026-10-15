"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { motion } from "framer-motion";
import { backdrop, dialog } from "@/lib/motion";

/**
 * First-use choice gate for the NEUTRAL default condition (Workstream A / A10).
 *
 * Participants assigned privacy_default = "neutral" start with no pre-selected
 * privacy settings — the study design requires them to make an explicit choice
 * on first use rather than inherit a default. Until their first save (stamped
 * server-side as metadata.privacy_first_choice_at), this gate directs them to
 * the privacy page on every app load. It never renders for other conditions.
 */
export default function PrivacyFirstChoiceGate() {
  const router = useRouter();
  const pathname = usePathname();
  const [needsChoice, setNeedsChoice] = useState(false);

  useEffect(() => {
    fetch("/api/v1/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const meta = data?.user?.metadata || {};
        setNeedsChoice(meta.privacy_default === "neutral" && !meta.privacy_first_choice_at);
      })
      .catch(() => setNeedsChoice(false)); // fail open: never trap the user in a broken gate
  }, [pathname]);

  // Never cover the page where the choice is actually made — nor the survey
  // routes: a pending check-in blocks Save on the privacy page until it is
  // answered, so covering the survey too would leave no way to make the choice.
  const exempt =
    pathname?.startsWith("/settings/privacy") ||
    pathname === "/surveys" ||
    pathname?.startsWith("/surveys/");
  if (!needsChoice || exempt) return null;

  return (
    <motion.div
      variants={backdrop}
      initial="hidden"
      animate="visible"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-choice-title"
    >
      <motion.div variants={dialog} className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <SlidersHorizontal aria-hidden="true" className="w-6 h-6 text-brand" />
          <h2 id="privacy-choice-title" className="text-lg font-bold text-gray-900">
            Choose your privacy settings
          </h2>
        </div>
        <p className="text-sm text-gray-600 mb-2">
          Before you start exploring, decide who can see the different parts of
          your profile — like your name, score, and badges.
        </p>
        <p className="text-sm text-gray-600 mb-5">
          Nothing has been chosen for you. It only takes a minute, and you can
          change your choices anytime.
        </p>
        <button
          onClick={() => router.push("/settings/privacy")}
          className="min-h-11 w-full rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark transition"
        >
          Choose my settings
        </button>
      </motion.div>
    </motion.div>
  );
}
