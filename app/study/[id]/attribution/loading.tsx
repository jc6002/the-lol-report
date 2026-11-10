function StudioViewLoadingSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-screen flex-col bg-background"
    >
      <div className="h-14 border-b border-slate-200/70 bg-white/75 dark:border-slate-800/70 dark:bg-slate-950/75" />
      <main className="page-shell flex-1 p-4 text-foreground sm:p-6">
        <section className="app-panel mx-auto w-full max-w-7xl space-y-5 rounded-2xl p-5 sm:p-6">
          <div className="space-y-2.5">
            <div className="h-4 w-24 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
            <div className="h-7 w-72 max-w-full animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800" />
            <div className="h-9 w-80 max-w-full animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/80" />
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, idx) => (
              <div
                key={idx}
                className="app-card h-24 animate-pulse rounded-xl p-3 sm:p-4"
              />
            ))}
          </div>
          <div className="app-card h-80 animate-pulse rounded-xl p-4" />
          <span className="sr-only">Loading study attribution data...</span>
        </section>
      </main>
    </div>
  );
}

export default StudioViewLoadingSkeleton;
