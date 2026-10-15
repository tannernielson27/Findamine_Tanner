import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/services/auth-emails";
import LoginForm, { type LoginNotice } from "./login-form";
import SignOutButton from "./sign-out-button";

type Param = string | string[] | undefined;

function first(value: Param): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveNotice(error: string | undefined, notice: string | undefined): LoginNotice {
  if (notice === "confirmed") return "confirmed";
  if (error === "confirm_link_invalid" || error === "link_invalid") return "link_invalid";
  if (error === "auth_callback_failed") return "callback_failed";
  return null;
}

/** Same-origin paths only, and never back to the signed-out-only pages. */
function resolveNext(raw: string | undefined): string {
  const next = safeNextPath(raw, "/dashboard");
  return /^\/(login|register)(\/|\?|$)/.test(next) ? "/dashboard" : next;
}

type AccountState = "signed_out" | "ready" | "no_profile" | "unavailable";

async function getAccountState(): Promise<AccountState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return "signed_out";

  const serviceClient = await createSupabaseServiceClient();
  const { data: profile, error } = await serviceClient
    .from("users")
    .select("id")
    .eq("auth_id", authUser.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (profile) return "ready";
  return error ? "unavailable" : "no_profile";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: Param; error?: Param; notice?: Param }>;
}) {
  const params = await searchParams;
  const next = resolveNext(first(params.next));

  const account = await getAccountState();
  // Already signed in: nothing to do here.
  if (account === "ready") redirect(next);

  if (account === "no_profile" || account === "unavailable") {
    // Signed in, but the app can't use this session. Pages in the app send
    // such sessions here, so say what happened instead of looping silently.
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FEFCF6] px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white border border-gray-100 shadow-sm p-6 text-center space-y-4">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-gray-900">
            {account === "no_profile" ? "We couldn't find your account" : "We couldn't load your account"}
          </h1>
          <p className="text-sm text-gray-600">
            {account === "no_profile"
              ? "You're signed in, but there is no findamine profile for this login. It may have been removed, or sign-up didn't finish. Sign out and create a new account, or contact your instructor or organizer if you think this is a mistake."
              : "You're signed in, but we had trouble loading your profile just now. Please try again in a moment."}
          </p>
          {account === "unavailable" && (
            <Link
              href={next}
              className="block w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark transition"
            >
              Try again
            </Link>
          )}
          <SignOutButton
            label={account === "no_profile" ? "Sign out" : "Sign out instead"}
            className={
              account === "no_profile"
                ? "w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 transition"
                : "text-sm font-medium text-brand hover:underline disabled:opacity-50"
            }
          />
        </div>
      </main>
    );
  }

  return <LoginForm next={next} notice={resolveNotice(first(params.error), first(params.notice))} />;
}
