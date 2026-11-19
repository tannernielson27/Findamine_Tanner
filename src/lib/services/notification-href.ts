/**
 * Where tapping a bell notification goes, by `notifications.type` and the
 * row's entity columns. Null means the notification is not a link (tapping it
 * only marks it read). Pure: unit tested directly.
 */

import { CHECKIN_TARGET_PATH, PRIVACY_CHECKIN_TYPE } from "@/lib/services/privacy-checkin";
import { REENGAGEMENT_TYPE, reengagementHref } from "@/lib/services/reengagement";
import { HUNT_ENDING_TYPE, HUNT_RELEASE_TYPE, huntNoticeHref } from "@/lib/services/hunt-schedule-notices";
import { CREW_JOINED_TYPE, FOLLOWS_PAGE_PATH, NEW_FOLLOWER_TYPE } from "@/lib/social/follow-rules";

/** `notifications.type` written by the survey reminder cron (survey-delivery.ts). */
export const SURVEY_REMINDER_TYPE = "survey_reminder";
/** `notifications.type` written when a Qualtrics survey opens (qualtrics-surveys.ts). */
export const STUDY_SURVEY_TYPE = "study_survey";

export interface LinkableNotification {
  type: string;
  entity_type?: string | null;
  entity_id?: string | null;
}

export function notificationHref(n: LinkableNotification): string | null {
  switch (n.type) {
    case SURVEY_REMINDER_TYPE:
      return "/surveys";
    case STUDY_SURVEY_TYPE:
      // The study page has the Qualtrics link and Study ID.
      return "/settings/study";
    case PRIVACY_CHECKIN_TYPE:
      return CHECKIN_TARGET_PATH;
    case REENGAGEMENT_TYPE:
      return reengagementHref(n.entity_type ?? null, n.entity_id ?? null);
    // Scheduled hunts: a release or "ends soon" opens that hunt's play screen.
    case HUNT_RELEASE_TYPE:
    case HUNT_ENDING_TYPE:
      return huntNoticeHref(n.entity_type ?? null, n.entity_id ?? null);
    // A new follower opens the page that lists who follows you.
    // A new crew member opens the same page, where they can be approved.
    case NEW_FOLLOWER_TYPE:
    case CREW_JOINED_TYPE:
      return FOLLOWS_PAGE_PATH;
    default:
      return null;
  }
}
