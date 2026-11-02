"use client";

import { ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useDeferredValue, useMemo, useState } from "react";

import { AppSelect, type AppSelectOption } from "@/components/app-select";
import {
  formatChainSecondsLabel,
  formatCompactCount,
  formatHubPercent,
} from "@/utils/attribution-ui-helpers";
import type {
  GlobalModelLeaderboardRow,
  UnevaluatedModelCatalogItem,
} from "@/utils/global-attribution-loader";

type ModelRoleLens = "synthesis" | "pipeline";
type ModelSortMode = "ci_low" | "exposures" | "studies" | "latency" | "name";

const MODEL_SORT_OPTIONS: ReadonlyArray<AppSelectOption<ModelSortMode>> = [
  { value: "ci_low", label: "Highest positive rate (95% CI)" },
  { value: "exposures", label: "Most exposures" },
  { value: "studies", label: "Most studies" },
  { value: "latency", label: "Fastest median generation" },
  { value: "name", label: "Model name (A–Z)" },
];

const compareNullableDesc = (a: number | null, b: number | null): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
};

const compareNullableAsc = (a: number | null, b: number | null): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};

const pickLensMetrics = (
  row: GlobalModelLeaderboardRow,
  lens: ModelRoleLens,
) => {
  // In synthesis lens, surface synthesis metrics when the model synthesized >= 1
  // caption; for upstream-only vision/draft models (0 synthesis captions), show
  // their pipeline-step participation with an explicit Upstream badge.
  const useSynthesis = lens === "synthesis" && row.synthesisCaptionCount > 0;
  return {
    isUpstreamFallback: lens === "synthesis" && row.synthesisCaptionCount === 0,
    studyCount: useSynthesis
      ? row.synthesisStudyCount
      : row.pipelineStudyCount,
    flavorCount: useSynthesis
      ? row.synthesisFlavorCount
      : row.pipelineFlavorCount,
    captionCount: useSynthesis
      ? row.synthesisCaptionCount
      : row.pipelineCaptionCount,
    exposures: useSynthesis ? row.synthesisExposures : row.pipelineExposures,
    rate: useSynthesis ? row.synthesisRate : row.pipelineRate,
    ciLow: useSynthesis ? row.synthesisCiLow : row.pipelineCiLow,
    ciHigh: useSynthesis ? row.synthesisCiHigh : row.pipelineCiHigh,
  };
};

