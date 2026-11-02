"use client";

import { ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useDeferredValue, useMemo, useState } from "react";

import { StudyAttributionCharts } from "@/components/study-attribution-charts";
import type {
  AttributionLeaderboardRow,
  AttributionPipelineStep,
  AttributionSampleCaption,
  CaptionRateDistribution,
} from "@/utils/attribution-stats";
import {
  type AttributionGroupBy,
  filterAndSortLeaderboardRows,
  formatChainSecondsLabel,
  formatDwellDurationLabel,
  formatRatePercent,
  formatSignedLiftPp,
  getDefaultLeaderboardSortDirection,
  getLiftToneClassName,
  type LeaderboardSortDirection,
  type LeaderboardSortKey,
  resolveInitialGroupBy,
  resolveUrlEntityFocus,
} from "@/utils/attribution-ui-helpers";
import type { StudyParticipationFunnel } from "@/utils/study-exposure-adapter";

type StudyAttributionLeaderboardProps = {
  studyId: number;
  excludeHighRisk: boolean;
  leaderboards: {
    flavors: AttributionLeaderboardRow[];
    models: AttributionLeaderboardRow[];
    pipelines: AttributionLeaderboardRow[];
  };
  funnel: StudyParticipationFunnel;
  captionRateHistogram?: CaptionRateDistribution;
  hideCharts?: boolean;
  studyPositiveRate: number | null;
  totalExposures: number;
  totalPositive: number;
  exposureUnitLabel: "seen cards" | "votes";
  unattributedCaptionCount: number;
  initialGroupByParam?: string;
  initialFlavorParam?: string;
  initialModelParam?: string;
};

const SortDirectionArrow = ({
  direction,
}: {
  direction: LeaderboardSortDirection;
}) => (
  <svg
    aria-hidden="true"
    className="size-3.5 shrink-0 stroke-current"
    fill="none"
    viewBox="0 0 16 16"
  >
    {direction === "asc" ? (
      <path
        d="M8 3.5v9M4.5 7 8 3.5 11.5 7"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    ) : (
      <path
        d="M8 12.5v-9M4.5 9 8 12.5 11.5 9"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    )}
  </svg>
);

