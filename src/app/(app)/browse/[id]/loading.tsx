/** Hunt detail skeleton: hero, overlapping content card, stat row. Fades in after ~300ms. */
export default function HuntDetailLoading() {
  return (
    <main aria-busy="true">
      <style>{`@keyframes fm-detail-delayed{to{opacity:1}}.fm-detail-delayed{opacity:0;animation:fm-detail-delayed 150ms ease-out 300ms forwards}`}</style>
      <p role="status" className="sr-only">Loading hunt</p>
      <div className="fm-detail-delayed" aria-hidden="true">
        <div className="fm-shimmer h-[300px] bg-divider" />
        <div className="relative mx-auto -mt-7 flex max-w-3xl flex-col gap-[22px] rounded-t-[28px] bg-themed-bg px-5 pt-6">
          <div className="flex gap-2">
            <div className="h-7 w-16 rounded-full bg-divider" />
            <div className="h-7 w-20 rounded-full bg-divider" />
          </div>
          <div className="h-9 w-3/4 rounded-lg bg-divider" />
          <div className="h-[78px] rounded-[18px] border border-themed-border bg-surface" />
          <div className="flex flex-col gap-2">
            <div className="h-6 w-24 rounded-md bg-divider" />
            <div className="h-4 w-full rounded-md bg-divider" />
            <div className="h-4 w-5/6 rounded-md bg-divider" />
          </div>
        </div>
      </div>
    </main>
  );
}
