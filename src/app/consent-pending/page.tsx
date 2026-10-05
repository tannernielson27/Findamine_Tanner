import SignOutButton from "@/app/login/sign-out-button";

export default function ConsentPendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="text-5xl">🔒</div>
        <h1 className="text-xl font-bold text-gray-900">Almost there!</h1>
        <p className="text-gray-600">
          Your account is waiting for a parent or teacher to verify it.
          Once they approve, you&apos;ll be ready to start exploring!
        </p>
        <div className="rounded-lg bg-blue-50 p-4 text-left">
          <p className="text-sm text-blue-800 font-medium mb-1">What happens next?</p>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>Your parent or teacher will receive a verification link</li>
            <li>Once they click it, your account will be activated</li>
            <li>Then you can start playing hunts!</li>
          </ul>
        </div>
        {/* Signing out (not a plain link) because a signed-in visitor to
            /login is sent straight back here. */}
        <div>
          <SignOutButton
            label="Sign out or use a different account"
            className="inline-block text-sm text-sky-600 hover:underline disabled:opacity-50"
          />
        </div>
      </div>
    </main>
  );
}
