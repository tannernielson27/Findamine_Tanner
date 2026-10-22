"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ActiveHuntProvider, useShellActiveHunt } from "./active-hunt-context";
import MiniBar from "./mini-bar";
import TabBar from "./tab-bar";
import { shellChromeFor, tabsFor, type NavUser } from "./nav-links";

interface AppChromeProps {
  /** Signed-in user's role, or null for a signed-out visitor (public /browse). */
  user: Pick<NavUser, "role"> | null;
  children: ReactNode;
}

/**
 * Bottom-of-screen shell: the floating tab bar, the active-hunt mini-bar, and
 * the bottom padding (.fm-tab-safe / .fm-tab-safe-mini) every page under them
 * needs, applied once here instead of page by page.
 */
export default function AppChrome({ user, children }: AppChromeProps) {
  const pathname = usePathname();
  const chrome = shellChromeFor(pathname);
  const onPlay = pathname === "/play" || pathname.startsWith("/play/");
  return (
    <ActiveHuntProvider enabled={!!user && !onPlay}>
      <ChromeBody user={user} pathname={pathname} chrome={chrome}>
        {children}
      </ChromeBody>
    </ActiveHuntProvider>
  );
}

function ChromeBody({
  user,
  pathname,
  chrome,
  children,
}: {
  user: Pick<NavUser, "role"> | null;
  pathname: string;
  chrome: ReturnType<typeof shellChromeFor>;
  children: ReactNode;
}) {
  const { hunt } = useShellActiveHunt();
  const tabs = tabsFor(user);
  const showTabs = chrome.tabBar && tabs.length > 0;
  const showMini = !!user && chrome.miniBar && !!hunt;
  const padding = showTabs ? (showMini ? "fm-tab-safe-mini" : "fm-tab-safe") : showMini ? "fm-tab-safe" : undefined;

  return (
    <>
      <div className={padding}>{children}</div>
      {showMini && hunt && <MiniBar hunt={hunt} />}
      {showTabs && <TabBar tabs={tabs} pathname={pathname} />}
    </>
  );
}
