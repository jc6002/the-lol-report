"use client";

import Link from "next/link";

export default function StudyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page-shell flex min-h-screen items-center justify-center p-4 text-foreground sm:p-6">
      <section className="app-panel w-full max-w-lg space-y-4 rounded-2xl p-6">
        <p className="app-kicker text-xs font-semibold uppercase tracking-wide">
          Attribution Studio
        </p>
        <h1 className="text-xl font-semibold">Unable to load study data</h1>
        <p className="app-muted text-sm">
          {error.message || "A network or query error interrupted this study view."}
        </p>
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="app-button-primary inline-flex h-9 cursor-pointer items-center rounded-lg px-4 text-sm font-semibold transition"
          >
            Retry study
          </button>
          <Link
            href="/"
            className="app-button inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition"
          >
            ← Study Hub
          </Link>
        </div>
      </section>
    </main>
  );
}
