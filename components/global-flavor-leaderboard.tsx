"use client";

import { ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useDeferredValue, useMemo, useState } from "react";

import { AppSelect, type AppSelectOption } from "@/components/app-select";
import {
  formatCompactCount,
  formatHubPercent,
  formatSignedLiftPp,
  getLiftToneClassName,
} from "@/utils/attribution-ui-helpers";
import type { GlobalFlavorLeaderboardRow } from "@/utils/global-attribution-loader";

type FlavorSortMode =
  | "ci_low"
  | "lift"
  | "exposures"
  | "studies"
  | "slug";

const FLAVOR_SORT_OPTIONS: ReadonlyArray<AppSelectOption<FlavorSortMode>> = [
  { value: "ci_low", label: "Highest positive rate (95% CI)" },
  { value: "lift", label: "Best same-image lift" },
  { value: "exposures", label: "Most exposures" },
  { value: "studies", label: "Most studies" },
  { value: "slug", label: "Flavor name (A–Z)" },
];

const compareNullableDesc = (a: number | null, b: number | null): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
};

const renderRateBar = ({
  rate,
  ciLow,
  ciHigh,
}: {
  rate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
}) => {
  if (rate === null || ciLow === null || ciHigh === null) {
    return <span className="app-muted text-xs">No votes yet</span>;
  }

  const lowPct = Math.max(0, Math.min(100, ciLow * 100));
  const highPct = Math.max(lowPct, Math.min(100, ciHigh * 100));
  const pointPct = Math.max(0, Math.min(100, rate * 100));

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-end gap-2">
        <span className="font-semibold tabular-nums text-foreground">
          {formatHubPercent(rate)}
        </span>
        <span className="app-muted text-[11px] tabular-nums">
          [{formatHubPercent(ciLow)}, {formatHubPercent(ciHigh)}]
        </span>
      </div>
      <div
        aria-hidden="true"
        className="relative ml-auto h-2 w-28 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800"
      >
        <span
          className="absolute top-0 h-full rounded-full bg-teal-500/35 dark:bg-cyan-400/35"
          style={{
            left: `${lowPct}%`,
            width: `${Math.max(2, highPct - lowPct)}%`,
          }}
        />
        <span
          className="absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-teal-700 dark:bg-cyan-300"
          style={{ left: `${pointPct}%` }}
        />
      </div>
    </div>
  );
};

