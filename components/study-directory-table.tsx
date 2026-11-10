"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { AppSelect, type AppSelectOption } from "@/components/app-select";
import { GlobalFlavorLeaderboard } from "@/components/global-flavor-leaderboard";
import { GlobalModelLeaderboard } from "@/components/global-model-leaderboard";
import { LoadingOverlay } from "@/components/loading-overlay";
import { LocalStudyWindow } from "@/components/local-study-window";
import {
  filterAndSortStudyDirectory,
  formatCompactCount,
  formatHubPercent,
  type HubFormatFilter,
  type HubSortMode,
  type HubStatusFilter,
  type HubStudyScope,
  type HubWorkspaceTab,
} from "@/utils/attribution-ui-helpers";
import type {
  EnrichedStudyCatalogEntry,
  FastStudyHubCatalog,
  GlobalAttributionDataset,
} from "@/utils/global-attribution-loader";

const formatCompactRunMinutes = (
  value: number | null | undefined,
): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  const totalSeconds = Math.max(0, Math.round(value * 60));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
};

const parseInitialHubScope = (raw?: string): HubStudyScope => {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "scored" || normalized === "benchmarks") {
    return normalized;
  }
  return "all";
};

const parseInitialHubFormat = (raw?: string): HubFormatFilter => {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "swipe") {
    return "Swipe";
  }
  if (
    normalized === "rating scale" ||
    normalized === "rating" ||
    normalized === "likert"
  ) {
    return "Rating scale";
  }
  return "all";
};

const VALID_HUB_SORTS = new Set<HubSortMode>([
  "newest_scored",
  "most_flavors",
  "most_votes",
  "highest_positive_rate",
  "highest_completion",
  "newest",
]);

const parseInitialHubSort = (raw?: string): HubSortMode => {
  const trimmed = raw?.trim() as HubSortMode | undefined;
  return trimmed && VALID_HUB_SORTS.has(trimmed) ? trimmed : "newest_scored";
};

const FORMAT_OPTIONS: ReadonlyArray<{
  value: HubFormatFilter;
  label: string;
}> = [
  { value: "all", label: "All formats" },
  { value: "Swipe", label: "Swipe" },
  { value: "Rating scale", label: "Rating scale" },
];

const SORT_OPTIONS: ReadonlyArray<AppSelectOption<HubSortMode>> = [
  { value: "newest_scored", label: "Newest scored first" },
  { value: "most_flavors", label: "Most flavors (benchmarks)" },
  { value: "most_votes", label: "Most votes & views" },
  { value: "highest_positive_rate", label: "Highest positive rate" },
  { value: "highest_completion", label: "Highest completion rate" },
  { value: "newest", label: "Newest created (all)" },
];

const buildLineageSubline = (row: EnrichedStudyCatalogEntry): string => {
  const parts: string[] = [];
  if (row.flavorCount > 0) {
    parts.push(
      `${row.flavorCount} ${row.flavorCount === 1 ? "flavor" : "flavors"}`,
    );
  }
  if (row.modelCount > 0) {
    parts.push(
      `${row.modelCount} ${row.modelCount === 1 ? "model" : "models"}`,
    );
  }
  parts.push(
    `${row.captionCount.toLocaleString()} ${
      row.captionCount === 1 ? "caption" : "captions"
    }`,
  );
  if (row.sharedImagePairCount > 0) {
    parts.push(`${row.sharedImagePairCount} shared images`);
  }
  return parts.join(" · ");
};

