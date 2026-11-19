"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNativeApp } from "@/lib/native/platform";
import { createPingHub, supabasePingTransport, type PingHub } from "./leaderboard-pings";
import { createRefreshScheduler, LEADERBOARD_REFRESH_TIMING } from "./refresh-scheduler";

// One hub for the page: it shares a Realtime connection per channel.
let sharedHub: PingHub | null = null;
function pingHub(): PingHub {
  sharedHub ??= createPingHub(supabasePingTransport(createSupabaseBrowserClient()));
  return sharedHub;
}

export interface LiveBoard<T> {
  /** The last board that loaded; null before the first one. */
  data: T | null;
  /** True until the first load for this channel has finished, well or badly. */
  loading: boolean;
}

interface Loaded<T> {
  topic: string;
  data: T | null;
}

/**
 * Keeps a board up to date for as long as it is on screen.
 *
 * `load` fetches the board and resolves null on failure. It is called on
 * mount, shortly after each "board changed" ping on `topic`, on a timer while
 * the board is on screen (in case a ping was missed), and straight away when
 * the page becomes visible again, the native app returns to the foreground,
 * the window regains focus, the network comes back, or Realtime reconnects.
 * A backgrounded tab or native app makes no requests. A failed refetch leaves
 * the last good board on screen.
 *
 * `load` must keep the same identity between renders (useCallback).
 */
export function useLiveBoard<T>(topic: string, load: () => Promise<T | null>): LiveBoard<T> {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);

  useEffect(() => {
    let active = true;
    const scheduler = createRefreshScheduler({
      timing: LEADERBOARD_REFRESH_TIMING,
      refresh: async () => {
        const next = await load();
        if (!active) return;
        setLoaded((previous) =>
          next === null && previous?.topic === topic ? previous : { topic, data: next }
        );
      },
    });

    // "On screen" needs both: the page visible and, in the native apps, the
    // app in the foreground (the webview can stay "visible" in the background).
    let appActive = true;
    const onScreen = () => document.visibilityState === "visible" && appActive;
    const onVisibility = () => scheduler.setVisible(onScreen());
    const onStale = () => scheduler.refreshNow();

    scheduler.start(onScreen());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onStale);
    window.addEventListener("online", onStale);
    const stopListening = pingHub().subscribe(topic, {
      onPing: () => scheduler.ping(),
      onReconnect: onStale,
    });

    let removeNative: (() => void) | null = null;
    if (isNativeApp()) {
      void import("@capacitor/app")
        .then(({ App }) =>
          App.addListener("appStateChange", ({ isActive }) => {
            appActive = isActive;
            onVisibility();
          })
        )
        .then((handle) => {
          if (active) removeNative = () => void handle.remove();
          else void handle.remove();
        })
        // No app-state events: page visibility and the poll still apply.
        .catch(() => undefined);
    }

    return () => {
      active = false;
      scheduler.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onStale);
      window.removeEventListener("online", onStale);
      stopListening();
      removeNative?.();
    };
  }, [topic, load]);

  const current = loaded?.topic === topic ? loaded : null;
  return { data: current?.data ?? null, loading: current === null };
}
