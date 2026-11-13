import { formatDistance } from "@/lib/play/arrival-check";

/** Why the player is being offered a photo check-in instead of GPS. */
export type PhotoCheckInReason = "no_gps" | "weak_gps";

export type CheckInOutcome =
  | { kind: "arrived" }
  | { kind: "too_far"; message: string }
  | { kind: "photo"; reason: PhotoCheckInReason }
  | { kind: "failed"; message: string };

interface ArriveReply {
  arrived?: unknown;
  reason?: unknown;
  photo_allowed?: unknown;
  distance?: unknown;
}

const RETRY = "We couldn't check you in at this stop. Please try again.";

/** Turns the arrive endpoint's reply to "I'm here" into what the screen does next. */
export function interpretCheckIn(reply: ArriveReply): CheckInOutcome {
  if (reply.arrived === true) return { kind: "arrived" };
  if (reply.photo_allowed === true && (reply.reason === "no_gps" || reply.reason === "weak_gps")) {
    return { kind: "photo", reason: reply.reason };
  }
  if (reply.reason === "too_far") {
    const where =
      typeof reply.distance === "number" && Number.isFinite(reply.distance)
        ? `You're ${formatDistance(reply.distance)} from this stop.`
        : "You're not at this stop yet.";
    return { kind: "too_far", message: `${where} Get closer, then tap "I'm here" again.` };
  }
  return { kind: "failed", message: RETRY };
}

export const PHOTO_CHECK_IN_COPY: Record<PhotoCheckInReason, string> = {
  no_gps: "We can't see your location, so take a photo at the stop to check in instead.",
  weak_gps: "Your GPS signal is too weak to confirm you're here. Take a photo at the stop to check in instead.",
};
