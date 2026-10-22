"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { popover, SPRING_SNAPPY } from "@/lib/motion";
import { Bell } from "lucide-react";
import {
  PRIVACY_CHECKIN_TYPE,
  CHECKIN_TARGET_PATH,
  type CheckinResponseAction,
} from "@/lib/services/privacy-checkin";

/** `notifications.type` written by the survey reminder cron (survey-delivery.ts). */
const SURVEY_REMINDER_TYPE = "survey_reminder";
const SURVEYS_PATH = "/surveys";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** Column name on public.notifications (the API returns rows as stored). */
  read: boolean;
  created_at: string;
}

/**
 * Report a privacy check-in response (storyline S4). Fire-and-forget with
 * keepalive so an open that navigates away is still recorded. Never throws.
 */
function logCheckinResponse(
  notificationId: string,
  action: CheckinResponseAction,
  reason?: "mark_all"
): void {
  try {
    void fetch("/api/v1/research/checkin-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_id: notificationId, action, ...(reason ? { reason } : {}) }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // telemetry must never break the bell
  }
}

export default function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;
  // Bumped only when unread rises after the first load, so the initial fetch
  // and marking things read don't wiggle the badge. count is null until loaded.
  const [loaded, setLoaded] = useState(false);
  const [badge, setBadge] = useState<{ count: number | null; bumps: number }>({ count: null, bumps: 0 });
  if (loaded && unreadCount !== badge.count) {
    const rose = badge.count !== null && unreadCount > badge.count;
    setBadge({ count: unreadCount, bumps: rose ? badge.bumps + 1 : badge.bumps });
  }

  // State is only set after the request resolves, so calling this from an
  // effect never triggers a synchronous re-render; the skeleton is switched on
  // by the dropdown toggle instead.
  async function fetchNotifications() {
    try {
      const res = await fetch("/api/v1/notifications?limit=20");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setLoaded(true);
      }
    } catch {
      // keep the current list on a transient failure
    } finally {
      setLoading(false);
    }
  }

  // Load on mount
  useEffect(() => {
    fetchNotifications();
  }, []);

  // Poll for new notifications every 30s (scales better than WebSocket per-user)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchNotifications();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [open]);

  /** Show a notification as read only once the server has accepted it. */
  async function handleMarkRead(id: string) {
    try {
      const res = await fetch("/api/v1/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        keepalive: true,
      });
      if (!res.ok) return;
    } catch {
      return; // still unread; the next poll shows the true state
    }
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }

  async function handleMarkAllRead() {
    // Clearing unread check-ins in bulk is a dismissal, recorded as such.
    for (const n of notifications) {
      if (!n.read && n.type === PRIVACY_CHECKIN_TYPE) logCheckinResponse(n.id, "dismissed", "mark_all");
    }
    try {
      const res = await fetch("/api/v1/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all_read: true }),
      });
      if (!res.ok) return;
    } catch {
      return;
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  async function handleSelect(n: Notification) {
    if (n.type === SURVEY_REMINDER_TYPE) {
      // A survey reminder opens the surveys list.
      if (!n.read) await handleMarkRead(n.id);
      setOpen(false);
      router.push(SURVEYS_PATH);
      return;
    }
    if (n.type !== PRIVACY_CHECKIN_TYPE) {
      if (!n.read) await handleMarkRead(n.id);
      return;
    }
    // A privacy check-in opens the privacy page (storyline S4).
    logCheckinResponse(n.id, "opened");
    if (!n.read) await handleMarkRead(n.id);
    setOpen(false);
    router.push(CHECKIN_TARGET_PATH);
  }

  async function handleDismiss(n: Notification) {
    logCheckinResponse(n.id, "dismissed");
    await handleMarkRead(n.id);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setLoading(true);
            void fetchNotifications();
          }
        }}
        className="relative flex h-12 w-12 items-center justify-center rounded-full border border-themed-border bg-surface text-themed-text transition-colors duration-150 hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {/* Bell icon */}
        <Bell className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
        {unreadCount > 0 && (
          <motion.span
            key={badge.bumps}
            initial={badge.bumps > 0 ? { scale: 0.6 } : false}
            animate={{ scale: 1 }}
            transition={SPRING_SNAPPY}
            className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-brand px-1 text-xs font-bold leading-none text-white tabular-nums"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </motion.span>
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
      {open && (
        <motion.div
          key="notifications"
          variants={popover}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] origin-top-right rounded-xl border border-themed-border bg-white shadow-lg z-50"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <h4 className="text-sm font-semibold text-gray-900">Notifications</h4>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-link hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded fm-shimmer" />)}
              </div>
            ) : notifications.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">No notifications</p>
            ) : (
              notifications.map((n) => {
                const isCheckin = n.type === PRIVACY_CHECKIN_TYPE;
                return (
                  <div
                    key={n.id}
                    className={`flex items-start border-b border-gray-50 ${!n.read ? "bg-sky-50/50" : ""}`}
                  >
                    <button
                      onClick={() => void handleSelect(n)}
                      className="min-w-0 flex-1 text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && (
                          <span className="mt-1.5 w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className={`text-sm ${!n.read ? "font-medium text-gray-900" : "text-gray-700"}`}>
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{n.body}</p>
                          )}
                          <p className="text-[10px] text-gray-500 mt-1">
                            {formatTimeAgo(n.created_at)}
                          </p>
                        </div>
                      </div>
                    </button>
                    {isCheckin && !n.read && (
                      <button
                        onClick={() => void handleDismiss(n)}
                        aria-label={`Dismiss: ${n.title}`}
                        className="shrink-0 mr-2 mt-2.5 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
