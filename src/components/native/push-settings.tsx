"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff } from "lucide-react";
import { PermissionDeniedNotice, PermissionPrimer } from "@/components/permissions/permission-primer";
import { isNativeApp } from "@/lib/native/platform";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/native/push";

const noopSubscribe = () => () => {};

const BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-brand hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 transition";

/**
 * Settings card for push notifications, shown only in the iOS app and never
 * for child accounts. Turning them on shows the notifications primer first;
 * the iOS prompt appears only after Continue. Nothing asks on first launch.
 */
export function PushSettings({ role }: { role: string }) {
  const native = useSyncExternalStore(noopSubscribe, () => isNativeApp(), () => false);
  const [state, setState] = useState<PushState | "loading">("loading");
  const [priming, setPriming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!native || role === "child") return;
    let cancelled = false;
    void pushState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [native, role]);

  if (!native || role === "child" || state === "loading" || state === "unavailable") return null;

  async function turnOn() {
    setPriming(false);
    setBusy(true);
    setMessage("");
    const result = await enablePush();
    setBusy(false);
    if (result === "enabled") {
      setState("on");
      setMessage("Notifications are on for this device.");
    } else if (result === "denied") {
      setState("denied");
    } else {
      setMessage("We couldn't turn on notifications. Check your connection and try again.");
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage("");
    await disablePush();
    setBusy(false);
    setState("off");
    setMessage("Notifications are off for this device.");
  }

  return (
    <section
      aria-labelledby="notifications-heading"
      className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 mt-6 space-y-3"
    >
      <h2 id="notifications-heading" className="font-[family-name:var(--font-display)] font-semibold text-gray-900">
        Notifications
      </h2>

      {state === "denied" ? (
        <PermissionDeniedNotice kind="notifications" />
      ) : priming ? (
        <PermissionPrimer kind="notifications" onContinue={() => void turnOn()} onDismiss={() => setPriming(false)} />
      ) : state === "on" ? (
        <button type="button" onClick={() => void turnOff()} disabled={busy} className={BUTTON}>
          <BellOff className="h-4 w-4" aria-hidden="true" />
          Turn off notifications
        </button>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            Get a notification about your own hunts, classes and teams. Off until you turn it on.
          </p>
          <button type="button" onClick={() => setPriming(true)} disabled={busy} className={BUTTON}>
            <Bell className="h-4 w-4" aria-hidden="true" />
            Turn on notifications
          </button>
        </>
      )}

      <p role="status" className="text-xs text-gray-500">
        {message}
      </p>
    </section>
  );
}
