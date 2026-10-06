"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { MotionConfig } from "framer-motion";
import { type AgeBand, THEME_TOKENS, tokensToCssVars } from "./tokens";

const VALID_BANDS: AgeBand[] = ["primary", "intermediate", "teen", "adult"];

interface AgeBandContextValue {
  band: AgeBand;
  setBand: (band: AgeBand) => void;
}

const AgeBandContext = createContext<AgeBandContextValue>({
  band: "intermediate",
  setBand: () => {},
});

/** The `?band=` preview override in the current URL, if it names a real band. */
function readUrlBandOverride(): AgeBand | null {
  const override = new URLSearchParams(window.location.search).get("band") as AgeBand | null;
  return override && VALID_BANDS.includes(override) ? override : null;
}

const subscribeToNothing = () => () => {};
const noOverrideOnServer = () => null;

export function useAgeBand() {
  return useContext(AgeBandContext);
}

export function AgeBandProvider({
  initialBand = "intermediate",
  children,
}: {
  initialBand?: AgeBand;
  children: React.ReactNode;
}) {
  const [baseBand] = useState<AgeBand>(initialBand);
  // An explicit setBand() call wins over everything else.
  const [selectedBand, setBand] = useState<AgeBand | null>(null);

  // Support ?band= URL parameter for previewing age bands. Read once per mount
  // (as before), and only on the client after hydration: the server snapshot is
  // "no override", so server and first client render agree.
  const [readOverrideOnce] = useState(() => {
    let cached: AgeBand | null | undefined;
    return () => (cached === undefined ? (cached = readUrlBandOverride()) : cached);
  });
  const urlOverride = useSyncExternalStore(subscribeToNothing, readOverrideOnce, noOverrideOnServer);

  const band = selectedBand ?? urlOverride ?? baseBand;

  useEffect(() => {
    // Set data attribute on html element
    document.documentElement.setAttribute("data-age-band", band);

    // Apply CSS custom properties
    const vars = tokensToCssVars(THEME_TOKENS[band]);
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value);
    }

    // Set font family only — do NOT set root font-size here.
    document.documentElement.style.fontFamily = THEME_TOKENS[band].fontFamily;
  }, [band]);

  return (
    <AgeBandContext.Provider value={{ band, setBand }}>
      {/* reducedMotion="user" makes every framer-motion animation honor the OS
          prefers-reduced-motion setting (opacity-only, no transforms). Combined
          with the global CSS guard + confetti gating, this completes C4. */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </AgeBandContext.Provider>
  );
}