export const syncHubBrowserUrlParams = (updates: {
  tab?: HubWorkspaceTab;
  q?: string | null;
  flavor?: string | null;
  model?: string | null;
  scope?: HubStudyScope | null;
  format?: HubFormatFilter | null;
  sort?: HubSortMode | null;
  era?: "all" | "swipe" | "rating" | null;
  lens?: "synthesis" | "pipeline" | null;
}) => {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (updates.tab !== undefined) {
    if (updates.tab === "studies") {
      params.delete("tab");
    } else {
      params.set("tab", updates.tab);
    }
  }
  if (updates.q !== undefined) {
    const trimmed = updates.q?.trim() ?? "";
    if (trimmed.length > 0) {
      params.set("q", trimmed);
    } else {
      params.delete("q");
    }
  }
  if (updates.flavor !== undefined) {
    if (updates.flavor) {
      params.set("flavor", updates.flavor);
    } else {
      params.delete("flavor");
    }
  }
  if (updates.model !== undefined) {
    if (updates.model) {
      params.set("model", updates.model);
    } else {
      params.delete("model");
    }
  }
  if (updates.scope !== undefined) {
    if (updates.scope && updates.scope !== "all") {
      params.set("scope", updates.scope);
    } else {
      params.delete("scope");
    }
  }
  if (updates.format !== undefined) {
    if (updates.format && updates.format !== "all") {
      params.set("format", updates.format);
    } else {
      params.delete("format");
    }
  }
  if (updates.sort !== undefined) {
    if (updates.sort && updates.sort !== "newest_scored") {
      params.set("sort", updates.sort);
    } else {
      params.delete("sort");
    }
  }
  if (updates.era !== undefined) {
    if (updates.era && updates.era !== "all") {
      params.set("era", updates.era);
    } else {
      params.delete("era");
    }
  }
  if (updates.lens !== undefined) {
    if (updates.lens && updates.lens !== "synthesis") {
      params.set("lens", updates.lens);
    } else {
      params.delete("lens");
    }
  }
  const nextQuery = params.toString();
  const nextUrl = nextQuery
    ? `${window.location.pathname}?${nextQuery}`
    : window.location.pathname;
  window.history.replaceState(window.history.state, "", nextUrl);
};

