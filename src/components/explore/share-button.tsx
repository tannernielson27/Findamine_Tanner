"use client";

/**
 * Share a hunt: the system share sheet (Web Share API, also the iOS share
 * sheet inside the app's web view) when there is one, otherwise copy the
 * link and say so.
 */
import { useEffect, useRef, useState } from "react";
import { Share } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

interface ShareButtonProps {
  title: string;
  /** Path to share, e.g. /browse/123. Made absolute from the current origin. */
  path: string;
  className?: string;
}

type Notice = "copied" | "failed" | null;

export function ShareButton({ title, path, className }: ShareButtonProps) {
  const [notice, setNotice] = useState<Notice>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function flash(next: Notice) {
    setNotice(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 2500);
  }

  async function share() {
    const url = new URL(path, window.location.origin).toString();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // The player closed the sheet: nothing to do.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flash("copied");
    } catch {
      flash("failed");
    }
  }

  return (
    <span className="relative">
      <IconButton label="Share hunt" tone="floating" onClick={share} className={className}>
        <Share className="h-5 w-5" aria-hidden="true" />
      </IconButton>
      <span
        role="status"
        className={
          notice
            ? "absolute right-0 top-14 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-sm font-semibold text-white shadow-raised"
            : "sr-only"
        }
      >
        {notice === "copied" ? "Link copied" : notice === "failed" ? "Couldn't copy the link" : ""}
      </span>
    </span>
  );
}
