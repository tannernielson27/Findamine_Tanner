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