export function GlobalFlavorLeaderboard({
  flavors,
  unusedFlavorCount,
  initialFlavorParam,
  initialQuery = "",
  onClearEntityFocus,
}: {
  flavors: GlobalFlavorLeaderboardRow[];
  unusedFlavorCount: number;
  initialFlavorParam?: string;
  initialQuery?: string;
  onClearEntityFocus?: () => void;
}) {
  const matchedInitialFlavor = useMemo(() => {
    const trimmed = initialFlavorParam?.trim();
    if (!trimmed) {
      return null;
    }
    const lower = trimmed.toLowerCase();
    return (
      flavors.find(
        (row) =>
          row.slug.toLowerCase() === lower || String(row.flavorId) === trimmed,
      ) ?? null
    );
  }, [flavors, initialFlavorParam]);

  const [pinnedFlavorId, setPinnedFlavorId] = useState<number | null>(
    () => matchedInitialFlavor?.flavorId ?? null,
  );
  const [missingNoticeDismissed, setMissingNoticeDismissed] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [sortMode, setSortMode] = useState<FlavorSortMode>("ci_low");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() =>
    matchedInitialFlavor ? new Set([matchedInitialFlavor.flavorId]) : new Set(),
  );

  const deferredQuery = useDeferredValue(searchQuery);

  const toggleExpanded = (flavorId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(flavorId)) {
        next.delete(flavorId);
      } else {
        next.add(flavorId);
      }
      return next;
    });
  };

  const clearPinnedFlavor = () => {
    setPinnedFlavorId(null);
    setMissingNoticeDismissed(true);
    onClearEntityFocus?.();
  };

  const visibleRows = useMemo(() => {
    const trimmed = deferredQuery.trim().toLowerCase();
    const filtered = flavors.filter((row) => {
      if (pinnedFlavorId !== null) {
        return row.flavorId === pinnedFlavorId;
      }
      if (trimmed.length === 0) {
        return true;
      }
      if (row.slug.toLowerCase().includes(trimmed)) {
        return true;
      }
      if (row.description?.toLowerCase().includes(trimmed)) {
        return true;
      }
      if (row.primarySynthesisModel?.toLowerCase().includes(trimmed)) {
        return true;
      }
      if (row.pipelineSteps.some((step) => step.toLowerCase().includes(trimmed))) {
        return true;
      }
      if (
        row.studies.some(
          (study) =>
            String(study.studyId) === trimmed.replace(/^#/, "") ||
            study.studyTitle.toLowerCase().includes(trimmed) ||
            study.studySlug?.toLowerCase().includes(trimmed),
        )
      ) {
        return true;
      }
      return false;
    });

    return [...filtered].sort((left, right) => {
      if (sortMode === "lift") {
        const cmp = compareNullableDesc(left.meanLiftPp, right.meanLiftPp);
        if (cmp !== 0) return cmp;
      } else if (sortMode === "exposures") {
        if (left.exposures !== right.exposures) {
          return right.exposures - left.exposures;
        }
      } else if (sortMode === "studies") {
        if (left.studyCount !== right.studyCount) {
          return right.studyCount - left.studyCount;
        }
        if (left.exposures !== right.exposures) {
          return right.exposures - left.exposures;
        }
      } else if (sortMode === "slug") {
        return left.slug.localeCompare(right.slug);
      }

      const ciCmp = compareNullableDesc(left.ciLow, right.ciLow);
      if (ciCmp !== 0) return ciCmp;
      const rateCmp = compareNullableDesc(left.rate, right.rate);
      if (rateCmp !== 0) return rateCmp;
      if (left.exposures !== right.exposures) {
        return right.exposures - left.exposures;
      }
      return left.slug.localeCompare(right.slug);
    });
  }, [flavors, deferredQuery, pinnedFlavorId, sortMode]);

  const pinnedFlavor =
    pinnedFlavorId !== null
      ? flavors.find((row) => row.flavorId === pinnedFlavorId) ?? null
      : null;

  const showMissingNotice =
    Boolean(initialFlavorParam?.trim()) &&
    matchedInitialFlavor === null &&
    !missingNoticeDismissed;

  const renderExpandedBreakdown = (row: GlobalFlavorLeaderboardRow) => (
    <div className="space-y-3 rounded-xl border border-slate-200/75 bg-white/65 p-3.5 text-xs dark:border-slate-700/75 dark:bg-slate-950/45">
      {row.description ? (
        <p className="leading-relaxed text-foreground">{row.description}</p>
      ) : null}

      {row.pipelineSteps.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {row.pipelineSteps.map((step, index) => (
            <span
              key={`${row.flavorId}-step-${index}`}
              className="inline-flex items-center gap-1 rounded-md bg-slate-900/[0.05] px-2 py-0.5 font-mono text-[11px] text-foreground dark:bg-white/[0.08]"
            >
              <span className="app-muted">Step {index + 1}:</span>
              <span>{step}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="space-y-1.5">
        {row.studies.map((study) => (
          <div
            key={`${row.flavorId}-study-${study.studyId}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-white/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="app-muted font-mono tabular-nums">
                  #{study.studyId}
                </span>
                <span className="font-semibold text-foreground">
                  {study.studyTitle}
                </span>
                <span
                  className={
                    study.exposureMode === "swipe_navigation"
                      ? "inline-flex rounded bg-sky-500/14 px-1.5 py-0.5 text-[11px] font-medium text-slate-900 ring-1 ring-sky-500/30 dark:text-sky-100"
                      : "inline-flex rounded bg-amber-500/16 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-500/30 dark:text-amber-100"
                  }
                >
                  {study.formatDisplayLabel}
                </span>
              </div>
              <p className="app-muted mt-0.5 tabular-nums">
                {study.captionCount.toLocaleString()}{" "}
                {study.captionCount === 1 ? "caption" : "captions"} ·{" "}
                {study.exposures > 0
                  ? `${study.exposures.toLocaleString()} ${
                      study.exposureMode === "swipe_navigation"
                        ? "views"
                        : "votes"
                    } · ${formatHubPercent(study.rate)}`
                  : "0 votes yet"}
                {study.meanLiftPp !== null
                  ? ` · ${formatSignedLiftPp(study.meanLiftPp)} lift`
                  : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                href={study.attributionHref}
                className="app-button inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-medium transition"
              >
                Attribution →
              </Link>
              {study.headToHeadHref ? (
                <Link
                  href={study.headToHeadHref}
                  className="app-button inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-medium transition"
                >
                  Head-to-Head →
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3" aria-busy={deferredQuery !== searchQuery}>
      {pinnedFlavor ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-500/12 px-3.5 py-2 text-xs ring-1 ring-sky-500/30 dark:bg-cyan-300/12 dark:ring-cyan-300/25">
          <span>
            Focused on prompt flavor{" "}
            <span className="font-mono font-semibold text-foreground">
              {pinnedFlavor.slug}
            </span>{" "}
            across {pinnedFlavor.studyCount}{" "}
            {pinnedFlavor.studyCount === 1 ? "study" : "studies"}.
          </span>
          <button
            type="button"
            onClick={clearPinnedFlavor}
            className="app-button inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Show all {flavors.length} flavors
          </button>
        </div>
      ) : null}

      {showMissingNotice ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/14 px-3.5 py-2 text-xs text-amber-950 ring-1 ring-amber-500/30 dark:text-amber-100">
          <span>
            Prompt flavor &ldquo;{initialFlavorParam}&rdquo; has no study runs in
            this dataset. Showing all {flavors.length} evaluated flavors.
          </span>
          <button
            type="button"
            onClick={clearPinnedFlavor}
            className="app-button inline-flex h-7 items-center rounded-md px-2 text-xs"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="relative w-full sm:w-96">
          <Search
            aria-hidden="true"
            className="app-muted pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => {
              if (pinnedFlavorId !== null) {
                setPinnedFlavorId(null);
              }
              setSearchQuery(event.target.value);
            }}
            placeholder="Filter evaluated flavors, prompts, or models..."
            aria-label="Filter evaluated prompt flavors"
            className="app-input h-9 w-full rounded-lg pl-9 pr-3 text-sm outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AppSelect<FlavorSortMode>
            options={FLAVOR_SORT_OPTIONS}
            value={sortMode}
            onValueChange={setSortMode}
            ariaLabel="Sort prompt flavors"
            menuMinWidthPx={230}
            className="w-56 rounded-lg text-xs sm:w-60 sm:text-sm"
          />
          <span className="app-muted text-xs tabular-nums">
            {visibleRows.length} of {flavors.length} evaluated
            {unusedFlavorCount > 0
              ? ` · ${unusedFlavorCount} unmapped drafts hidden`
              : ""}
          </span>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="app-card flex flex-col items-center justify-center gap-3 rounded-xl p-6 text-center text-sm">
          <p className="app-muted">No evaluated flavors match this filter.</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              clearPinnedFlavor();
            }}
            className="app-button inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium transition"
          >
            Reset filter
          </button>
        </div>
      ) : (
        <>
          {/* Mobile < md stacked cards */}
          <div className="space-y-2.5 md:hidden">
            {visibleRows.map((row, index) => {
              const isExpanded = expandedIds.has(row.flavorId);
              return (
                <article
                  key={row.flavorId}
                  className="app-card overflow-hidden rounded-xl p-3.5"
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpanded(row.flavorId)}
                    className="flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <ChevronRight
                          aria-hidden="true"
                          className={`app-muted h-4 w-4 shrink-0 transition-transform ${
                            isExpanded ? "rotate-90 text-foreground" : ""
                          }`}
                        />
                        <span className="app-muted font-mono text-xs tabular-nums">
                          #{index + 1}
                        </span>
                        <span className="truncate font-mono text-sm font-semibold text-foreground">
                          {row.slug}
                        </span>
                      </div>
                      <p className="app-muted mt-1 line-clamp-1 pl-5 text-xs">
                        {row.primarySynthesisModel ?? "Unattributed"} ·{" "}
                        {row.studyCount}{" "}
                        {row.studyCount === 1 ? "study" : "studies"} ·{" "}
                        {row.exposures > 0
                          ? `${formatCompactCount(row.exposures)} votes/views`
                          : "0 votes yet"}
                      </p>
                    </div>

                    <div className="shrink-0 text-right tabular-nums">
                      <p className="text-sm font-semibold text-foreground">
                        {formatHubPercent(row.rate)}
                      </p>
                      <p
                        className={`text-xs font-medium ${getLiftToneClassName(
                          row.meanLiftPp,
                        )}`}
                      >
                        {row.meanLiftPp !== null
                          ? `${formatSignedLiftPp(row.meanLiftPp)} lift`
                          : row.exposures > 0
                            ? "1-flavor runs"
                            : "Staged"}
                      </p>
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="mt-3">{renderExpandedBreakdown(row)}</div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {/* Desktop >= md table */}
          <div className="app-table-shell hidden overflow-x-auto rounded-xl md:block">
            <table className="app-table min-w-full divide-y divide-slate-200/60 text-sm dark:divide-slate-700/60">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    Prompt Flavor
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    Synthesis Model
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    Studies & Captions
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    Exposures
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    Positive Rate (95% CI)
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    Same-Image Lift
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800/70">
                {visibleRows.map((row, index) => {
                  const isExpanded = expandedIds.has(row.flavorId);
                  return (
                    <Fragment key={row.flavorId}>
                      <tr className="transition hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.03]">
                        <td className="max-w-md px-3.5 py-3 align-top">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpanded(row.flavorId)}
                            className="group flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                          >
                            <ChevronRight
                              aria-hidden="true"
                              className={`app-muted mt-0.5 h-4 w-4 shrink-0 transition-transform ${
                                isExpanded ? "rotate-90 text-foreground" : ""
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="app-muted font-mono text-xs tabular-nums">
                                  #{index + 1}
                                </span>
                                <span className="font-mono font-semibold text-foreground group-hover:underline">
                                  {row.slug}
                                </span>
                              </span>
                              {row.description ? (
                                <span className="app-muted mt-0.5 line-clamp-1 block text-xs">
                                  {row.description}
                                </span>
                              ) : null}
                              <span className="app-kicker mt-1 inline-block text-[11px] font-medium">
                                {isExpanded
                                  ? "Hide study breakdown"
                                  : `View ${row.studyCount} ${
                                      row.studyCount === 1 ? "study" : "studies"
                                    } & prompt steps`}
                              </span>
                            </span>
                          </button>
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 align-top text-xs">
                          <span className="font-medium text-foreground">
                            {row.primarySynthesisModel ?? "Unattributed"}
                          </span>
                          {row.stepCount > 0 ? (
                            <span className="app-muted mt-0.5 block">
                              {row.stepCount}-step chain
                            </span>
                          ) : null}
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                          <span className="font-semibold text-foreground">
                            {row.studyCount}{" "}
                            {row.studyCount === 1 ? "study" : "studies"}
                          </span>
                          <span className="app-muted mt-0.5 block text-xs">
                            {row.captionCount.toLocaleString()} captions
                          </span>
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                          <span className="font-semibold text-foreground">
                            {row.exposures.toLocaleString()}
                          </span>
                          <span className="app-muted mt-0.5 block text-xs">
                            {row.swipeExposures > 0 &&
                            row.ratingScaleExposures > 0
                              ? `${formatCompactCount(row.swipeExposures)} swipe · ${formatCompactCount(row.ratingScaleExposures)} rating`
                              : row.swipeExposures > 0
                                ? "Swipe views"
                                : row.ratingScaleExposures > 0
                                  ? "Rating votes"
                                  : "Staged only"}
                          </span>
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top">
                          {renderRateBar(row)}
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                          <span
                            className={`font-semibold ${getLiftToneClassName(
                              row.meanLiftPp,
                            )}`}
                          >
                            {formatSignedLiftPp(row.meanLiftPp)}
                          </span>
                          {row.sharedImageCount > 0 ? (
                            <span className="app-muted mt-0.5 block text-xs">
                              {row.sharedImageCount} shared img · {row.pairWins}W–
                              {row.pairLosses}L
                              {row.pairTies > 0 ? `–${row.pairTies}T` : ""}
                            </span>
                          ) : (
                            <span className="app-muted mt-0.5 block text-xs">
                              Single-flavor only
                            </span>
                          )}
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr>
                          <td colSpan={6} className="px-4 pb-4 pt-1">
                            {renderExpandedBreakdown(row)}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