function DrilldownSampleCaptionCard({
  sample,
  exposureUnitLabel,
  imageBroken,
  onImageError,
}: {
  sample: AttributionSampleCaption;
  exposureUnitLabel: "seen cards" | "votes";
  imageBroken: boolean;
  onImageError: (captionId: string) => void;
}) {
  return (
    <article className="app-card flex min-w-0 flex-col overflow-hidden rounded-xl">
      {sample.imageUrl && !imageBroken ? (
        <div className="flex h-44 w-full items-center justify-center bg-white/45 p-2.5 dark:bg-slate-950/25">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sample.imageUrl}
            alt={sample.imageDescription ?? sample.captionText}
            loading="lazy"
            decoding="async"
            onError={() => onImageError(sample.captionId)}
            className="h-full w-full object-contain"
          />
        </div>
      ) : (
        <div className="flex h-44 w-full items-center justify-center bg-white/45 p-4 text-xs dark:bg-slate-950/25">
          <span className="app-muted">Image unavailable</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col p-3.5">
        <p className="break-words text-sm font-semibold leading-5 text-foreground">
          {sample.captionText}
        </p>
        <div className="mt-auto pt-2.5">
          <div className="space-y-1 border-t border-slate-200/70 pt-2.5 text-xs tabular-nums dark:border-slate-700/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {sample.rate !== null ? (
                <span className="font-semibold text-foreground">
                  {formatRatePercent(sample.rate)}{" "}
                  <span className="app-muted font-normal">
                    ({sample.positive.toLocaleString()}/
                    {sample.exposures.toLocaleString()} {exposureUnitLabel})
                  </span>
                </span>
              ) : (
                <span className="app-muted">Staged · 0 {exposureUnitLabel}</span>
              )}
              <span className="font-mono text-[11px] text-foreground">
                {sample.modelName}
              </span>
            </div>
            <div className="app-muted flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-mono">{sample.flavorSlug}</span>
              {sample.ciLow !== null && sample.ciHigh !== null ? (
                <span>
                  95% CI [{formatRatePercent(sample.ciLow)},{" "}
                  {formatRatePercent(sample.ciHigh)}]
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

const resolveStepPills = (
  row: AttributionLeaderboardRow,
): AttributionPipelineStep[] => {
  if (row.pipelineStepDetails && row.pipelineStepDetails.length > 0) {
    return row.pipelineStepDetails;
  }
  return row.pipelineSteps.map((modelName, index) => ({
    stepOrder: index + 1,
    modelName,
    providerName: null,
  }));
};

export function StudyAttributionLeaderboard({
  studyId,
  excludeHighRisk,
  leaderboards,
  funnel,
  captionRateHistogram,
  hideCharts = false,
  studyPositiveRate,
  totalExposures,
  totalPositive,
  exposureUnitLabel,
  unattributedCaptionCount,
  initialGroupByParam,
  initialFlavorParam,
  initialModelParam,
}: StudyAttributionLeaderboardProps) {
  const initialFocus = useMemo(
    () =>
      resolveUrlEntityFocus({
        flavorParam: initialFlavorParam,
        modelParam: initialModelParam,
        flavors: leaderboards.flavors,
        models: leaderboards.models,
      }),
    [
      initialFlavorParam,
      initialModelParam,
      leaderboards.flavors,
      leaderboards.models,
    ],
  );

  const [groupBy, setGroupBy] = useState<AttributionGroupBy>(() =>
    resolveInitialGroupBy(
      initialGroupByParam,
      initialFlavorParam,
      initialModelParam,
    ),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [pinnedEntity, setPinnedEntity] = useState<{
    key: string;
    label: string;
  } | null>(() =>
    initialFocus.matchedKey && initialFocus.matchedLabel
      ? { key: initialFocus.matchedKey, label: initialFocus.matchedLabel }
      : null,
  );
  const [missingEntityNotice, setMissingEntityNotice] = useState<
    "flavor" | "model" | null
  >(() => initialFocus.missingEntityKind);
  const [sortBy, setSortBy] = useState<LeaderboardSortKey>("ciLow");
  const [sortDirection, setSortDirection] =
    useState<LeaderboardSortDirection>("desc");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() =>
    initialFocus.matchedKey ? new Set([initialFocus.matchedKey]) : new Set(),
  );
  const [brokenCaptionImageIds, setBrokenCaptionImageIds] = useState<
    Set<string>
  >(() => new Set());

  const activeRows =
    groupBy === "flavor"
      ? leaderboards.flavors
      : groupBy === "model"
        ? leaderboards.models
        : leaderboards.pipelines;

  const flavorCount = leaderboards.flavors.filter(
    (row) => !row.isUnattributed,
  ).length;
  const modelCount = leaderboards.models.filter(
    (row) => !row.isUnattributed,
  ).length;
  const pipelineCount = leaderboards.pipelines.filter(
    (row) => !row.isUnattributed,
  ).length;

  const showLiftColumn = groupBy === "flavor";
  const totalColumnCount = showLiftColumn ? 7 : 6;

  const visibleRows = useMemo(
    () =>
      filterAndSortLeaderboardRows({
        rows: activeRows,
        searchQuery: deferredSearch,
        pinnedEntityKey: pinnedEntity?.key ?? null,
        sortBy,
        sortDirection,
      }),
    [activeRows, deferredSearch, pinnedEntity, sortBy, sortDirection],
  );

  const handleGroupChange = (nextGroup: AttributionGroupBy) => {
    setGroupBy(nextGroup);
    if (nextGroup !== "flavor" && sortBy === "meanLiftPp") {
      setSortBy("ciLow");
      setSortDirection("desc");
    }
    if (
      pinnedEntity &&
      ((nextGroup !== "flavor" && pinnedEntity.key.startsWith("flavor:")) ||
        (nextGroup !== "model" && pinnedEntity.key.startsWith("model:")))
    ) {
      setPinnedEntity(null);
    }
  };

  const handleSortClick = (column: LeaderboardSortKey) => {
    if (sortBy === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDirection(getDefaultLeaderboardSortDirection(column));
    }
  };

  const toggleExpandedRow = (rowKey: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  };

  const markCaptionImageBroken = (captionId: string) => {
    setBrokenCaptionImageIds((prev) => {
      if (prev.has(captionId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(captionId);
      return next;
    });
  };

  const getAriaSort = (
    column: LeaderboardSortKey,
  ): "ascending" | "descending" | "none" => {
    if (sortBy !== column) {
      return "none";
    }
    return sortDirection === "asc" ? "ascending" : "descending";
  };

  const primaryColumnLabel =
    groupBy === "flavor"
      ? "Prompt Flavor"
      : groupBy === "model"
        ? "Synthesis Model"
        : "Pipeline Signature";

  const excludeQuerySuffix = excludeHighRisk ? "&excludeHighRisk=1" : "";

  return (
    <div className="space-y-5">
      {hideCharts ? null : (
        <StudyAttributionCharts
          funnel={funnel}
          activeGroupBy={groupBy}
          activeRows={activeRows}
          captionRateHistogram={captionRateHistogram}
          studyPositiveRate={studyPositiveRate}
          totalExposures={totalExposures}
          exposureUnitLabel={exposureUnitLabel}
          unattributedCaptionCount={unattributedCaptionCount}
        />
      )}

      <div className="space-y-3" aria-busy={deferredSearch !== searchQuery}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Attribution grouping"
              className="app-input inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg p-1 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {(
                [
                  {
                    value: "flavor" as const,
                    label: `Prompt Flavors (${flavorCount})`,
                    shortLabel: `Flavors (${flavorCount})`,
                  },
                  {
                    value: "model" as const,
                    label: `Synthesis Models (${modelCount})`,
                    shortLabel: `Models (${modelCount})`,
                  },
                  {
                    value: "pipeline" as const,
                    label: `Full Pipelines (${pipelineCount})`,
                    shortLabel: `Pipelines (${pipelineCount})`,
                  },
                ] as const
              ).map((option) => {
                const isActive = groupBy === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => handleGroupChange(option.value)}
                    className={`min-h-8 shrink-0 cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition sm:px-3 ${
                      isActive
                        ? "bg-white font-semibold text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                        : "app-muted hover:text-foreground"
                    }`}
                  >
                    <span className="sm:hidden">{option.shortLabel}</span>
                    <span className="hidden sm:inline">{option.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full sm:w-56">
              <Search
                aria-hidden="true"
                className="app-muted pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Filter rows..."
                aria-label="Filter attribution rows"
                className="app-input h-9 w-full rounded-lg pl-9 pr-3 text-sm outline-none"
              />
            </div>

            {pinnedEntity ? (
              <button
                type="button"
                onClick={() => setPinnedEntity(null)}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 text-xs font-medium text-sky-900 ring-1 ring-sky-500/35 transition hover:bg-sky-500/22 dark:text-sky-100"
              >
                <span>
                  Filtered to{" "}
                  <span className="font-mono font-semibold">
                    {pinnedEntity.label}
                  </span>
                </span>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}

            {missingEntityNotice ? (
              <button
                type="button"
                onClick={() => setMissingEntityNotice(null)}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-amber-500/16 px-3 text-xs font-medium text-amber-900 ring-1 ring-amber-500/35 transition hover:bg-amber-500/24 dark:text-amber-100"
              >
                <span>
                  {missingEntityNotice === "flavor"
                    ? "Flavor not present in this study · Showing all"
                    : "Model not present in this study · Showing all"}
                </span>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <span className="app-muted text-xs tabular-nums">
            Study total: {totalPositive.toLocaleString()} positive of{" "}
            {totalExposures.toLocaleString()} {exposureUnitLabel} (
            {formatRatePercent(studyPositiveRate)})
          </span>
        </div>

        {visibleRows.length === 0 ? (
          <div className="app-card flex flex-col items-center justify-center gap-3 rounded-xl p-6 text-center text-sm">
            <p className="app-muted">No rows match the active filter.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setPinnedEntity(null);
              }}
              className="app-button inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-xs font-medium transition"
            >
              Clear filter
            </button>
          </div>
        ) : (
          <div className="app-table-shell overflow-x-auto rounded-xl">
            <table className="app-table min-w-full divide-y divide-slate-200/60 text-sm dark:divide-slate-700/60">
              <thead>
                <tr>
                  <th
                    scope="col"
                    aria-sort={getAriaSort("label")}
                    className="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    <button
                      type="button"
                      onClick={() => handleSortClick("label")}
                      className="inline-flex min-h-7 cursor-pointer items-center gap-1 text-left transition hover:opacity-80"
                    >
                      <span>{primaryColumnLabel}</span>
                      {sortBy === "label" ? (
                        <SortDirectionArrow direction={sortDirection} />
                      ) : null}
                    </button>
                  </th>

                  <th
                    scope="col"
                    aria-sort={getAriaSort("captionCount")}
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    <button
                      type="button"
                      onClick={() => handleSortClick("captionCount")}
                      className="inline-flex min-h-7 cursor-pointer items-center justify-end gap-1 transition hover:opacity-80"
                    >
                      <span>Captions</span>
                      {sortBy === "captionCount" ? (
                        <SortDirectionArrow direction={sortDirection} />
                      ) : null}
                    </button>
                  </th>

                  <th
                    scope="col"
                    aria-sort={getAriaSort("exposures")}
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    <button
                      type="button"
                      onClick={() => handleSortClick("exposures")}
                      className="inline-flex min-h-7 cursor-pointer items-center justify-end gap-1 transition hover:opacity-80"
                    >
                      <span>Exposures</span>
                      {sortBy === "exposures" ? (
                        <SortDirectionArrow direction={sortDirection} />
                      ) : null}
                    </button>
                  </th>

                  <th
                    scope="col"
                    aria-sort={getAriaSort("ciLow")}
                    className="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    <button
                      type="button"
                      onClick={() => handleSortClick("ciLow")}
                      className="inline-flex min-h-7 cursor-pointer items-center gap-1 text-left transition hover:opacity-80"
                    >
                      <span>Positive Rate &amp; 95% CI</span>
                      {sortBy === "ciLow" ? (
                        <SortDirectionArrow direction={sortDirection} />
                      ) : null}
                    </button>
                  </th>

                  {showLiftColumn ? (
                    <th
                      scope="col"
                      aria-sort={getAriaSort("meanLiftPp")}
                      className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                    >
                      <button
                        type="button"
                        onClick={() => handleSortClick("meanLiftPp")}
                        className="inline-flex min-h-7 cursor-pointer items-center justify-end gap-1 transition hover:opacity-80"
                      >
                        <span>Same-Image Lift</span>
                        {sortBy === "meanLiftPp" ? (
                          <SortDirectionArrow direction={sortDirection} />
                        ) : null}
                      </button>
                    </th>
                  ) : null}

                  <th
                    scope="col"
                    aria-sort={getAriaSort("medianChainSeconds")}
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    <button
                      type="button"
                      onClick={() => handleSortClick("medianChainSeconds")}
                      className="inline-flex min-h-7 cursor-pointer items-center justify-end gap-1 transition hover:opacity-80"
                    >
                      <span>Chain Time</span>
                      {sortBy === "medianChainSeconds" ? (
                        <SortDirectionArrow direction={sortDirection} />
                      ) : null}
                    </button>
                  </th>

                  <th
                    scope="col"
                    aria-sort={getAriaSort("medianDwellMs")}
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    <button
                      type="button"
                      onClick={() => handleSortClick("medianDwellMs")}
                      className="inline-flex min-h-7 cursor-pointer items-center justify-end gap-1 transition hover:opacity-80"
                    >
                      <span>Median Dwell</span>
                      {sortBy === "medianDwellMs" ? (
                        <SortDirectionArrow direction={sortDirection} />
                      ) : null}
                    </button>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800/70">
                {visibleRows.map((row) => {
                  const isExpanded = expandedKeys.has(row.key);
                  const stepPills = resolveStepPills(row);
                  const topCaptions = row.topCaptions ?? [];
                  const bottomCaptions = row.bottomCaptions ?? [];
                  const fullDescription =
                    row.description ??
                    row.subtitle ??
                    (row.isUnattributed
                      ? "Captions without prompt chain lineage"
                      : null);

                  const rowClassName = [
                    row.isUnattributed
                      ? "border-t-2 border-slate-300/70 dark:border-slate-600/70"
                      : "",
                    isExpanded ? "bg-sky-500/6 dark:bg-cyan-300/6" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  const disclosureHint = isExpanded
                    ? "Hide prompt & sample jokes"
                    : row.exposures === 0
                      ? "View prompt & staged jokes"
                      : "View prompt & sample jokes";

                  return (
                    <Fragment key={row.key}>
                      <tr className={rowClassName || undefined}>
                        <td className="w-[calc(100vw-5.25rem)] min-w-52 max-w-[calc(100vw-5.25rem)] px-3.5 py-3 align-top sm:w-auto sm:min-w-72 sm:max-w-md">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpandedRow(row.key)}
                            className="group flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                          >
                            <ChevronRight
                              aria-hidden="true"
                              className={`mt-0.5 size-4 shrink-0 transition-transform ${
                                isExpanded
                                  ? "rotate-90 text-foreground"
                                  : "app-muted group-hover:text-foreground"
                              }`}
                            />
                            <span className="block min-w-0 max-w-full flex-1 overflow-hidden">
                              {row.kind === "flavor" ? (
                                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="break-words font-mono text-sm font-semibold text-foreground group-hover:underline">
                                    {row.label}
                                  </span>
                                  {row.stepCount !== null && row.stepCount > 0 ? (
                                    <span className="app-muted text-xs tabular-nums">
                                      {row.stepCount}{" "}
                                      {row.stepCount === 1 ? "step" : "steps"}
                                    </span>
                                  ) : null}
                                </span>
                              ) : row.kind === "pipeline" ? (
                                <span className="block max-w-full truncate font-mono text-xs font-semibold text-foreground group-hover:underline sm:max-w-md">
                                  {row.pipelineSteps.length > 0
                                    ? row.pipelineSteps.join(" → ")
                                    : row.label}
                                </span>
                              ) : (
                                <span className="font-semibold text-foreground group-hover:underline">
                                  {row.label}
                                </span>
                              )}

                              {row.kind === "flavor" &&
                              (row.subtitle || row.dominantModelLabel) ? (
                                <span className="app-muted mt-0.5 block max-w-full truncate text-xs sm:max-w-md">
                                  {[row.dominantModelLabel, row.subtitle]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              ) : row.kind === "model" && row.subtitle ? (
                                <span className="app-muted mt-0.5 block max-w-full truncate font-mono text-xs sm:max-w-md">
                                  {row.subtitle}
                                </span>
                              ) : row.kind === "pipeline" ? (
                                <span className="app-muted mt-0.5 block text-xs tabular-nums">
                                  {row.flavorCount.toLocaleString()}{" "}
                                  {row.flavorCount === 1 ? "flavor" : "flavors"}
                                </span>
                              ) : row.isUnattributed ? (
                                <span className="app-muted mt-0.5 block text-xs">
                                  {row.subtitle ??
                                    "Captions without prompt chain lineage"}
                                </span>
                              ) : null}

                              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums sm:hidden">
                                {row.rate !== null ? (
                                  <span className="font-semibold text-foreground">
                                    {formatRatePercent(row.rate)} positive
                                  </span>
                                ) : (
                                  <span className="app-muted">
                                    0 {exposureUnitLabel}
                                  </span>
                                )}
                                {showLiftColumn &&
                                row.sharedImageCount > 0 &&
                                row.meanLiftPp !== null ? (
                                  <span
                                    className={`font-semibold ${getLiftToneClassName(
                                      row.meanLiftPp,
                                    )}`}
                                  >
                                    · {formatSignedLiftPp(row.meanLiftPp)} lift
                                  </span>
                                ) : null}
                                <span className="app-muted">
                                  · {row.exposures.toLocaleString()}{" "}
                                  {exposureUnitLabel}
                                </span>
                              </span>

                              <span className="mt-1 block text-[11px] font-medium text-sky-800 dark:text-cyan-300">
                                {disclosureHint}
                              </span>
                            </span>
                          </button>
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top font-medium tabular-nums">
                          {row.captionCount.toLocaleString()}
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                          <span className="font-medium text-foreground">
                            {row.exposures.toLocaleString()}
                          </span>
                          <span className="app-muted mt-0.5 block text-xs">
                            {row.positive.toLocaleString()} positive
                          </span>
                        </td>

                        <td className="px-3.5 py-3 align-top">
                          {row.rate !== null &&
                          row.ciLow !== null &&
                          row.ciHigh !== null ? (
                            <div className="flex min-w-60 items-center gap-3">
                              <div className="relative h-2.5 w-28 shrink-0 rounded-full bg-slate-200/85 dark:bg-slate-800/90">
                                {studyPositiveRate !== null ? (
                                  <span
                                    aria-hidden="true"
                                    className="absolute bottom-[-2px] top-[-2px] w-px bg-slate-500/70 dark:bg-slate-400/70"
                                    style={{
                                      left: `${Math.min(
                                        100,
                                        Math.max(0, studyPositiveRate * 100),
                                      )}%`,
                                    }}
                                  />
                                ) : null}
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-y-0 rounded-full bg-sky-500/35 dark:bg-cyan-400/30"
                                  style={{
                                    left: `${row.ciLow * 100}%`,
                                    width: `${Math.max(
                                      (row.ciHigh - row.ciLow) * 100,
                                      1.5,
                                    )}%`,
                                  }}
                                />
                                <span
                                  aria-hidden="true"
                                  className="absolute bottom-0 top-0 w-1 -translate-x-1/2 rounded-full bg-teal-700 dark:bg-cyan-300"
                                  style={{ left: `${row.rate * 100}%` }}
                                />
                              </div>
                              <span className="whitespace-nowrap tabular-nums">
                                <span className="font-semibold text-foreground">
                                  {formatRatePercent(row.rate)}
                                </span>{" "}
                                <span className="app-muted text-xs">
                                  [{formatRatePercent(row.ciLow)},{" "}
                                  {formatRatePercent(row.ciHigh)}]
                                </span>
                              </span>
                            </div>
                          ) : (
                            <span className="app-muted text-xs">
                              — (0 {exposureUnitLabel})
                            </span>
                          )}
                        </td>

                        {showLiftColumn ? (
                          <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                            {row.sharedImageCount > 0 &&
                            row.meanLiftPp !== null ? (
                              <div>
                                <span
                                  className={`font-semibold ${getLiftToneClassName(
                                    row.meanLiftPp,
                                  )}`}
                                >
                                  {formatSignedLiftPp(row.meanLiftPp)}
                                </span>
                                <span className="app-muted mt-0.5 block text-xs">
                                  {row.sharedImageCount.toLocaleString()} shared{" "}
                                  {row.sharedImageCount === 1 ? "img" : "imgs"}
                                </span>
                              </div>
                            ) : (
                              <span className="app-muted">—</span>
                            )}
                          </td>
                        ) : null}

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                          {row.medianChainSeconds !== null ? (
                            <span className="text-foreground">
                              {formatChainSecondsLabel(row.medianChainSeconds)}
                            </span>
                          ) : (
                            <span className="app-muted">—</span>
                          )}
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                          {row.medianDwellMs !== null ? (
                            <span className="text-foreground">
                              {formatDwellDurationLabel(row.medianDwellMs)}
                            </span>
                          ) : (
                            <span className="app-muted">—</span>
                          )}
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr className="bg-slate-500/4 dark:bg-slate-900/35">
                          <td
                            colSpan={totalColumnCount}
                            className="px-4 py-4 align-top"
                          >
                            <div className="max-w-[calc(100vw-6rem)] space-y-4 sm:max-w-none">
                              <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-slate-200/75 bg-white/45 p-3.5 sm:flex-row dark:border-slate-700/60 dark:bg-slate-950/30">
                                <div className="w-full min-w-0 space-y-2 sm:w-auto sm:flex-1">
                                  {fullDescription ? (
                                    <p className="max-w-4xl whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
                                      {fullDescription}
                                    </p>
                                  ) : (
                                    <p className="app-muted text-xs">
                                      No additional prompt description recorded.
                                    </p>
                                  )}

                                  {stepPills.length > 0 ? (
                                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
                                      {stepPills.map((step, index) => (
                                        <Fragment
                                          key={`${step.stepOrder}-${step.modelName}-${index}`}
                                        >
                                          {index > 0 ? (
                                            <span
                                              aria-hidden="true"
                                              className="app-muted font-mono"
                                            >
                                              →
                                            </span>
                                          ) : null}
                                          <span className="inline-flex items-center gap-1 rounded-md border border-slate-300/70 bg-white/70 px-2 py-0.5 font-mono text-[11px] text-foreground dark:border-slate-700/70 dark:bg-slate-900/70">
                                            <span className="app-muted">
                                              Step {step.stepOrder}:
                                            </span>
                                            <span className="font-semibold">
                                              {step.modelName}
                                            </span>
                                            {step.providerName ? (
                                              <span className="app-muted">
                                                ({step.providerName})
                                              </span>
                                            ) : null}
                                          </span>
                                        </Fragment>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>

                                {row.kind === "flavor" &&
                                row.flavorId !== null ? (
                                  <Link
                                    href={`/study/${studyId}/head-to-head?flavor=${row.flavorId}${excludeQuerySuffix}`}
                                    className="app-button inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                                  >
                                    {flavorCount >= 2
                                      ? "Compare in Head-to-Head →"
                                      : "Cross-study trajectory →"}
                                  </Link>
                                ) : null}
                              </div>

                              {topCaptions.length > 0 ? (
                                <div className="space-y-3">
                                  <div className="space-y-2">
                                    <p className="app-kicker text-xs font-semibold uppercase tracking-wide">
                                      {row.exposures === 0
                                        ? `Staged captions (${topCaptions.length})`
                                        : bottomCaptions.length > 0
                                          ? `Highest-rated captions (${topCaptions.length})`
                                          : `Sample captions (${topCaptions.length})`}
                                    </p>
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                      {topCaptions.map((sample) => (
                                        <DrilldownSampleCaptionCard
                                          key={`top-${sample.captionId}`}
                                          sample={sample}
                                          exposureUnitLabel={exposureUnitLabel}
                                          imageBroken={brokenCaptionImageIds.has(
                                            sample.captionId,
                                          )}
                                          onImageError={markCaptionImageBroken}
                                        />
                                      ))}
                                    </div>
                                  </div>

                                  {bottomCaptions.length > 0 ? (
                                    <div className="space-y-2 pt-1">
                                      <p className="app-kicker text-xs font-semibold uppercase tracking-wide">
                                        Lowest-rated captions (
                                        {bottomCaptions.length})
                                      </p>
                                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                        {bottomCaptions.map((sample) => (
                                          <DrilldownSampleCaptionCard
                                            key={`low-${sample.captionId}`}
                                            sample={sample}
                                            exposureUnitLabel={exposureUnitLabel}
                                            imageBroken={brokenCaptionImageIds.has(
                                              sample.captionId,
                                            )}
                                            onImageError={markCaptionImageBroken}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
