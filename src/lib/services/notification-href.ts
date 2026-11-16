/**
 * Where tapping a bell notification goes, by `notifications.type` and the
 * row's entity columns. Null means the notification is not a link (tapping it
 * only marks it read). Pure: unit tested directly.
 */

import { CHECKIN_TARGET_PATH, PRIVACY_CHECKIN_TYPE } from "@/lib/services/privacy-checkin";
import { REENGAGEMENT_TYPE, reengagementHref } from "@/lib/services/reengagement";

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
    default:
      return null;
  }
}
