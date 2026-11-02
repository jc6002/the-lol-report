export default function StudyRouteLoading() {
  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      role="status"
      aria-live="polite"
      aria-label="Loading study report"
    >
      <div className="sticky top-0 z-40 h-14 w-full border-b border-[var(--surface-border)] bg-[var(--surface)] px-4 py-2.5 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-300/60 dark:bg-slate-700/60" />
            <div className="hidden h-4 w-32 animate-pulse rounded bg-slate-300/60 sm:block dark:bg-slate-700/60" />
          </div>
          <div className="hidden h-9 w-full max-w-md animate-pulse rounded-lg bg-slate-300/50 md:block dark:bg-slate-800/60" />
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-300/50 dark:bg-slate-800/60" />
            <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-300/50 dark:bg-slate-800/60" />
          </div>
        </div>
      </div>

      <main className="page-shell flex-1 p-4 text-foreground sm:p-6">
        <section className="app-panel mx-auto w-full max-w-7xl space-y-5 rounded-2xl p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="h-3 w-20 animate-pulse rounded bg-slate-300/60 dark:bg-slate-700/60" />
              <div className="h-7 w-64 animate-pulse rounded-lg bg-slate-300/60 dark:bg-slate-700/60" />
              <div className="h-3 w-44 animate-pulse rounded bg-slate-300/45 dark:bg-slate-800/60" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-9 w-56 animate-pulse rounded-lg bg-slate-300/55 dark:bg-slate-800/60" />
              <div className="h-9 w-44 animate-pulse rounded-lg bg-slate-300/50 dark:bg-slate-800/60" />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="h-10 w-72 animate-pulse rounded-xl bg-slate-300/50 dark:bg-slate-800/60" />
            <div className="h-9 w-36 animate-pulse rounded-lg bg-slate-300/45 dark:bg-slate-800/60" />
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className="app-card space-y-2 rounded-xl p-4">
                <div className="h-3 w-24 animate-pulse rounded bg-slate-300/60 dark:bg-slate-700/60" />
                <div className="h-7 w-28 animate-pulse rounded bg-slate-300/60 dark:bg-slate-700/60" />
                <div className="h-3 w-36 animate-pulse rounded bg-slate-300/45 dark:bg-slate-800/60" />
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="app-chart-card h-64 animate-pulse rounded-xl p-4" />
            <div className="app-chart-card h-64 animate-pulse rounded-xl p-4" />
          </div>

          <div className="app-table-shell space-y-3 rounded-xl p-4">
            {[0, 1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className="h-10 w-full animate-pulse rounded-lg bg-slate-300/40 dark:bg-slate-800/50"
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
