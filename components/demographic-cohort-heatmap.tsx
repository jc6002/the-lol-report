"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { AppSelect, type AppSelectOption } from "@/components/app-select";

import {
  buildHeadToHeadFlavorHref,
  formatQuestionRespondentLabel,
  formatSignedPp,
  formatStudioRate,
  getCohortRowVoterSubtitle,
  getHeatmapTintClassName,
  hasSuppressedCohortPool,
} from "@/utils/attribution-export";
import {
  abbreviateSurveyQuestion,
  type AttributionLeaderboardRow,
  type AttributionSampleCaption,
  type CohortFlavorCell,
  type DemographicMatrixBundle,
} from "@/utils/attribution-stats";

export type DemographicCohortHeatmapProps = {
  studyId: number;
  studyRate: number | null;
  exposureUnitLabel: "seen cards" | "votes";
  excludeHighRisk: boolean;
  demographics: DemographicMatrixBundle;
  flavorRows?: readonly AttributionLeaderboardRow[];
  overallSampleCaptions?: readonly AttributionSampleCaption[];
};

type HeatmapMetricMode = "rate" | "delta";
type ColumnScopeMode = "top8" | "all";

type PinnedCellKey = {
  questionId: number;
  rowKey: string;
  columnKey: string;
};

const TOP_FLAVOR_COLUMN_LIMIT = 8;
const INITIAL_TASTE_GAP_LIMIT = 15;
const STICKY_COLUMN_BG_CLASS =
  "border-r border-slate-200/70 bg-[#fffaf3] dark:border-slate-700/60 dark:bg-[#0c1627]";

