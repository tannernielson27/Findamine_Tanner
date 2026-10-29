import { HuntCardSkeleton } from "@/components/ui/hunt-card";

/**
 * Explore skeleton: the real header, then card placeholders that match the
 * "full" card exactly. The placeholders fade in only after ~300ms so a fast
 * load never flashes them.
 */
export default function ExploreLoading() {
  return (
    <main className="fm-tab-safe-mini mx-auto w-full max-w-5xl pt-5" aria-busy="true">
      <style>{`@keyframes fm-explore-delayed{to{opacity:1}}.fm-explore-delayed{opacity:0;animation:fm-explore-delayed 150ms ease-out 300ms forwards}`}</style>
      <p role="status" className="sr-only">Loading hunts</p>
      <header className="px-4 pb-1.5">
        <h1 className="font-[family-name:var(--font-display)] text-[32px] font-semibold leading-[1.1] text-themed-text">Explore</h1>
      </header>
      <div className="fm-explore-delayed px-4" aria-hidden="true">
        <div className="mt-3.5 h-[52px] rounded-full border border-themed-border bg-surface" />
        <div className="mt-3.5 flex gap-2 overflow-hidden">
          {[88, 120, 84, 150, 70].map((w) => (
            <div key={w} className="h-11 shrink-0 rounded-full border border-themed-border bg-surface" style={{ width: w }} />
          ))}
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <HuntCardSkeleton />
          <HuntCardSkeleton />
          <HuntCardSkeleton />
        </div>
      </div>
    </main>
  );
}
