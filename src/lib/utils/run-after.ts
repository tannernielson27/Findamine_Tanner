import { after } from "next/server";
import { logger } from "@/lib/utils/logger";

/**
 * Run non-critical work (logging, analytics, referral payouts) after the
 * response has been sent. Never throws and never rejects: failures are logged.
 *
 * Outside a Next request scope (unit tests, scripts) `after()` throws; in that
 * case the work simply runs immediately as fire-and-forget.
 */
export function runAfter(label: string, work: () => Promise<unknown> | unknown): void {
  const guarded = async () => {
    try {
      await work();
    } catch (error) {
      logger.error(`after.${label}_failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