function PinnedSampleCaptionCard({
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
        <div className="flex h-40 w-full items-center justify-center bg-white/45 p-2.5 dark:bg-slate-950/25">
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
        <div className="flex h-40 w-full items-center justify-center bg-white/45 p-4 text-xs dark:bg-slate-950/25">
          <span className="app-muted">Image unavailable</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <p className="break-words text-sm font-semibold leading-5 text-foreground">
          {sample.captionText}
        </p>
        <div className="mt-auto pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2 text-xs tabular-nums dark:border-slate-700/60">
            <span className="font-semibold text-foreground">
              {formatStudioRate(sample.rate)}{" "}
              <span className="app-muted font-normal">
                study-wide ({sample.positive.toLocaleString()}/
                {sample.exposures.toLocaleString()} {exposureUnitLabel})
              </span>
            </span>
            <span className="app-muted truncate font-mono text-[11px]">
              {sample.modelName}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function DemographicCohortHeatmap({
  studyId,
  studyRate,
  exposureUnitLabel,
  excludeHighRisk,
  demographics,
  flavorRows = [],
  overallSampleCaptions = [],
}: DemographicCohortHeatmapProps) {
  const defaultQuestion =
    demographics.questions.find((q) => q.visibleSegmentCount > 0) ??
    demographics.questions[0];

  const [selectedQuestionId, setSelectedQuestionId] = useState<number>(
    defaultQuestion?.questionId ?? 0,
  );
  const [metricMode, setMetricMode] = useState<HeatmapMetricMode>("rate");
  const [columnScope, setColumnScope] = useState<ColumnScopeMode>("top8");
  const [pinnedKey, setPinnedKey] = useState<PinnedCellKey | null>(null);
  const [showAllGaps, setShowAllGaps] = useState(false);
  const [brokenCaptionImageIds, setBrokenCaptionImageIds] = useState<
    Set<string>
  >(() => new Set());

  const activeQuestion =
    demographics.questions.find((q) => q.questionId === selectedQuestionId) ??
    defaultQuestion;
  const activeQuestionHasSuppressedPool = activeQuestion
    ? hasSuppressedCohortPool(activeQuestion)
    : false;
  const questionOptions = useMemo<AppSelectOption[]>(
    () =>
      demographics.questions.map((question) => ({
        value: String(question.questionId),
        label: `${question.questionText} (${formatQuestionRespondentLabel(question)})`,
      })),
    [demographics.questions],
  );

  const isSingleFlavorStudy = demographics.flavorColumns.length <= 1;
  const soleFlavorColumn =
    demographics.flavorColumns.length === 1
      ? demographics.flavorColumns[0]
      : null;

  const hasColumnScopeToggle =
    !isSingleFlavorStudy &&
    demographics.flavorColumns.length > TOP_FLAVOR_COLUMN_LIMIT;
  const visibleFlavorColumns = isSingleFlavorStudy
    ? []
    : hasColumnScopeToggle && columnScope === "top8"
      ? demographics.flavorColumns.slice(0, TOP_FLAVOR_COLUMN_LIMIT)
      : demographics.flavorColumns;

  const flavorRowByKey = useMemo(
    () => new Map(flavorRows.map((row) => [row.key, row])),
    [flavorRows],
  );

  const resolvedPinned = (() => {
    if (
      !pinnedKey ||
      !activeQuestion ||
      pinnedKey.questionId !== activeQuestion.questionId
    ) {
      return null;
    }
    const row = activeQuestion.rows.find(
      (candidate) => candidate.rowKey === pinnedKey.rowKey,
    );
    if (!row) {
      return null;
    }
    const cell =
      pinnedKey.columnKey === "__overall__"
        ? row.overallCell
        : row.cellsByFlavorKey[pinnedKey.columnKey];
    if (!cell || cell.status !== "visible") {
      return null;
    }

    const matchedFlavorColumn =
      pinnedKey.columnKey === "__overall__"
        ? soleFlavorColumn
        : (demographics.flavorColumns.find(
            (col) => col.flavorKey === pinnedKey.columnKey,
          ) ?? null);

    const columnLabel =
      pinnedKey.columnKey === "__overall__"
        ? soleFlavorColumn
          ? soleFlavorColumn.flavorSlug
          : "All study captions"
        : (matchedFlavorColumn?.flavorSlug ?? pinnedKey.columnKey);

    const sampleCaptions =
      pinnedKey.columnKey === "__overall__"
        ? (soleFlavorColumn
            ? flavorRowByKey.get(soleFlavorColumn.flavorKey)?.topCaptions
            : undefined) ?? overallSampleCaptions
        : (flavorRowByKey.get(pinnedKey.columnKey)?.topCaptions ?? []);

    return {
      questionLabel: abbreviateSurveyQuestion(activeQuestion.questionText),
      rowLabel: row.label,
      columnLabel,
      flavorId: matchedFlavorColumn?.flavorId ?? null,
      cell,
      sampleCaptions: sampleCaptions.slice(0, 3),
      hideVoterCount:
        row.rowKind === "unsurveyed" && activeQuestionHasSuppressedPool,
    };
  })();

  const togglePinnedCell = (rowKey: string, columnKey: string) => {
    if (!activeQuestion) {
      return;
    }
    setPinnedKey((prev) => {
      if (
        prev &&
        prev.questionId === activeQuestion.questionId &&
        prev.rowKey === rowKey &&
        prev.columnKey === columnKey
      ) {
        return null;
      }
      return { questionId: activeQuestion.questionId, rowKey, columnKey };
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

  const renderMatrixCell = ({
    rowKey,
    columnKey,
    cell,
    extraClassName = "",
    hideVoterCount = false,
  }: {
    rowKey: string;
    columnKey: string;
    cell: CohortFlavorCell | undefined;
    extraClassName?: string;
    hideVoterCount?: boolean;
  }) => {
    if (!cell || cell.status === "empty") {
      return (
        <td
          key={columnKey}
          className={`px-3 py-2.5 text-center align-middle ${extraClassName}`}
        >
          <span className="app-muted text-xs">—</span>
        </td>
      );
    }

    if (cell.status === "suppressed") {
      return (
        <td
          key={columnKey}
          className={`bg-slate-500/6 px-3 py-2.5 text-center align-middle dark:bg-slate-400/6 ${extraClassName}`}
        >
          <span className="app-muted text-xs font-medium">n &lt; 5</span>
        </td>
      );
    }

    const isPinned =
      activeQuestion !== undefined &&
      pinnedKey?.questionId === activeQuestion.questionId &&
      pinnedKey.rowKey === rowKey &&
      pinnedKey.columnKey === columnKey;

    const primaryText =
      metricMode === "rate"
        ? formatStudioRate(cell.rate)
        : formatSignedPp(cell.deltaPp);
    const secondaryMetric =
      metricMode === "rate"
        ? formatSignedPp(cell.deltaPp)
        : formatStudioRate(cell.rate);
    const titleSummary = `95% CI [${formatStudioRate(cell.ciLow)}, ${formatStudioRate(cell.ciHigh)}] · ${cell.positive.toLocaleString()}/${cell.exposures.toLocaleString()} positive ${exposureUnitLabel}`;

    return (
      <td
        key={columnKey}
        className={`px-2 py-1.5 text-right align-middle ${getHeatmapTintClassName(cell.deltaPp)} ${extraClassName}`}
      >
        <button
          type="button"
          onClick={() => togglePinnedCell(rowKey, columnKey)}
          aria-pressed={isPinned}
          title={titleSummary}
          className={`min-h-9 w-full cursor-pointer rounded-md px-1.5 py-1 text-right tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
            isPinned
              ? "ring-2 ring-sky-600 dark:ring-cyan-300"
              : "hover:bg-slate-900/5 dark:hover:bg-white/6"
          }`}
        >
          <span className="block font-semibold text-foreground">
            {primaryText}
          </span>
          <span className="app-muted block text-[11px]">
            {hideVoterCount
              ? secondaryMetric
              : `${secondaryMetric} · n=${cell.distinctVoters.toLocaleString()}`}
          </span>
        </button>
      </td>
    );
  };

  const visibleTasteGaps = showAllGaps
    ? demographics.tasteGaps
    : demographics.tasteGaps.slice(0, INITIAL_TASTE_GAP_LIMIT);

  return (
    <div className="space-y-5">
      {activeQuestion ? (
        <section className="space-y-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <AppSelect
                ariaLabel="Demographic survey question"
                options={questionOptions}
                value={String(activeQuestion.questionId)}
                onValueChange={(nextValue) => {
                  const parsed = Number.parseInt(nextValue, 10);
                  if (Number.isInteger(parsed)) {
                    setSelectedQuestionId(parsed);
                  }
                }}
                menuMinWidthPx={320}
                menuMaxWidthPx={520}
                searchPlaceholder="Filter survey questions..."
                className="w-full min-w-0 max-w-full rounded-lg text-xs sm:w-[26rem] sm:max-w-lg sm:text-sm"
              />

              <div className="app-input inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg p-1 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  aria-pressed={metricMode === "rate"}
                  onClick={() => setMetricMode("rate")}
                  className={`h-7 shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    metricMode === "rate"
                      ? "bg-white text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                      : "app-muted hover:text-foreground"
                  }`}
                >
                  Positive rate
                </button>
                <button
                  type="button"
                  aria-pressed={metricMode === "delta"}
                  onClick={() => setMetricMode("delta")}
                  className={`h-7 shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    metricMode === "delta"
                      ? "bg-white text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                      : "app-muted hover:text-foreground"
                  }`}
                >
                  Delta vs. study
                </button>
              </div>

              {hasColumnScopeToggle ? (
                <div className="app-input inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg p-1 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <button
                    type="button"
                    aria-pressed={columnScope === "top8"}
                    onClick={() => setColumnScope("top8")}
                    className={`h-7 shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                      columnScope === "top8"
                        ? "bg-white text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                        : "app-muted hover:text-foreground"
                    }`}
                  >
                    Top {TOP_FLAVOR_COLUMN_LIMIT} flavors
                  </button>
                  <button
                    type="button"
                    aria-pressed={columnScope === "all"}
                    onClick={() => setColumnScope("all")}
                    className={`h-7 shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                      columnScope === "all"
                        ? "bg-white text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                        : "app-muted hover:text-foreground"
                    }`}
                  >
                    All {demographics.flavorColumns.length} flavors
                  </button>
                </div>
              ) : null}
            </div>

            <div className="app-muted flex flex-wrap items-center gap-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span>Below mean</span>
                <span
                  className="inline-flex items-center gap-1"
                  aria-hidden="true"
                >
                  <span className="h-3 w-3.5 rounded-sm bg-rose-500/24 ring-1 ring-slate-400/25" />
                  <span className="h-3 w-3.5 rounded-sm bg-rose-500/12 ring-1 ring-slate-400/25" />
                  <span className="h-3 w-3.5 rounded-sm border border-slate-300/70 dark:border-slate-600/70" />
                  <span className="h-3 w-3.5 rounded-sm bg-teal-500/12 ring-1 ring-slate-400/25" />
                  <span className="h-3 w-3.5 rounded-sm bg-teal-500/24 ring-1 ring-slate-400/25" />
                </span>
                <span>Above mean</span>
              </span>
              <span className="whitespace-nowrap rounded bg-slate-500/10 px-1.5 py-0.5 font-medium">
                n &lt; 5 masked
              </span>
            </div>
          </div>

          {activeQuestion.rows.length > 0 ? (
            <div className="app-table-shell overflow-x-auto rounded-xl">
              <table className="app-table min-w-full divide-y divide-slate-200/60 text-sm dark:divide-slate-700/60">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className={`sticky left-0 z-10 min-w-40 px-3 py-2.5 text-left font-semibold sm:min-w-52 ${STICKY_COLUMN_BG_CLASS}`}
                    >
                      Segment
                    </th>
                    <th
                      scope="col"
                      className={`min-w-36 px-3 py-2.5 text-right font-semibold ${
                        visibleFlavorColumns.length > 0
                          ? "border-r border-slate-300/60 dark:border-slate-700/60"
                          : ""
                      }`}
                    >
                      {isSingleFlavorStudy
                        ? "Positive Rate by Segment"
                        : "All study captions"}
                      <span className="app-muted block text-[11px] font-normal tabular-nums">
                        {soleFlavorColumn ? (
                          <>
                            <span className="font-mono">
                              {soleFlavorColumn.flavorSlug}
                            </span>{" "}
                            · Study: {formatStudioRate(studyRate)}
                          </>
                        ) : (
                          `Study: ${formatStudioRate(studyRate)}`
                        )}
                      </span>
                    </th>
                    {visibleFlavorColumns.map((column) => (
                      <th
                        key={column.flavorKey}
                        scope="col"
                        className="min-w-36 px-3 py-2.5 text-right font-semibold"
                      >
                        <Link
                          href={buildHeadToHeadFlavorHref(
                            studyId,
                            column.flavorId,
                            excludeHighRisk,
                          )}
                          className="font-mono text-xs font-semibold hover:underline focus-visible:outline-none focus-visible:underline"
                        >
                          {column.flavorSlug}
                        </Link>
                        <span className="app-muted block text-[11px] font-normal tabular-nums">
                          Study: {formatStudioRate(column.studyRate)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-700/60">
                  {activeQuestion.rows.map((row, rowIndex) => {
                    const prevRow =
                      rowIndex > 0 ? activeQuestion.rows[rowIndex - 1] : null;
                    const needsSectionDivider =
                      prevRow?.rowKind === "answer" && row.rowKind !== "answer";
                    const voterSubtitle = getCohortRowVoterSubtitle(
                      row,
                      activeQuestionHasSuppressedPool,
                    );
                    const hideCellVoterCount =
                      row.rowKind === "unsurveyed" &&
                      activeQuestionHasSuppressedPool;

                    return (
                      <tr
                        key={row.rowKey}
                        className={
                          needsSectionDivider
                            ? "border-t-2 border-slate-300/70 dark:border-slate-600/70"
                            : undefined
                        }
                      >
                        <td
                          className={`sticky left-0 z-10 min-w-40 px-3 py-2.5 text-left align-middle sm:min-w-52 ${STICKY_COLUMN_BG_CLASS}`}
                        >
                          <span className="block break-words font-medium text-foreground">
                            {row.label}
                          </span>
                          {voterSubtitle ? (
                            <span className="app-muted block font-mono text-xs tabular-nums">
                              {voterSubtitle}
                            </span>
                          ) : null}
                        </td>
                        {renderMatrixCell({
                          rowKey: row.rowKey,
                          columnKey: "__overall__",
                          cell: row.overallCell,
                          extraClassName:
                            visibleFlavorColumns.length > 0
                              ? "border-r border-slate-300/60 dark:border-slate-700/60"
                              : "",
                          hideVoterCount: hideCellVoterCount,
                        })}
                        {visibleFlavorColumns.map((column) =>
                          renderMatrixCell({
                            rowKey: row.rowKey,
                            columnKey: column.flavorKey,
                            cell: row.cellsByFlavorKey[column.flavorKey],
                            hideVoterCount: hideCellVoterCount,
                          }),
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <article className="app-card rounded-xl p-5 text-sm">
              <p className="app-muted">
                No surveyed voter cohorts reached this question in the current
                study.
              </p>
            </article>
          )}

          {resolvedPinned ? (
            <section className="app-card space-y-3 rounded-xl p-4 text-xs tabular-nums">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-sm text-foreground">
                    <span className="font-semibold">
                      {resolvedPinned.questionLabel}: {resolvedPinned.rowLabel}
                    </span>
                    <span className="app-muted"> × </span>
                    <span className="font-mono font-semibold">
                      {resolvedPinned.columnLabel}
                    </span>
                  </p>
                  <p className="app-muted">
                    <span className="font-semibold text-foreground">
                      {formatStudioRate(resolvedPinned.cell.rate)} positive
                    </span>{" "}
                    ({formatSignedPp(resolvedPinned.cell.deltaPp)} vs. study ·
                    95% CI [{formatStudioRate(resolvedPinned.cell.ciLow)},{" "}
                    {formatStudioRate(resolvedPinned.cell.ciHigh)}] ·{" "}
                    {resolvedPinned.cell.positive.toLocaleString()}/
                    {resolvedPinned.cell.exposures.toLocaleString()} positive{" "}
                    {exposureUnitLabel}
                    {resolvedPinned.hideVoterCount
                      ? ")"
                      : ` · n=${resolvedPinned.cell.distinctVoters.toLocaleString()} voters)`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {resolvedPinned.flavorId !== null && !isSingleFlavorStudy ? (
                    <Link
                      href={buildHeadToHeadFlavorHref(
                        studyId,
                        resolvedPinned.flavorId,
                        excludeHighRisk,
                      )}
                      className="app-button inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      Head-to-Head →
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPinnedKey(null)}
                    className="app-button h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium transition"
                  >
                    Close
                  </button>
                </div>
              </div>

              {resolvedPinned.sampleCaptions.length > 0 ? (
                <div className="space-y-2 border-t border-slate-200/70 pt-3 dark:border-slate-700/60">
                  <p className="app-kicker text-[11px] font-semibold uppercase tracking-wide">
                    Study-wide example captions · {resolvedPinned.columnLabel}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {resolvedPinned.sampleCaptions.map((sample) => (
                      <PinnedSampleCaptionCard
                        key={sample.captionId}
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
            </section>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Largest Segment Taste Gaps</h2>
          {demographics.tasteGaps.length > INITIAL_TASTE_GAP_LIMIT ? (
            <button
              type="button"
              onClick={() => setShowAllGaps((prev) => !prev)}
              className="app-button inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              {showAllGaps
                ? `Show top ${INITIAL_TASTE_GAP_LIMIT}`
                : `Show all ${demographics.tasteGaps.length.toLocaleString()}`}
            </button>
          ) : null}
        </div>

        {visibleTasteGaps.length > 0 ? (
          <div className="app-table-shell overflow-x-auto rounded-xl">
            <table className="app-table min-w-full divide-y divide-slate-200/60 text-sm dark:divide-slate-700/60">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                    Survey Question
                  </th>
                  {isSingleFlavorStudy ? null : (
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left font-semibold"
                    >
                      Prompt Flavor
                    </th>
                  )}
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                    Highest Reception
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                    Lowest Reception
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-right font-semibold"
                  >
                    Spread
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-700/60">
                {visibleTasteGaps.map((gap) => {
                  const questionShort =
                    gap.questionLabel ??
                    abbreviateSurveyQuestion(gap.questionText);
                  return (
                    <tr key={`${gap.questionId}-${gap.flavorKey}`}>
                      <td className="px-3 py-2.5 align-top">
                        <span className="block font-semibold text-foreground">
                          {questionShort}
                        </span>
                        <span className="app-muted mt-0.5 block text-xs">
                          {gap.questionText}
                        </span>
                      </td>
                      {isSingleFlavorStudy ? null : (
                        <td className="px-3 py-2.5 align-top">
                          <Link
                            href={buildHeadToHeadFlavorHref(
                              studyId,
                              gap.flavorId,
                              excludeHighRisk,
                            )}
                            className="break-words font-mono text-xs font-semibold hover:underline focus-visible:outline-none focus-visible:underline sm:text-sm"
                          >
                            {gap.flavorSlug}
                          </Link>
                        </td>
                      )}
                      <td className="px-3 py-2.5 align-top tabular-nums">
                        <span className="font-medium text-foreground">
                          {gap.highAnswerLabel}
                        </span>{" "}
                        <span className="app-muted text-xs">
                          · {formatStudioRate(gap.highRate)} (n=
                          {gap.highVoters.toLocaleString()})
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top tabular-nums">
                        <span className="font-medium text-foreground">
                          {gap.lowAnswerLabel}
                        </span>{" "}
                        <span className="app-muted text-xs">
                          · {formatStudioRate(gap.lowRate)} (n=
                          {gap.lowVoters.toLocaleString()})
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                        +{gap.spreadPp.toFixed(1)} pp
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <article className="app-card rounded-xl p-4 text-sm">
            <p className="app-muted">
              {demographics.flavorColumns.length === 0
                ? "No attributed prompt flavors are mapped to this study, so cross-flavor segment taste gaps are unavailable."
                : "At least two named segments with k ≥ 5 voters on the same prompt flavor are required to rank audience taste gaps."}
            </p>
          </article>
        )}
      </section>
    </div>
  );
}