export function GlobalModelLeaderboard({
  models,
  unevaluatedModels,
  initialModelParam,
  initialQuery = "",
  onClearEntityFocus,
}: {
  models: GlobalModelLeaderboardRow[];
  unevaluatedModels: UnevaluatedModelCatalogItem[];
  initialModelParam?: string;
  initialQuery?: string;
  onClearEntityFocus?: () => void;
}) {
  const matchedInitialModel = useMemo(() => {
    const trimmed = initialModelParam?.trim();
    if (!trimmed) {
      return null;
    }
    const lower = trimmed.toLowerCase();
    return (
      models.find(
        (row) =>
          String(row.modelId) === trimmed ||
          row.name.toLowerCase() === lower ||
          row.providerModelId.toLowerCase() === lower,
      ) ?? null
    );
  }, [models, initialModelParam]);

  const [pinnedModelId, setPinnedModelId] = useState<number | null>(
    () => matchedInitialModel?.modelId ?? null,
  );
  const [missingNoticeDismissed, setMissingNoticeDismissed] = useState(false);
  const [roleLens, setRoleLens] = useState<ModelRoleLens>("synthesis");
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [sortMode, setSortMode] = useState<ModelSortMode>("ci_low");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() =>
    matchedInitialModel ? new Set([matchedInitialModel.modelId]) : new Set(),
  );
  const [showUnevaluated, setShowUnevaluated] = useState(false);

  const deferredQuery = useDeferredValue(searchQuery);

  const toggleExpanded = (modelId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const clearPinnedModel = () => {
    setPinnedModelId(null);
    setMissingNoticeDismissed(true);
    onClearEntityFocus?.();
  };

  const visibleRows = useMemo(() => {
    const trimmed = deferredQuery.trim().toLowerCase();
    const filtered = models.filter((row) => {
      if (pinnedModelId !== null) {
        return row.modelId === pinnedModelId;
      }
      if (trimmed.length === 0) {
        return true;
      }
      return (
        row.name.toLowerCase().includes(trimmed) ||
        row.providerModelId.toLowerCase().includes(trimmed) ||
        row.providerName.toLowerCase().includes(trimmed) ||
        row.studies.some(
          (study) =>
            String(study.studyId) === trimmed.replace(/^#/, "") ||
            study.studyTitle.toLowerCase().includes(trimmed),
        )
      );
    });

    return [...filtered].sort((left, right) => {
      const l = pickLensMetrics(left, roleLens);
      const r = pickLensMetrics(right, roleLens);

      // In default synthesis rate ranking, group synthesis models ahead of
      // upstream-only draft/vision helpers.
      if (
        roleLens === "synthesis" &&
        sortMode === "ci_low" &&
        l.isUpstreamFallback !== r.isUpstreamFallback
      ) {
        return l.isUpstreamFallback ? 1 : -1;
      }

      if (sortMode === "exposures") {
        if (l.exposures !== r.exposures) return r.exposures - l.exposures;
      } else if (sortMode === "studies") {
        if (l.studyCount !== r.studyCount) return r.studyCount - l.studyCount;
        if (l.exposures !== r.exposures) return r.exposures - l.exposures;
      } else if (sortMode === "latency") {
        const cmp = compareNullableAsc(
          left.medianChainSeconds,
          right.medianChainSeconds,
        );
        if (cmp !== 0) return cmp;
      } else if (sortMode === "name") {
        return left.name.localeCompare(right.name);
      }

      const ciCmp = compareNullableDesc(l.ciLow, r.ciLow);
      if (ciCmp !== 0) return ciCmp;
      const rateCmp = compareNullableDesc(l.rate, r.rate);
      if (rateCmp !== 0) return rateCmp;
      if (l.exposures !== r.exposures) return r.exposures - l.exposures;
      return left.name.localeCompare(right.name);
    });
  }, [models, deferredQuery, pinnedModelId, roleLens, sortMode]);

  const pinnedModel =
    pinnedModelId !== null
      ? models.find((row) => row.modelId === pinnedModelId) ?? null
      : null;

  const showMissingNotice =
    Boolean(initialModelParam?.trim()) &&
    matchedInitialModel === null &&
    !missingNoticeDismissed;

  const renderStudiesBreakdown = (row: GlobalModelLeaderboardRow) => (
    <div className="space-y-2 rounded-xl border border-slate-200/75 bg-white/65 p-3.5 text-xs dark:border-slate-700/75 dark:bg-slate-950/45">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <span className="app-muted">
          Provider ID:{" "}
          <span className="font-mono text-foreground">{row.providerModelId}</span>
        </span>
        <span className="app-muted tabular-nums">
          Synthesis: {row.synthesisStudyCount}{" "}
          {row.synthesisStudyCount === 1 ? "study" : "studies"} (
          {row.synthesisCaptionCount.toLocaleString()} caps) · All chain steps:{" "}
          {row.pipelineStudyCount}{" "}
          {row.pipelineStudyCount === 1 ? "study" : "studies"} (
          {row.pipelineCaptionCount.toLocaleString()} caps)
        </span>
      </div>

      <div className="space-y-1.5">
        {row.studies.map((study) => (
          <div
            key={`${row.modelId}-study-${study.studyId}`}
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
                    study.role === "synthesis"
                      ? "inline-flex rounded bg-teal-500/15 px-1.5 py-0.5 text-[11px] font-medium text-teal-900 ring-1 ring-teal-500/30 dark:text-cyan-100"
                      : "inline-flex rounded bg-slate-500/15 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-500/25 dark:text-slate-200"
                  }
                >
                  {study.role === "synthesis"
                    ? "Synthesis step"
                    : "Pipeline step"}
                </span>
                <span className="app-muted text-[11px]">
                  {study.formatDisplayLabel}
                </span>
              </div>
              <p className="app-muted mt-0.5 tabular-nums">
                {study.captionCount.toLocaleString()}{" "}
                {study.captionCount === 1 ? "caption" : "captions"} ·{" "}
                {study.exposures > 0
                  ? `${study.exposures.toLocaleString()} exposures · ${formatHubPercent(study.rate)}`
                  : "0 votes yet"}
              </p>
            </div>

            <Link
              href={study.href}
              className="app-button inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-medium transition"
            >
              Open Study #{study.studyId} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3" aria-busy={deferredQuery !== searchQuery}>
      {pinnedModel ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-500/12 px-3.5 py-2 text-xs ring-1 ring-sky-500/30 dark:bg-cyan-300/12 dark:ring-cyan-300/25">
          <span>
            Focused on model{" "}
            <span className="font-semibold text-foreground">
              {pinnedModel.name}
            </span>{" "}
            ({pinnedModel.providerName}) across{" "}
            {pinnedModel.pipelineStudyCount}{" "}
            {pinnedModel.pipelineStudyCount === 1 ? "study" : "studies"}.
          </span>
          <button
            type="button"
            onClick={clearPinnedModel}
            className="app-button inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Show all {models.length} models
          </button>
        </div>
      ) : null}

      {showMissingNotice ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/14 px-3.5 py-2 text-xs text-amber-950 ring-1 ring-amber-500/30 dark:text-amber-100">
          <span>
            Model &ldquo;{initialModelParam}&rdquo; has no evaluated study runs.
            Showing all {models.length} evaluated models.
          </span>
          <button
            type="button"
            onClick={clearPinnedModel}
            className="app-button inline-flex h-7 items-center rounded-md px-2 text-xs"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search
              aria-hidden="true"
              className="app-muted pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => {
                if (pinnedModelId !== null) {
                  setPinnedModelId(null);
                }
                setSearchQuery(event.target.value);
              }}
              placeholder="Filter models or providers..."
              aria-label="Filter evaluated LLM models"
              className="app-input h-9 w-full rounded-lg pl-9 pr-3 text-sm outline-none"
            />
          </div>

          <div
            role="group"
            aria-label="Model attribution lens"
            className="app-input inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {(
              [
                { id: "synthesis", label: "Final synthesis" },
                { id: "pipeline", label: "Any chain step" },
              ] as const
            ).map((opt) => {
              const active = roleLens === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRoleLens(opt.id)}
                  className={`h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition ${
                    active
                      ? "bg-white text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                      : "app-muted hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AppSelect<ModelSortMode>
            options={MODEL_SORT_OPTIONS}
            value={sortMode}
            onValueChange={setSortMode}
            ariaLabel="Sort LLM models"
            menuMinWidthPx={230}
            className="w-56 rounded-lg text-xs sm:w-60 sm:text-sm"
          />
          <span className="app-muted text-xs tabular-nums">
            {visibleRows.length} of {models.length} evaluated
          </span>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="app-card flex flex-col items-center justify-center gap-3 rounded-xl p-6 text-center text-sm">
          <p className="app-muted">No evaluated models match this filter.</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              clearPinnedModel();
            }}
            className="app-button inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium transition"
          >
            Reset filter
          </button>
        </div>
      ) : (
        <>
          {/* Mobile < md cards */}
          <div className="space-y-2.5 md:hidden">
            {visibleRows.map((row, index) => {
              const isExpanded = expandedIds.has(row.modelId);
              const m = pickLensMetrics(row, roleLens);
              return (
                <article
                  key={row.modelId}
                  className="app-card overflow-hidden rounded-xl p-3.5"
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpanded(row.modelId)}
                    className="flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ChevronRight
                          aria-hidden="true"
                          className={`app-muted h-4 w-4 shrink-0 transition-transform ${
                            isExpanded ? "rotate-90 text-foreground" : ""
                          }`}
                        />
                        <span className="app-muted font-mono text-xs tabular-nums">
                          #{index + 1}
                        </span>
                        <span className="font-semibold text-foreground">
                          {row.name}
                        </span>
                        <span className="app-muted text-xs">
                          · {row.providerName}
                        </span>
                      </div>
                      <p className="app-muted mt-1 pl-5 text-xs tabular-nums">
                        {m.isUpstreamFallback ? "Upstream step · " : ""}
                        {m.studyCount}{" "}
                        {m.studyCount === 1 ? "study" : "studies"} ·{" "}
                        {m.flavorCount}{" "}
                        {m.flavorCount === 1 ? "flavor" : "flavors"} ·{" "}
                        {formatCompactCount(m.exposures)} exposures
                      </p>
                    </div>

                    <div className="shrink-0 text-right tabular-nums">
                      <p className="text-sm font-semibold text-foreground">
                        {formatHubPercent(m.rate)}
                      </p>
                      <p className="app-muted text-xs">
                        {row.medianChainSeconds !== null
                          ? `${formatChainSecondsLabel(row.medianChainSeconds)} chain`
                          : m.isUpstreamFallback
                            ? "Upstream only"
                            : "No timing"}
                      </p>
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="mt-3">{renderStudiesBreakdown(row)}</div>
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
                    Model
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    Provider & Role
                  </th>
                  <th
                    scope="col"
                    className="px-3.5 py-2.5 text-right text-xs font-semibold uppercase tracking-wide"
                  >
                    Studies & Flavors
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
                    Median Chain Time
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800/70">
                {visibleRows.map((row, index) => {
                  const isExpanded = expandedIds.has(row.modelId);
                  const m = pickLensMetrics(row, roleLens);
                  const lowPct =
                    m.ciLow !== null
                      ? Math.max(0, Math.min(100, m.ciLow * 100))
                      : 0;
                  const highPct =
                    m.ciHigh !== null
                      ? Math.max(lowPct, Math.min(100, m.ciHigh * 100))
                      : 0;
                  const pointPct =
                    m.rate !== null
                      ? Math.max(0, Math.min(100, m.rate * 100))
                      : 0;

                  return (
                    <Fragment key={row.modelId}>
                      <tr className="transition hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.03]">
                        <td className="px-3.5 py-3 align-top">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpanded(row.modelId)}
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
                                <span className="font-semibold text-foreground group-hover:underline">
                                  {row.name}
                                </span>
                              </span>
                              <span className="app-muted mt-0.5 block font-mono text-xs">
                                {row.providerModelId}
                              </span>
                              <span className="app-kicker mt-1 inline-block text-[11px] font-medium">
                                {isExpanded
                                  ? "Hide studies"
                                  : `View ${row.studies.length} ${
                                      row.studies.length === 1
                                        ? "study"
                                        : "studies"
                                    }`}
                              </span>
                            </span>
                          </button>
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 align-top text-xs">
                          <span className="font-medium text-foreground">
                            {row.providerName}
                          </span>
                          <span className="mt-1 block">
                            {m.isUpstreamFallback ? (
                              <span className="inline-flex rounded bg-slate-500/15 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-500/25 dark:text-slate-200">
                                Upstream chain step
                              </span>
                            ) : (
                              <span className="inline-flex rounded bg-teal-500/14 px-1.5 py-0.5 text-[11px] font-medium text-teal-900 ring-1 ring-teal-500/30 dark:text-cyan-100">
                                Synthesis
                                {row.pipelineStudyCount > row.synthesisStudyCount
                                  ? ` + ${row.pipelineStudyCount - row.synthesisStudyCount} upstream`
                                  : ""}
                              </span>
                            )}
                          </span>
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                          <span className="font-semibold text-foreground">
                            {m.studyCount}{" "}
                            {m.studyCount === 1 ? "study" : "studies"}
                          </span>
                          <span className="app-muted mt-0.5 block text-xs">
                            {m.flavorCount}{" "}
                            {m.flavorCount === 1 ? "flavor" : "flavors"} ·{" "}
                            {m.captionCount.toLocaleString()} caps
                          </span>
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top font-semibold tabular-nums text-foreground">
                          {m.exposures.toLocaleString()}
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top">
                          {m.rate !== null &&
                          m.ciLow !== null &&
                          m.ciHigh !== null ? (
                            <div className="space-y-1">
                              <div className="flex items-baseline justify-end gap-2">
                                <span className="font-semibold tabular-nums text-foreground">
                                  {formatHubPercent(m.rate)}
                                </span>
                                <span className="app-muted text-[11px] tabular-nums">
                                  [{formatHubPercent(m.ciLow)},{" "}
                                  {formatHubPercent(m.ciHigh)}]
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
                          ) : (
                            <span className="app-muted text-xs">
                              No votes yet
                            </span>
                          )}
                        </td>

                        <td className="whitespace-nowrap px-3.5 py-3 text-right align-top tabular-nums">
                          <span className="font-medium text-foreground">
                            {formatChainSecondsLabel(row.medianChainSeconds)}
                          </span>
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr>
                          <td colSpan={6} className="px-4 pb-4 pt-1">
                            {renderStudiesBreakdown(row)}
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

      {unevaluatedModels.length > 0 ? (
        <div className="rounded-xl border border-slate-200/70 bg-white/45 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900/35">
          <button
            type="button"
            aria-expanded={showUnevaluated}
            onClick={() => setShowUnevaluated((prev) => !prev)}
            className="app-muted flex w-full items-center justify-between gap-2 text-left text-xs font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span>
              {unevaluatedModels.length} catalog{" "}
              {unevaluatedModels.length === 1 ? "model" : "models"} without study
              runs
            </span>
            <ChevronRight
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${
                showUnevaluated ? "rotate-90" : ""
              }`}
            />
          </button>

          {showUnevaluated ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {unevaluatedModels.map((item) => (
                <span
                  key={item.modelId}
                  className="app-muted inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1 text-xs dark:border-slate-700/80 dark:bg-slate-950/60"
                >
                  <span className="font-medium text-foreground">
                    {item.name}
                  </span>
                  <span>· {item.providerName}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
