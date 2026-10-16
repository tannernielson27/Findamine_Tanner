import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import type { AuthUser } from "@/lib/types/database";
import type { UserRole } from "@/lib/types/enums";
import { checkText, jsonStrings } from "@/lib/hunts/text-filter";

/** Roles that may edit or delete rows they did not create, and curate the shared library. */
const CURATOR_ROLES: UserRole[] = ["admin", "researcher"];
/** Marks a row as part of the library every creator sees; only curators may set it. */
const LIBRARY_FLAG = "is_library";

function isCurator(user: AuthUser): boolean {
  return CURATOR_ROLES.includes(user.role);
}

/** Reject a write whose player-visible text contains blocked language (400). */
export function assertCleanFields(row: Record<string, unknown>, textFields: string[]): void {
  for (const field of textFields) {
    if (checkText(jsonStrings(row[field]).join("\n")).flagged) {
      throw new ApiError(400, `The ${field.replace(/_/g, " ")} contains language that isn't allowed on Findamine.`);
    }
  }
}

/** Copy only whitelisted fields from a request body. */
function pickFields(body: unknown, allowed: string[], user: AuthUser): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }
  const source = body as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of allowed) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  if (LIBRARY_FLAG in picked) {
    // Strictly boolean: Postgres would coerce "true" / 1 to true, so a truthy
    // non-boolean must never reach the query.
    if (typeof picked[LIBRARY_FLAG] !== "boolean") {
      throw new ApiError(400, `${LIBRARY_FLAG} must be true or false`);
    }
    if (picked[LIBRARY_FLAG] && !isCurator(user)) {
      throw new ApiError(403, "Only an admin can add items to the shared library");
    }
  }
  return picked;
}

/**
 * Generic CRUD route factory for simple tables (tasks, primers, standards).
 * Reduces boilerplate across similar endpoints.
 */
export function createCrudHandlers(
  table: string,
  options: {
    writeRoles?: UserRole[];
    allowedInsertFields: string[];
    ownerColumn?: string;
    /** Player-visible fields screened by the content filter on write. */
    textFields?: string[];
  }
) {
  const {
    writeRoles = ["teacher", "hunt_creator", "admin", "researcher"],
    allowedInsertFields,
    ownerColumn = "created_by",
    textFields = [],
  } = options;

  async function GET(request: NextRequest) {
    try {
      const user = await getAuthUser(request);
      if (!user) throw new ApiError(401, "Not authenticated");

      const { searchParams } = new URL(request.url);
      const library = searchParams.get("library");
      const limit = parseInt(searchParams.get("limit") || "100");

      const supabase = await createSupabaseServiceClient();

      let query = supabase
        .from(table)
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (library === "true") {
        query = query.eq("is_library", true);
      }

      const { data, error } = await query;
      if (error) throw new ApiError(500, error.message);

      return Response.json({ [table]: data });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function POST(request: NextRequest) {
    try {
      const user = await getAuthUser(request);
      requireRole(user, ...writeRoles);

      const body = await request.json().catch(() => null);
      const supabase = await createSupabaseServiceClient();

      const insert: Record<string, unknown> = {
        ...pickFields(body, allowedInsertFields, user),
        [ownerColumn]: user.id,
      };
      assertCleanFields(insert, textFields);

      const { data, error } = await supabase
        .from(table)
        .insert(insert)
        .select()
        .single();

      if (error) throw new ApiError(500, error.message);

      return Response.json({ [table.replace(/s$/, "")]: data }, { status: 201 });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { GET, POST };
}

export function createItemHandlers(
  table: string,
  options: {
    writeRoles?: UserRole[];
    allowedUpdateFields: string[];
    ownerColumn?: string;
    /** Player-visible fields screened by the content filter on write. */
    textFields?: string[];
  }
) {
  const {
    writeRoles = ["teacher", "hunt_creator", "admin", "researcher"],
    allowedUpdateFields,
    ownerColumn = "created_by",
    textFields = [],
  } = options;

  /**
   * The service client bypasses RLS, so ownership is enforced here: only the
   * creator (or a curator) may change a row. Library rows seeded without a
   * creator are therefore read-only for everyone but curators.
   */
  async function assertCanModify(
    supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
    id: string,
    user: AuthUser,
    action: "edit" | "delete"
  ): Promise<void> {
    const { data: existing, error } = await supabase
      .from(table)
      .select(ownerColumn)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new ApiError(500, error.message);
    if (!existing) throw new ApiError(404, "Not found");
    if (isCurator(user)) return;
    if ((existing as unknown as Record<string, unknown>)[ownerColumn] !== user.id) {
      throw new ApiError(403, `Not authorized to ${action} this item`);
    }
  }

  async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const user = await getAuthUser(request);
      if (!user) throw new ApiError(401, "Not authenticated");

      const { id } = await params;
      const supabase = await createSupabaseServiceClient();

      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (error || !data) throw new ApiError(404, `${table} item not found`);

      return Response.json({ [table.replace(/s$/, "")]: data });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const { id } = await params;
      const user = await getAuthUser(request);
      requireRole(user, ...writeRoles);

      const body = await request.json().catch(() => null);
      const supabase = await createSupabaseServiceClient();

      const updates = pickFields(body, allowedUpdateFields, user);
      if (Object.keys(updates).length === 0) {
        throw new ApiError(400, "No updatable fields provided");
      }
      assertCleanFields(updates, textFields);

      await assertCanModify(supabase, id, user, "edit");

      const { data, error } = await supabase
        .from(table)
        .update(updates)
        .eq("id", id)
        .is("deleted_at", null)
        .select()
        .single();

      if (error) throw new ApiError(500, error.message);

      return Response.json({ [table.replace(/s$/, "")]: data });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const { id } = await params;
      const user = await getAuthUser(request);
      requireRole(user, ...writeRoles);

      const supabase = await createSupabaseServiceClient();

      await assertCanModify(supabase, id, user, "delete");

      const { error } = await supabase
        .from(table)
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw new ApiError(500, error.message);

      return Response.json({ message: "Deleted" });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { GET, PUT, DELETE };
}
