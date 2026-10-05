import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";

const ALLOWED_TABLES = ["threat_scores", "threat_classifications", "blocked_ips"] as const;

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const table = new URL(request.url).searchParams.get("table") as typeof ALLOWED_TABLES[number];
    if (!table || !ALLOWED_TABLES.includes(table)) {
      throw new ApiError(400, `table must be one of: ${ALLOWED_TABLES.join(", ")}`);
    }

    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) throw new ApiError(500, error.message);
    if (!data || data.length === 0) {
      // 204 must not carry a body: `new Response("No data", { status: 204 })` throws.
      return new Response(null, { status: 204 });
    }

    // Build CSV with formula injection protection
    const headers = Object.keys(data[0]);
    const rows = data.map((row) =>
      headers.map((h) => {
        let val = String(row[h] ?? "");
        // Escape formula injection
        if (/^[=+\-@\t\r]/.test(val)) val = `'${val}`;
        // Escape quotes
        if (val.includes('"') || val.includes(",") || val.includes("\n")) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const filename = `${table}_${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
