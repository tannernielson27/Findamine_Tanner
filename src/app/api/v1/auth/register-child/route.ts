import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { assertCleanText } from "@/lib/moderation/guard";
import crypto from "crypto";
import { sendConsentVerificationEmail } from "@/lib/services/email";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "parent", "teacher", "admin");

    const body = await request.json();
    const { email, password, display_name, date_of_birth } = body;

    if (!display_name) {
      throw new ApiError(400, "Display name is required for child accounts");
    }
    // Child accounts get the strict filter (teens created here are filtered at
    // the same level: a parent/teacher is choosing the name for a minor).
    assertCleanText(String(display_name), { role: "child", label: "That display name" });

    // Determine role from date of birth
    let role = "child";
    if (date_of_birth) {
      const age = Math.floor(
        (Date.now() - new Date(date_of_birth).getTime()) /
          (365.25 * 24 * 60 * 60 * 1000)
      );
      if (age >= 13) role = "teen";
    }

    const supabase = await createSupabaseServiceClient();

    // Create auth user (children may not have email)
    const childEmail =
      email || `${display_name.toLowerCase().replace(/\s+/g, "")}_${Date.now()}@child.findamine.app`;

    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: childEmail,
        password: password || Math.random().toString(36).slice(2) + "Aa1!",
        email_confirm: true, // Skip email verification for children
      });

    if (authError) {
      throw new ApiError(400, authError.message);
    }

    // Create app user row — children start as pending_consent (COPPA)
    const childStatus = role === "child" ? "pending_consent" : "active";

    const { data: child, error: userError } = await supabase
      .from("users")
      .insert({
        auth_id: authData.user.id,
        email: childEmail,
        display_name,
        role,
        status: childStatus,
        date_of_birth: date_of_birth || null,
        parent_id: user.id,
      })
      .select()
      .single();

    if (userError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw new ApiError(500, "Failed to create child profile");
    }

    // Create parent_child_links row
    await supabase.from("parent_child_links").insert({
      parent_id: user.id,
      child_id: child.id,
      relationship_type: user.role === "teacher" ? "teacher" : "parent",
      verified: false,
    });

    // For children (under 13): create consent record with verification token
    let verificationToken: string | null = null;

    if (role === "child") {
      verificationToken = crypto.randomBytes(32).toString("hex");

      await supabase.from("consent_records").insert({
        user_id: user.id, // The parent granting consent
        child_id: child.id,
        consent_type: "parental",
        form_version: "1.0",
        granted: false, // Not yet verified
        verification_token: verificationToken,
        ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        metadata: {
          child_name: display_name,
          child_role: role,
          parent_role: user.role,
        },
      });

      // Send verification email to parent
      // Get parent's email for the consent email
      const { data: parentProfile } = await supabase
        .from("users")
        .select("email, display_name")
        .eq("id", user.id)
        .single();

      if (parentProfile?.email) {
        await sendConsentVerificationEmail({
          parentEmail: parentProfile.email,
          parentName: parentProfile.display_name,
          childName: display_name,
          childId: child.id,
          verificationToken,
        });
      }
    }

    return Response.json(
      {
        child: {
          id: child.id,
          display_name: child.display_name,
          role: child.role,
          status: childStatus,
        },
        requires_consent: role === "child",
        verification_sent: !!verificationToken, // Token sent via email only — not exposed in API response
        message: role === "child"
          ? "Child account created. Parental consent verification is required before the child can use the app."
          : "Teen account created and ready to use.",
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
