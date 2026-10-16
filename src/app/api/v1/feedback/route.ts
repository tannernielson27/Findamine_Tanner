import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";
import { internalError } from "@/lib/utils/internal-error";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const { searchParams } = new URL(request.url);
    const templates = searchParams.get("templates");

    const supabase = await createSupabaseServiceClient();

    if (templates === "true") {
      requireRole(user, "teacher", "admin");
      const { data } = await supabase
        .from("feedback_templates")
        .select("*")
        .order("category", { ascending: true });
      return Response.json({ templates: data || [] });
    }

    // User's feedback history
    const { data } = await supabase
      .from("feedback_history")
      .select("*, feedback_templates(name, category)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    return Response.json({ feedback: data || [] });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "admin");
    await generalLimiter.check(request, user.id);

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    // Create template
    if (body.template) {
      const { data, error } = await supabase
        .from("feedback_templates")
        .insert({
          name: body.template.name,
          category: body.template.category || null,
          template_text: body.template.template_text,
          variables: body.template.variables || [],
        })
        .select()
        .single();

      if (error) throw internalError("/api/v1/feedback", error);
      return Response.json({ template: data }, { status: 201 });
    }

    // Record feedback
    const { data, error } = await supabase
      .from("feedback_history")
      .insert({
        user_id: body.user_id,
        template_id: body.template_id || null,
        feedback_text: body.feedback_text,
        context_type: body.context_type || null,
        context_id: body.context_id || null,
      })
      .select()
      .single();

    if (error) throw internalError("/api/v1/feedback", error);
    return Response.json({ feedback: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
