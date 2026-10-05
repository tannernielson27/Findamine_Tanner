import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * audit_log (migration 004) constrains `action` to create | update | delete and
 * types `entity_id` as UUID. The threat routes used to write actions such as
 * "block_ip" with an ip hash as the entity id, so every row was rejected and —
 * the error being unchecked — silently dropped. The specific operation now
 * goes in new_values.op.
 */
export interface AuditEntry {
  user_id: string;
  action: "create" | "update" | "delete";
  entity_type: string;
  /** Must be a UUID (the affected row's id). */
  entity_id: string;
  new_values?: Record<string, unknown> | null;
  old_values?: Record<string, unknown> | null;
}

/**
 * Best-effort audit write: the admin action it records has already succeeded,
 * so a failure here is logged for the operator rather than failing the request.
 */
export async function writeAudit(supabase: ServiceClient, entry: AuditEntry): Promise<boolean> {
  const { error } = await supabase.from("audit_log").insert(entry);
  if (error) {
    console.error(`audit_log write failed (${entry.entity_type}/${entry.action}):`, error.message);
    return false;
  }
  return true;
}
