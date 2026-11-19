/**
 * Strips answer keys from finds before they are sent to players.
 *
 * Grading happens server-side in the play answer route, so only the people who
 * can edit a hunt need the keys in the browser.
 */

const ANSWER_KEY_FIELDS = ["correct_answer", "correct_order", "partial_answers"];

const MANAGER_ROLES = ["admin", "researcher"];

interface Viewer {
  id: string;
  role: string;
}

interface FindWithTask {
  tasks?: { content?: Record<string, unknown> | null } | null;
}

export function canSeeAnswerKeys(viewer: Viewer | null, huntCreatedBy: string | null): boolean {
  if (!viewer) return false;
  return viewer.id === huntCreatedBy || MANAGER_ROLES.includes(viewer.role);
}

export function redactContent(content: Record<string, unknown>): Record<string, unknown> {
  const redacted = Object.fromEntries(
    Object.entries(content).filter(([key]) => !ANSWER_KEY_FIELDS.includes(key))
  );
  // The editor stores sorting items in the correct order, so the list itself
  // is the key. Hand it over sorted; the play client shuffles for display.
  if (Array.isArray(content.items)) {
    redacted.items = [...content.items].sort((a, b) => String(a).localeCompare(String(b)));
  }
  return redacted;
}

export function redactAnswerKeys<T extends FindWithTask>(finds: T[]): T[] {
  return finds.map((find) =>
    find.tasks?.content
      ? { ...find, tasks: { ...find.tasks, content: redactContent(find.tasks.content) } }
      : find
  );
}

/** All a hunt API tells a non-editor about a stop: that it exists, and the creator's order. */
export interface StopStub {
  id: string;
  sort_order: number;
}

/**
 * A hunt's stops as the hunt APIs may send them to this viewer.
 *
 * The people who can edit the hunt (owner, admins, researchers) get every
 * field. Everyone else gets ids and order only: clues, hints, places,
 * challenges and primers are spoilers, and since issue #16 a player receives a
 * stop's details from the play API alone, once they have started that stop
 * (GET /api/v1/play/[huntId]/stops).
 */
export function findsForViewer<T extends StopStub>(
  finds: T[],
  viewer: Viewer | null,
  huntCreatedBy: string | null
): T[] | StopStub[] {
  if (canSeeAnswerKeys(viewer, huntCreatedBy)) return finds;
  return finds.map((find) => ({ id: find.id, sort_order: find.sort_order }));
}
