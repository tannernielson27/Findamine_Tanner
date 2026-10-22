"use client";

import type { ReactNode } from "react";
import { CircleAlert, RotateCcw, SatelliteDish, WifiOff, X } from "lucide-react";
import { PermissionDeniedNotice } from "@/components/permissions/permission-primer";
import { isWeakAccuracy } from "@/lib/play/proximity";
import type { GpsStatus } from "@/lib/play/play-types";

interface BannerProps {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  role?: "status" | "alert";
}

/** Inline, non-blocking notice over the map. Never covers the whole screen. */
export function PlayBanner({ icon, children, action, role = "status" }: BannerProps) {
  return (
    <div role={role} className="flex items-center gap-3 rounded-2xl bg-white py-2.5 pl-4 pr-2 text-ink shadow-raised">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 py-1 text-base font-semibold leading-snug">{children}</div>
      {action}
    </div>
  );
}

function BannerButton({ onClick, label, icon }: { onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl px-3 text-base font-bold text-link transition-colors hover:bg-sky-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {icon}
      {label}
    </button>
  );
}

interface GpsBannersProps {
  gpsStatus: GpsStatus;
  accuracy: number | null;
  onRetry: () => void;
}

/** No network: arrive pings fail quietly and resume on the next fix once back online. */
export function OfflineBanner() {
  return (
    <PlayBanner icon={<WifiOff className="h-6 w-6 text-[#9A3412]" aria-hidden="true" />}>
      You&apos;re offline. We&apos;ll keep checking where you are once you&apos;re back.
    </PlayBanner>
  );
}

/**
 * GPS problems as inline banners. The "I'm here" button stays on
 * screen in every state, so the manual check-in is always the fallback.
 */
export function GpsBanners({ gpsStatus, accuracy, onRetry }: GpsBannersProps) {
  const warn = <SatelliteDish className="h-6 w-6 text-[#9A3412]" aria-hidden="true" />;
  return (
    <>
      {gpsStatus === "denied" && (
        <div className="rounded-2xl bg-white shadow-raised [&>div]:mb-0">
          <PermissionDeniedNotice kind="location">
            <p className="text-base text-themed-text">You can still play: tap I&apos;m here when you reach the stop.</p>
          </PermissionDeniedNotice>
        </div>
      )}

      {gpsStatus === "unavailable" && (
        <PlayBanner role="alert" icon={warn}>
          GPS isn&apos;t working on this device right now. Tap I&apos;m here when you reach the stop.
        </PlayBanner>
      )}

      {gpsStatus === "timeout" && (
        <PlayBanner
          role="alert"
          icon={warn}
          action={<BannerButton onClick={onRetry} label="Retry" icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />} />}
        >
          GPS signal lost. Move into open sky.
        </PlayBanner>
      )}

      {gpsStatus === "active" && isWeakAccuracy(accuracy) && (
        <PlayBanner icon={warn}>GPS ±{Math.round(accuracy as number)} m. Move into open sky.</PlayBanner>
      )}
    </>
  );
}

/** The current stop's error (failed request) with a dismiss button. */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <PlayBanner
      role="alert"
      icon={<CircleAlert className="h-6 w-6 text-[#B42318]" aria-hidden="true" />}
      action={<BannerButton onClick={onDismiss} label="Dismiss" icon={<X className="h-4 w-4" aria-hidden="true" />} />}
    >
      {message}
    </PlayBanner>
  );
}