export function StudyDirectoryTable({
  studies,
  initialQuery = "",
  query: controlledQuery,
  onQueryChange,
  initialScope = "all",
  initialSort = "newest_scored",
  initialFormat = "all",
}: {
  studies: EnrichedStudyCatalogEntry[];
  initialQuery?: string;
  query?: string;
  onQueryChange?: (nextQuery: string) => void;
  initialScope?: HubStudyScope;
  initialSort?: HubSortMode;
  initialFormat?: HubFormatFilter;
}) {
  const router = useRouter();
  const [isNavigating, startRouteTransition] = useTransition();
  const [internalQuery, setInternalQuery] = useState(initialQuery);
  const searchQuery = controlledQuery ?? internalQuery;
  const updateSearchQuery = (nextValue: string) => {
    if (onQueryChange) {
      onQueryChange(nextValue);
    } else {
      setInternalQuery(nextValue);
    }
  };
  const [scopeFilter, setScopeFilter] = useState<HubStudyScope>(initialScope);
  const [statusFilter, setStatusFilter] = useState<HubStatusFilter>("all");
  const [formatFilter, setFormatFilter] =
    useState<HubFormatFilter>(initialFormat);
  const [sortMode, setSortMode] = useState<HubSortMode>(initialSort);

  const deferredQuery = useDeferredValue(searchQuery);

  const counts = useMemo(() => {
    let scored = 0;
    let benchmarks = 0;
    let active = 0;
    let scheduled = 0;
    for (const row of studies) {
      if (row.exposureCount > 0) {
        scored += 1;
        if (row.flavorCount >= 2) {
          benchmarks += 1;
        }
      }
      if (row.status === "active") active += 1;
      if (row.status === "scheduled") scheduled += 1;
    }
    return { scored, benchmarks, active, scheduled };
  }, [studies]);

  const visibleRows = useMemo(
    () =>
      filterAndSortStudyDirectory({
        studies,
        searchQuery: deferredQuery,
        scopeFilter,
        statusFilter,
        formatFilter,
        sortMode,
      }),
    [
      studies,
      deferredQuery,
      scopeFilter,
      statusFilter,
      formatFilter,
      sortMode,
    ],
  );

  if (studies.length === 0) {
    return (
      <div className="app-card rounded-xl p-6 text-center text-sm">
        No studies found in this database.
      </div>
    );
  }

  const navigateToStudy = (studyId: number) => {
    startRouteTransition(() => {
      router.push(`/study/${studyId}/attribution`);
    });
  };

  const resetFilters = () => {
    updateSearchQuery("");
    setScopeFilter("all");
    setStatusFilter("all");
    setFormatFilter("all");
    setSortMode("newest_scored");
    syncHubBrowserUrlParams({
      q: null,
      scope: "all",
      format: "all",
      sort: "newest_scored",
    });
  };

  const scopeOptions: Array<{
    value: HubStudyScope;
    label: string;
    disabled: boolean;
  }> = [
    { value: "all", label: `All (${studies.length})`, disabled: false },
    {
      value: "scored",
      label: `Scored (${counts.scored})`,
      disabled: counts.scored === 0,
    },
    {
      value: "benchmarks",
      label: `Multi-flavor (${counts.benchmarks})`,
      disabled: counts.benchmarks === 0,
    },
  ];

  const nonZeroLifecycleOptions: Array<{
    value: HubStatusFilter;
    label: string;
  }> = [];
  if (counts.active > 0) {
    nonZeroLifecycleOptions.push({
      value: "active",
      label: `Active (${counts.active})`,
    });
  }
  if (counts.scheduled > 0) {
    nonZeroLifecycleOptions.push({
      value: "scheduled",
      label: `Scheduled (${counts.scheduled})`,
    });
  }

  return (
    <div className="space-y-3" aria-busy={deferredQuery !== searchQuery}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <div className="relative w-full sm:w-80">
            <Search
              aria-hidden="true"
              className="app-muted pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateSearchQuery(nextValue);
                syncHubBrowserUrlParams({ q: nextValue });
              }}
              placeholder="Filter by study, prompt flavor, or model..."
              aria-label="Filter by study, prompt flavor, or model"
              className="app-input h-9 w-full rounded-lg pl-9 pr-3 text-sm outline-none"
            />
          </div>

          <div
            role="group"
            aria-label="Filter study scope"
            className="app-input inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {scopeOptions.map((option) => {
              const isActive = scopeFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  aria-pressed={isActive}
                  onClick={() => {
                    setScopeFilter(option.value);
                    syncHubBrowserUrlParams({ scope: option.value });
                  }}
                  className={`h-7 shrink-0 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    isActive
                      ? "bg-white text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                      : "app-muted hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div
            role="group"
            aria-label="Filter by study format"
            className="app-input inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {FORMAT_OPTIONS.map((option) => {
              const isActive = formatFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setFormatFilter(option.value);
                    syncHubBrowserUrlParams({ format: option.value });
                  }}
                  className={`h-7 shrink-0 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition ${
                    isActive
                      ? "bg-white text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                      : "app-muted hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {nonZeroLifecycleOptions.length > 0 ? (
            <div
              role="group"
              aria-label="Filter by live status"
              className="app-input inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {nonZeroLifecycleOptions.map((option) => {
                const isActive = statusFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() =>
                      setStatusFilter(isActive ? "all" : option.value)
                    }
                    className={`h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition ${
                      isActive
                        ? "bg-white text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                        : "app-muted hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <AppSelect<HubSortMode>
            options={SORT_OPTIONS}
            value={sortMode}
            onValueChange={(nextSort) => {
              setSortMode(nextSort);
              syncHubBrowserUrlParams({ sort: nextSort });
            }}
            ariaLabel="Sort studies"
            menuMinWidthPx={230}
            className="w-52 rounded-lg text-xs sm:w-56 sm:text-sm"
          />

          <span className="app-muted shrink-0 text-xs tabular-nums">
            {visibleRows.length.toLocaleString()} of{" "}
            {studies.length.toLocaleString()}
          </span>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="app-card flex flex-col items-center justify-center gap-3 rounded-xl p-6 text-center text-sm">
          <p className="app-muted">No studies match the active filters.</p>
          <button
            type="button"
            onClick={resetFilters}
            className="app-button inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium transition"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <>
          {/* Mobile < md responsive stacked cards (zero horizontal scroll inside 390px) */}
          <div className="space-y-2 md:hidden">
            {visibleRows.map((row) => {
              const unitWord =
                row.exposureMode === "swipe_navigation" ? "views" : "votes";
              const volumeText =
                row.exposureCount > 0
                  ? row.participationsStarted > 0
                    ? `${row.participationsStarted} started · ${formatHubPercent(row.completionRate)} done · ${formatCompactCount(row.exposureCount)} ${unitWord}`
                    : row.voterCount > 0
                      ? `${row.voterCount.toLocaleString()} ${row.voterCount === 1 ? "voter" : "voters"} · ${formatCompactCount(row.exposureCount)} ${unitWord}`
                      : `${formatCompactCount(row.exposureCount)} ${unitWord} · ${row.captionCount.toLocaleString()} ${row.captionCount === 1 ? "caption" : "captions"}`
                  : "0 voters yet";

              return (
                <Link
                  key={row.id}
                  href={`/study/${row.id}/attribution`}
                  onClick={(event) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey ||
                      event.button !== 0
                    ) {
                      return;
                    }
                    event.preventDefault();
                    navigateToStudy(row.id);
                  }}
                  className="app-card block rounded-xl p-3.5 transition hover:ring-1 hover:ring-[var(--accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="app-muted shrink-0 font-mono text-xs tabular-nums">
                          #{row.id}
                        </span>{" "}
                        <span className="truncate font-semibold text-foreground">
                          {row.title}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span
                          className={
                            row.exposureMode === "swipe_navigation"
                              ? "inline-flex rounded bg-sky-500/14 px-1.5 py-0.5 font-medium text-slate-900 dark:text-sky-100"
                              : "inline-flex rounded bg-amber-500/16 px-1.5 py-0.5 font-medium text-amber-900 dark:text-amber-100"
                          }
                        >
                          {row.formatDisplayLabel}
                        </span>
                        {row.is_private ? (
                          <span className="app-muted">Private</span>
                        ) : null}
                        <span className="app-muted">·</span>
                        <span className="app-muted tabular-nums">
                          {row.flavorCount > 0
                            ? `${row.flavorCount} ${row.flavorCount === 1 ? "flavor" : "flavors"}`
                            : "Manual"}
                          {row.modelCount > 0
                            ? ` · ${row.modelCount} ${row.modelCount === 1 ? "model" : "models"}`
                            : ""}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <div className="text-right tabular-nums">
                        <p className="text-sm font-semibold text-foreground">
                          {row.exposureCount > 0
                            ? formatHubPercent(row.positiveRate)
                            : "—"}
                        </p>
                        <p className="app-muted text-[11px]">
                          {row.exposureCount > 0 ? "positive" : "staged"}
                        </p>
                      </div>
                      <ChevronRight
                        aria-hidden="true"
                        className="app-muted h-4 w-4 shrink-0"
                      />
                    </div>
                  </div>

                  <p className="app-muted mt-2 border-t border-slate-200/60 pt-1.5 text-xs tabular-nums dark:border-slate-800/80">
                    {volumeText}
                  </p>
                </Link>
              );
            })}
          </div>

          {/* Desktop >= md clickable directory table */}
          <div className="app-table-shell hidden overflow-x-auto rounded-xl md:block">
            <table className="app-table min-w-full divide-y divide-slate-200/60 text-sm dark:divide-slate-700/60">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    Study
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    Format & Window
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    Participation & Volume
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    Positive Rate
                  </th>
                  <th
                    scope="col"
                    className="w-10 px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800/70">
                {visibleRows.map((row) => {
                  const lowPct =
                    row.ciLow !== null
                      ? Math.max(0, Math.min(100, row.ciLow * 100))
                      : 0;
                  const highPct =
                    row.ciHigh !== null
                      ? Math.max(lowPct, Math.min(100, row.ciHigh * 100))
                      : 0;
                  const pointPct =
                    row.positiveRate !== null
                      ? Math.max(0, Math.min(100, row.positiveRate * 100))
                      : 0;

                  return (
                    <tr
                      key={row.id}
                      onClick={(event) => {
                        if (
                          event.target instanceof Element &&
                          event.target.closest("a, button")
                        ) {
                          return;
                        }
                        const selection = window.getSelection()?.toString();
                        if (selection && selection.length > 0) {
                          return;
                        }
                        navigateToStudy(row.id);
                      }}
                      className="group cursor-pointer transition hover:bg-sky-500/[0.06] dark:hover:bg-cyan-300/[0.06]"
                    >
                      <td className="px-3.5 py-3 align-top">
                        <Link
                          href={`/study/${row.id}/attribution`}
                          onClick={(event) => {
                            if (
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey ||
                              event.altKey ||
                              event.button !== 0
                            ) {
                              return;
                            }
                            event.preventDefault();
                            navigateToStudy(row.id);
                          }}
                          className="inline-flex items-baseline gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        >
                          <span className="app-muted font-mono text-xs tabular-nums">
                            #{row.id}
                          </span>{" "}
                          <span className="font-semibold text-foreground group-hover:underline">
                            {row.title}
                          </span>
                          {row.flavorCount >= 2 && row.exposureCount > 0 ? (
                            <span className="inline-flex rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800 dark:text-cyan-200">
                              Benchmark
                            </span>
                          ) : null}
                        </Link>
                        <p className="app-muted mt-0.5 text-xs tabular-nums">
                          {buildLineageSubline(row)}
                        </p>
                        {row.customDescription ? (
                          <p className="app-muted mt-0.5 line-clamp-1 max-w-md text-xs">
                            {row.customDescription}
                          </p>
                        ) : null}
                      </td>

                      <td className="whitespace-nowrap px-3.5 py-3 align-top">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={
                              row.exposureMode === "swipe_navigation"
                                ? "inline-flex rounded-md bg-sky-500/14 px-2 py-0.5 text-xs font-medium text-slate-900 dark:text-sky-100"
                                : "inline-flex rounded-md bg-amber-500/18 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-100"
                            }
                          >
                            {row.formatDisplayLabel}
                          </span>
                          {row.is_private ? (
                            <span className="app-muted text-xs">Private</span>
                          ) : null}
                        </div>
                        <div className="app-muted mt-1 text-xs tabular-nums">
                          <LocalStudyWindow
                            start={
                              row.start_datetime_utc ?? row.created_datetime_utc
                            }
                            end={row.end_datetime_utc}
                          />
                        </div>
                      </td>

                      <td className="min-w-48 whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                        {row.exposureCount > 0 ? (
                          row.participationsStarted > 0 ? (
                            <div>
                              <div className="font-semibold text-foreground">
                                {row.participationsStarted.toLocaleString()}{" "}
                                started · {formatHubPercent(row.completionRate)}{" "}
                                finished
                              </div>
                              <span className="app-muted mt-0.5 block text-xs">
                                {formatCompactCount(row.exposureCount)} views ·{" "}
                                {row.voterCount.toLocaleString()} voters ·{" "}
                                {formatCompactRunMinutes(row.medianRunMinutes)}
                              </span>
                            </div>
                          ) : (
                            <div>
                              <div className="font-semibold text-foreground">
                                {row.voterCount > 0 ? (
                                  <>
                                    {row.voterCount.toLocaleString()}{" "}
                                    {row.voterCount === 1 ? "voter" : "voters"} ·{" "}
                                    {formatCompactCount(row.exposureCount)}{" "}
                                    {row.exposureMode === "swipe_navigation"
                                      ? "views"
                                      : "votes"}
                                  </>
                                ) : (
                                  <>
                                    {formatCompactCount(row.exposureCount)}{" "}
                                    {row.exposureMode === "swipe_navigation"
                                      ? "views"
                                      : "votes"}{" "}
                                    · {row.captionCount.toLocaleString()}{" "}
                                    {row.captionCount === 1
                                      ? "caption"
                                      : "captions"}
                                  </>
                                )}
                              </div>
                              <span className="app-muted mt-0.5 block text-xs">
                                {row.exposureCount.toLocaleString()} total{" "}
                                {row.exposureMode === "swipe_navigation"
                                  ? "seen cards"
                                  : "ratings"}
                              </span>
                            </div>
                          )
                        ) : (
                          <div>
                            <span className="app-muted text-xs font-medium">
                              0 voters yet
                            </span>
                            <span className="app-muted mt-0.5 block text-[11px]">
                              {row.participationsStarted > 0
                                ? `${row.participationsStarted} started · 0 exposures`
                                : "Staged draft"}
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                        {row.exposureCount > 0 &&
                        row.positiveRate !== null &&
                        row.ciLow !== null &&
                        row.ciHigh !== null ? (
                          <div className="space-y-1">
                            <div className="flex items-baseline justify-end gap-2">
                              <span className="font-semibold text-foreground">
                                {formatHubPercent(row.positiveRate)}
                              </span>
                              <span className="app-muted text-[11px]">
                                [{formatHubPercent(row.ciLow)},{" "}
                                {formatHubPercent(row.ciHigh)}]
                              </span>
                            </div>
                            <div
                              aria-hidden="true"
                              className="relative ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800"
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
                        ) : (
                          <span className="app-muted text-xs">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-right align-middle">
                        <ChevronRight
                          aria-hidden="true"
                          className="app-muted ml-auto h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isNavigating ? <LoadingOverlay label="Opening study..." /> : null}
    </div>
  );
}

const buildHubTabHref = (tab: HubWorkspaceTab, query: string): string => {
  const params = new URLSearchParams();
  if (tab !== "studies") {
    params.set("tab", tab);
  }
  const trimmed = query.trim();
  if (trimmed.length > 0) {
    params.set("q", trimmed);
  }
  const qs = params.toString();
  return qs.length > 0 ? `/?${qs}` : "/";
};

export function HomeAttributionWorkspace({
  dataset,
  initialTab,
  initialQuery = "",
  initialFlavorParam,
  initialModelParam,
  initialScopeParam,
  initialFormatParam,
  initialSortParam,
  initialEraParam,
  initialLensParam,
}: {
  dataset: GlobalAttributionDataset | FastStudyHubCatalog;
  initialTab: HubWorkspaceTab;
  initialQuery?: string;
  initialFlavorParam?: string;
  initialModelParam?: string;
  initialScopeParam?: string;
  initialFormatParam?: string;
  initialSortParam?: string;
  initialEraParam?: string;
  initialLensParam?: string;
}) {
  const router = useRouter();
  const [isTabPending, startTabTransition] = useTransition();
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasFullLeaderboards = "flavors" in dataset;
  const { kpis } = dataset;
  const [activeTab, setActiveTab] = useState<HubWorkspaceTab>(initialTab);
  const [prevInitialQuery, setPrevInitialQuery] = useState(initialQuery);
  const [studyQuery, setStudyQuery] = useState(initialQuery);
  if (initialQuery !== prevInitialQuery) {
    setPrevInitialQuery(initialQuery);
    setStudyQuery(initialQuery);
  }
  const [studyPreset, setStudyPreset] = useState<{
    epoch: number;
    scope: HubStudyScope;
    sort: HubSortMode;
    format: HubFormatFilter;
  }>(() => ({
    epoch: 0,
    scope: parseInitialHubScope(initialScopeParam),
    sort: parseInitialHubSort(initialSortParam),
    format: parseInitialHubFormat(initialFormatParam),
  }));

  const tabDefinitions = [
    {
      id: "studies" as const,
      label: `Studies (${dataset.studies.length})`,
      shortLabel: `Studies (${dataset.studies.length})`,
    },
    {
      id: "flavors" as const,
      label: `Prompt Flavors (${kpis.testedFlavorCount})`,
      shortLabel: `Flavors (${kpis.testedFlavorCount})`,
    },
    {
      id: "models" as const,
      label: `Models (${kpis.testedModelCount})`,
      shortLabel: `Models (${kpis.testedModelCount})`,
    },
  ];

  const selectTab = (nextTab: HubWorkspaceTab) => {
    setActiveTab(nextTab);
    if (!hasFullLeaderboards) {
      if (nextTab === "flavors" || nextTab === "models") {
        startTabTransition(() => {
          router.push(buildHubTabHref(nextTab, studyQuery), { scroll: false });
        });
        return;
      }
      if (isTabPending) {
        startTabTransition(() => {
          router.replace(buildHubTabHref("studies", studyQuery), {
            scroll: false,
          });
        });
      }
    }
    syncHubBrowserUrlParams({
      tab: nextTab,
      q: studyQuery,
      flavor: nextTab === "flavors" ? undefined : null,
      model: nextTab === "models" ? undefined : null,
      scope: nextTab === "studies" ? studyPreset.scope : null,
      format: nextTab === "studies" ? studyPreset.format : null,
      sort: nextTab === "studies" ? studyPreset.sort : null,
      era: nextTab === "studies" ? null : undefined,
      lens: nextTab === "models" ? undefined : null,
    });
  };

  const applyStudyPreset = ({
    scope,
    sort,
    format = "all",
  }: {
    scope: HubStudyScope;
    sort: HubSortMode;
    format?: HubFormatFilter;
  }) => {
    setActiveTab("studies");
    setStudyPreset((prev) => ({
      epoch: prev.epoch + 1,
      scope,
      sort,
      format,
    }));
    if (!hasFullLeaderboards && isTabPending) {
      startTabTransition(() => {
        router.replace(buildHubTabHref("studies", studyQuery), {
          scroll: false,
        });
      });
    }
    syncHubBrowserUrlParams({
      tab: "studies",
      q: studyQuery,
      flavor: null,
      model: null,
      scope,
      format,
      sort,
      era: null,
      lens: null,
    });
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabDefinitions.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabDefinitions.length) % tabDefinitions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabDefinitions.length - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      const targetTab = tabDefinitions[nextIndex];
      tabButtonRefs.current[nextIndex]?.focus();
      selectTab(targetTab.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4 sm:gap-3">
        <button
          type="button"
          onClick={() =>
            applyStudyPreset({ scope: "all", sort: "newest_scored" })
          }
          className={`group app-card app-stat-card-teal min-w-0 cursor-pointer rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:ring-2 hover:ring-[var(--accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:p-4 ${
            activeTab === "studies" && studyPreset.sort !== "highest_completion"
              ? "ring-1 ring-[var(--accent)]/45"
              : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="app-kicker text-[11px] font-semibold uppercase tracking-wide sm:text-xs">
              Studies
            </p>
            <ChevronRight
              aria-hidden="true"
              className="app-muted h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
            />
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums sm:mt-2 sm:text-2xl">
            {kpis.totalStudies.toLocaleString()}
          </p>
          <p className="app-muted mt-0.5 line-clamp-1 text-[11px] tabular-nums sm:mt-1 sm:line-clamp-none sm:text-xs">
            {kpis.scoredStudies} scored · {kpis.multiFlavorStudies} multi-flavor
            · {kpis.swipeStudies} swipe
          </p>
        </button>

        <button
          type="button"
          onClick={() =>
            applyStudyPreset({
              scope: "scored",
              sort: "highest_completion",
              format: "Swipe",
            })
          }
          className={`group app-card app-stat-card-sky min-w-0 cursor-pointer rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:ring-2 hover:ring-[var(--accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:p-4 ${
            activeTab === "studies" && studyPreset.sort === "highest_completion"
              ? "ring-1 ring-[var(--accent)]/45"
              : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="app-kicker text-[11px] font-semibold uppercase tracking-wide sm:text-xs">
              Completion Rate
            </p>
            <ChevronRight
              aria-hidden="true"
              className="app-muted h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
            />
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums sm:mt-2 sm:text-2xl">
            {formatHubPercent(kpis.overallCompletionRate)}
          </p>
          <p className="app-muted mt-0.5 line-clamp-1 text-[11px] tabular-nums sm:mt-1 sm:line-clamp-none sm:text-xs">
            {kpis.completedParticipations.toLocaleString()} of{" "}
            {kpis.totalParticipations.toLocaleString()} runs finished
          </p>
        </button>

        <button
          type="button"
          onClick={() => selectTab("flavors")}
          className={`group app-card app-stat-card-amber min-w-0 cursor-pointer rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:ring-2 hover:ring-[var(--accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:p-4 ${
            activeTab === "flavors" ? "ring-1 ring-[var(--accent)]/45" : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="app-kicker text-[11px] font-semibold uppercase tracking-wide sm:text-xs">
              Evaluated Flavors
            </p>
            <ChevronRight
              aria-hidden="true"
              className="app-muted h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
            />
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums sm:mt-2 sm:text-2xl">
            {kpis.testedFlavorCount.toLocaleString()} /{" "}
            {kpis.totalFlavorCount.toLocaleString()}
          </p>
          <p className="app-muted mt-0.5 line-clamp-1 text-[11px] tabular-nums sm:mt-1 sm:line-clamp-none sm:text-xs">
            {kpis.scoredFlavorCount} scored across{" "}
            {kpis.mappedCaptionCount.toLocaleString()} captions
          </p>
        </button>

        <button
          type="button"
          onClick={() => selectTab("models")}
          className={`group app-card app-stat-card-rose min-w-0 cursor-pointer rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:ring-2 hover:ring-[var(--accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:p-4 ${
            activeTab === "models" ? "ring-1 ring-[var(--accent)]/45" : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="app-kicker text-[11px] font-semibold uppercase tracking-wide sm:text-xs">
              Evaluated Models
            </p>
            <ChevronRight
              aria-hidden="true"
              className="app-muted h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
            />
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums sm:mt-2 sm:text-2xl">
            {kpis.testedModelCount.toLocaleString()} /{" "}
            {kpis.totalModelCount.toLocaleString()}
          </p>
          <p className="app-muted mt-0.5 line-clamp-1 text-[11px] tabular-nums sm:mt-1 sm:line-clamp-none sm:text-xs">
            {formatCompactCount(kpis.totalVoteEvents)} votes ·{" "}
            {formatCompactCount(kpis.totalNavigationEvents)} swipe views
          </p>
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Attribution workspace views"
        className="app-input inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-xl p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabDefinitions.map((tab, index) => {
          const isSelected = activeTab === tab.id;
          const isLoadingTab =
            !hasFullLeaderboards &&
            isTabPending &&
            tab.id === activeTab &&
            tab.id !== "studies";
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabButtonRefs.current[index] = node;
              }}
              id={`hub-tab-${tab.id}`}
              type="button"
              role="tab"
              tabIndex={isSelected ? 0 : -1}
              aria-selected={isSelected}
              aria-controls={`hub-panel-${tab.id}`}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs transition sm:px-3.5 sm:text-sm ${
                isSelected
                  ? "bg-white font-semibold text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                  : "app-muted font-medium hover:text-foreground"
              }`}
            >
              <span className="sm:hidden">{tab.shortLabel}</span>
              <span className="hidden sm:inline">{tab.label}</span>
              {isLoadingTab ? (
                <span
                  aria-hidden="true"
                  className="app-loading-spinner !h-3 !w-3 !border-[1.5px]"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        id={`hub-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`hub-tab-${activeTab}`}
      >
        {activeTab === "studies" ? (
          <StudyDirectoryTable
            key={`studies-${studyPreset.epoch}`}
            studies={dataset.studies}
            query={studyQuery}
            onQueryChange={setStudyQuery}
            initialScope={studyPreset.scope}
            initialSort={studyPreset.sort}
            initialFormat={studyPreset.format}
          />
        ) : !hasFullLeaderboards ? (
          <div
            role="status"
            aria-live="polite"
            className="app-card flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl p-8 text-center text-sm"
          >
            <span aria-hidden="true" className="app-loading-spinner" />
            <p className="app-muted text-xs sm:text-sm">
              Loading cross-study{" "}
              {activeTab === "flavors" ? "prompt flavor" : "LLM model"}{" "}
              leaderboard...
            </p>
          </div>
        ) : activeTab === "flavors" ? (
          <GlobalFlavorLeaderboard
            key={`flavors-${initialFlavorParam ?? ""}-${initialQuery}-${initialEraParam ?? ""}`}
            flavors={dataset.flavors}
            unusedFlavorCount={dataset.unusedFlavorCount}
            initialFlavorParam={initialFlavorParam}
            initialQuery={initialQuery}
            initialEraParam={initialEraParam}
            onClearEntityFocus={() => syncHubBrowserUrlParams({ flavor: null })}
          />
        ) : (
          <GlobalModelLeaderboard
            key={`models-${initialModelParam ?? ""}-${initialQuery}-${initialEraParam ?? ""}-${initialLensParam ?? ""}`}
            models={dataset.models}
            unevaluatedModels={dataset.unevaluatedModels}
            initialModelParam={initialModelParam}
            initialQuery={initialQuery}
            initialEraParam={initialEraParam}
            initialLensParam={initialLensParam}
            onClearEntityFocus={() => syncHubBrowserUrlParams({ model: null })}
          />
        )}
      </div>
    </div>
  );
}
