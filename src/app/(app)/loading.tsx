// Shown inside the app chrome while a signed-in page's server work resolves.
// Same pulse-block skeleton the feature pages use for their own loading states.
export default function AppLoading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6" aria-busy="true">
      <p className="sr-only" role="status">
        Loading…
      </p>
      <div className="fm-shimmer space-y-4" aria-hidden="true">
        <div className="h-8 w-40 rounded-xl bg-gray-100" />
        <div className="h-24 rounded-2xl bg-gray-100" />
        <div className="h-24 rounded-2xl bg-gray-100" />
        <div className="h-24 rounded-2xl bg-gray-100" />
      </div>
    </main>
  );
}
