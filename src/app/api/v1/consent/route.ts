import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import {
  AGE_ATTESTATION_KEY,
  checkResearchDateOfBirth,
  researchEligibility,
} from "@/lib/utils/research-eligibility";
import { internalError } from "@/lib/utils/internal-error";

type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** Metadata keys only the server may set on a research-consent record. */
const SERVER_ONLY_METADATA_KEYS = new Set([AGE_ATTESTATION_KEY, "age_basis", "date_of_birth_source"]);

const ADULTS_ONLY_MESSAGE = "The research study is open to adults (18 or older) only";

/**
 * Save a date of birth given in the consent dialog, but only into an empty
 * users.date_of_birth (never overwrite one on file). Returns the DOB that is
 * on file afterwards, so a concurrent write is honored rather than clobbered.
 */
async function saveDateOfBirthIfMissing(supabase: Db, userId: string, dateOfBirth: string): Promise<string | null> {
  const { data: updated, error } = await supabase
    .from("users")
    .update({ date_of_birth: dateOfBirth })
    .eq("id", userId)
    .is("date_of_birth", null)
    .select("date_of_birth");
  if (error) throw internalError("/api/v1/consent (save date_of_birth)", error);
  if (updated && updated.length > 0) return dateOfBirth;

  const { data: row, error: readError } = await supabase
    .from("users")
    .select("date_of_birth")
    .eq("id", userId)
    .maybeSingle();
  if (readError) throw new ApiError(500, "Could not check research eligibility");
  return row?.date_of_birth ?? null;
}

/**
 * Validate a research-consent decision and build the metadata stored with it.
 * Ineligible users (minors, staff, under-18 DOB) may record no research
 * decision at all. A grant requires an 18+ date of birth: the one on file, or
 * (none on file) a `date_of_birth` in the body, which is validated and saved
 * to the account. An under-18 or invalid date saves nothing and records no
 * grant. The age basis is stamped server-side (client-sent metadata cannot
 * stand in for it). Declines need no date of birth.
 */
async function researchConsentMetadata(
  supabase: Db,
  userId: string,
  role: string,
  granted: boolean,
  body: Record<string, unknown>,
  clientMetadata: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data: row, error } = await supabase
    .from("users")
    .select("role, date_of_birth")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Could not check research eligibility");

  const subjectRole = row?.role ?? role;
  const eligibility = researchEligibility({ role: subjectRole, date_of_birth: row?.date_of_birth ?? null });
  if (!eligibility.eligible) throw new ApiError(403, ADULTS_ONLY_MESSAGE);

  const rest = Object.fromEntries(
    Object.entries(clientMetadata).filter(([key]) => !SERVER_ONLY_METADATA_KEYS.has(key))
  );
  if (!granted) return rest;

  if (eligibility.ageBasis === "date_of_birth") {
    return { ...rest, age_basis: "date_of_birth", date_of_birth_source: "account" };
  }

  // No date of birth on file: one must be given now.
  if (body.date_of_birth === undefined || body.date_of_birth === null || body.date_of_birth === "") {
    throw new ApiError(400, "Please enter your date of birth to take part");
  }
  const check = checkResearchDateOfBirth(body.date_of_birth);
  if (!check.ok) {
    throw check.reason === "under_18"
      ? new ApiError(403, ADULTS_ONLY_MESSAGE)
      : new ApiError(400, "Please enter a valid date of birth");
  }

  const onFile = await saveDateOfBirthIfMissing(supabase, userId, check.dateOfBirth);
  const recheck = researchEligibility({ role: subjectRole, date_of_birth: onFile });
  if (!recheck.eligible || recheck.ageBasis !== "date_of_birth") throw new ApiError(403, ADULTS_ONLY_MESSAGE);
  const source = onFile === check.dateOfBirth ? "consent_form" : "account";
  return { ...rest, age_basis: "date_of_birth", date_of_birth_source: source };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const consent = await supabase
      .from("consent_records")
      .select("*")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    return Response.json({
      consent_records: consent.data || [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    // Record consent
    if (body.consent_type) {
      // COPPA: only parents/teachers/admins can create parental consent records
      if (body.consent_type === "parental") {
        if (!["parent", "teacher", "admin"].includes(user.role)) {
          throw new ApiError(403, "Only parents, teachers, or admins can grant parental consent");
        }
      }

      // Children cannot create any consent records for themselves
      if (["child"].includes(user.role) && body.consent_type !== "terms") {
        throw new ApiError(403, "Consent must be granted by a parent or teacher");
      }

      const granted = body.granted ?? true;
      const clientMetadata =
        body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : {};
      let metadata: Record<string, unknown> = clientMetadata;

      // The study is adults-only. Eligibility is decided here, on the server,
      // from the stored role and date of birth — never from the request.
      if (body.consent_type === "research") {
        metadata = await researchConsentMetadata(supabase, user.id, user.role, granted, body, clientMetadata);
      }

      const { data, error } = await supabase
        .from("consent_records")
        .insert({
          user_id: user.id,
          consent_type: body.consent_type,
          form_version: body.form_version || "1.0",
          granted,
          signature_name: body.signature_name || null,
          ip_address: request.headers.get("x-forwarded-for") || null,
          metadata,
        })
        .select()
        .single();

      if (error) throw internalError("/api/v1/consent", error);
      return Response.json({ consent: data }, { status: 201 });
    }

    throw new ApiError(400, "Provide consent_type");
  } catch (error) {
    return errorResponse(error);
  }
}
