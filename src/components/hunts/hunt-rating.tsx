"use client";

import { useState, useEffect } from "react";
import { Star } from "lucide-react";

interface HuntRatingProps {
  huntId: string;
}

export default function HuntRating({ huntId }: HuntRatingProps) {
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [totalRatings, setTotalRatings] = useState(0);
  const [userRating, setUserRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/hunts/${huntId}/rate`)
      .then((r) => r.json())
      .then((d) => {
        setAvgRating(d.avg_rating);
        setTotalRatings(d.total_ratings || 0);
      })
      .catch(() => {});
  }, [huntId]);

  async function handleSubmit() {
    if (userRating === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const saveRes = await fetch(`/api/v1/hunts/${huntId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: userRating, review_text: reviewText || null }),
      });
      if (!saveRes.ok) {
        const body = await saveRes.json().catch(() => null);
        setSubmitError(body?.error || "We couldn't save your rating. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitError("We couldn't save your rating. Check your connection and try again.");
      return;
    } finally {
      setSubmitting(false);
    }

    // Refresh the average. The rating is already saved, so a failure here is harmless.
    try {
      const res = await fetch(`/api/v1/hunts/${huntId}/rate`);
      if (!res.ok) return;
      const d = await res.json();
      setAvgRating(d.avg_rating);
      setTotalRatings(d.total_ratings || 0);
    } catch { /* keep the previous average */ }
  }

  const displayRating = hoverRating || userRating;

  return (
    <section aria-label="Ratings" className="rounded-[18px] border border-themed-border bg-surface p-4">
      {/* Average rating display */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={`w-4 h-4 ${avgRating && star <= Math.round(avgRating) ? "fill-current text-warning" : "text-themed-border"}`}
            />
          ))}
        </div>
        {avgRating ? (
          <span className="text-sm tabular-nums text-themed-muted">{avgRating} ({totalRatings} rating{totalRatings !== 1 ? "s" : ""})</span>
        ) : (
          <span className="text-sm text-themed-muted">No ratings yet</span>
        )}
      </div>

      {/* User rating input */}
      {!submitted ? (
        <div>
          <p className="text-sm font-medium text-themed-text">Rate this hunt:</p>
          <div className="-ml-2.5 mb-2 flex items-center">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setUserRating(star)}
                aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
                aria-pressed={userRating === star}
                className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-themed-bg"
              >
                <Star
                  className={`w-6 h-6 transition-colors ${star <= displayRating ? "fill-current text-warning" : "text-themed-border"}`}
                  aria-hidden="true"
                />
              </button>
            ))}
            {userRating > 0 && <span className="ml-1 text-sm tabular-nums text-themed-muted">{userRating}/5</span>}
          </div>
          {userRating > 0 && (
            <>
              <textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value.slice(0, 500))}
                placeholder="Write a short review (optional)..."
                aria-label="Review (optional)"
                rows={2}
                className="mb-2 w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:outline-none focus:ring-2 focus:ring-secondary/30"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-secondary px-4 text-sm font-semibold text-secondary transition-colors hover:bg-secondary/10 disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "Submit Rating"}
              </button>
              {submitError && (
                <p role="alert" className="mt-2 text-sm text-error">{submitError}</p>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-sm font-medium text-secondary">Thanks for rating!</p>
      )}
    </section>
  );
}
