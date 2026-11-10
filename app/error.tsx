"use client";

import Link from "next/link";

export default function RootError({
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
          The LOL Report
        </p>
        <h1 className="text-xl font-semibold">Unable to load this view</h1>
        <p className="app-muted text-sm">
          {error.message || "An unexpected error occurred while loading benchmark data."}
        </p>
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="app-button-primary inline-flex h-9 cursor-pointer items-center rounded-lg px-4 text-sm font-semibold transition"
          >
            Try again
          </button>
          <Link
            href="/"
            className="app-button inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition"
          >
            Back to Study Hub
          </Link>
        </div>
      </section>
    </main>
  );
}
