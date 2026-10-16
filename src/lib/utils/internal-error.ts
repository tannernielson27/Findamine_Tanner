import { ApiError } from "./api-auth";
import { logger } from "./logger";

/**
 * A 500 for an unexpected database/storage failure. The underlying message
 * (table names, constraint names, SQL details) is logged server-side and
 * never sent to the client.
 */
export function internalError(
  context: string,
  error: { message?: string; code?: string } | null | undefined,
  publicMessage = "Something went wrong. Please try again."
): ApiError {
  logger.error("api.internal_error", { context, code: error?.code, error: error?.message });
  return new ApiError(500, publicMessage);
}
