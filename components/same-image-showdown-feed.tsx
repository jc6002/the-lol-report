"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppSelect, type AppSelectOption } from "@/components/app-select";

import {
  formatSignedPp,
  formatStudioRate,
  getDefaultLiftSortDirection,
  matchFlavorRowByParam,
  resolveSameImageGroupPair,
  sortResolvedGroupPairs,
  sortSameImageLiftRows,
  type LiftSortKey,
  type PairSortMode,
  type ResolvedGroupPair,
  type SortDirection,
} from "@/utils/attribution-export";
import type {
  AttributionLeaderboardRow,
  AttributionSampleCaption,
  SameImageCaptionCardMetric,
  SameImageComparisonGroup,
} from "@/utils/attribution-stats";
import { formatFriendlyStudyTitle } from "@/utils/attribution-ui-helpers";
import type { FlavorCrossStudyPoint } from "@/utils/study-lineage-loader";

export type SameImageShowdownFeedProps = {
  studyId: number;
  excludeHighRisk: boolean;
  exposureUnitLabel: "seen cards" | "votes";
  flavorRows: AttributionLeaderboardRow[];
  headToHead: {
    structuralSharedImageCount: number;
    evaluatedSharedImageCount: number;
    crossFlavorSharedImageCount: number;
    comparableCaptionCount: number;
    maxImageSpreadPp: number | null;
    groups: SameImageComparisonGroup[];
  };
  trajectoriesByFlavorId: Record<number, FlavorCrossStudyPoint[]>;
  initialFlavorParam: string | null;
  initialRivalParam: string | null;
  initialSortParam?: string | null;
  totalExposures?: number;
  studyCaptions?: readonly AttributionSampleCaption[];
};

type TrajectoryChartPoint = FlavorCrossStudyPoint & {
  studyTag: string;
  friendlyStudyTitle: string;
  displayFormatLabel: "Swipe" | "Rating scale";
  ratePct: number | null;
  isCurrentStudy: boolean;
};

const parseInitialPairSort = (raw?: string | null): PairSortMode => {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "winner" || normalized === "exposures") {
    return normalized;
  }
  return "gap";
};

const syncHeadToHeadUrlParams = (updates: {
  flavor?: string | number | null;
  rival?: string | number | null;
  sort?: PairSortMode | null;
}) => {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (updates.flavor !== undefined) {
    if (updates.flavor !== null && String(updates.flavor).length > 0) {
      params.set("flavor", String(updates.flavor));
    } else {
      params.delete("flavor");
    }
  }
  if (updates.rival !== undefined) {
    if (updates.rival !== null && String(updates.rival).length > 0) {
      params.set("rival", String(updates.rival));
    } else {
      params.delete("rival");
    }
  }
  if (updates.sort !== undefined) {
    if (updates.sort && updates.sort !== "gap") {
      params.set("sort", updates.sort);
    } else {
      params.delete("sort");
    }
  }
  const nextQuery = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    nextQuery
      ? `${window.location.pathname}?${nextQuery}`
      : window.location.pathname,
  );
};

const PAGE_BATCH_SIZE = 12;
const DIVERGING_BAR_MAX_PP = 25;
const subscribeNoop = () => () => undefined;

const CHART_COLORS = {
  grid: "rgba(148, 163, 184, 0.22)",
  axis: "#64748b",
  line: "#0d9488",
  currentDot: "#f59e0b",
};

const PAIR_SORT_OPTIONS: ReadonlyArray<AppSelectOption<PairSortMode>> = [
  { value: "gap", label: "Largest rate gap" },
  { value: "winner", label: "Highest winner rate" },
  { value: "exposures", label: "Most exposures" },
];

const getLiftToneClassName = (liftPp: number | null): string => {
  if (liftPp === null || !Number.isFinite(liftPp)) {
    return "app-muted";
  }
  if (liftPp > 0.5) {
    return "text-emerald-800 dark:text-emerald-300";
  }
  if (liftPp < -0.5) {
    return "text-rose-800 dark:text-rose-300";
  }
  return "text-foreground";
};

function TrajectoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TrajectoryChartPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="app-tooltip rounded-xl p-3 text-xs tabular-nums">
      <p className="font-semibold text-foreground">
        #{point.studyId} · {point.friendlyStudyTitle}
      </p>
      <p className="mt-1">
        Positive rate:{" "}
        <span className="font-semibold">{formatStudioRate(point.rate)}</span>
        {point.ciLow !== null && point.ciHigh !== null
          ? ` [${formatStudioRate(point.ciLow)}, ${formatStudioRate(point.ciHigh)}]`
          : ""}
      </p>
      <p className="app-muted mt-1">
        {point.displayFormatLabel} · {point.captionCount.toLocaleString()}{" "}
        caption
        {point.captionCount === 1 ? "" : "s"} ·{" "}
        {point.positive.toLocaleString()}/{point.exposures.toLocaleString()}{" "}
        positive
      </p>
    </div>
  );
}

function TrajectoryDot({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: TrajectoryChartPoint;
}) {
  if (cx === undefined || cy === undefined || !payload) {
    return null;
  }
  const isSwipe = payload.exposureMode === "swipe_navigation";
  return (
    <g>
      {payload.isCurrentStudy ? (
        <circle
          cx={cx}
          cy={cy}
          r={7}
          fill="rgba(245, 158, 11, 0.24)"
          stroke={CHART_COLORS.currentDot}
          strokeWidth={1.5}
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={payload.isCurrentStudy ? 4.2 : 3.8}
        fill={isSwipe ? CHART_COLORS.line : "#ffffff"}
        stroke={isSwipe ? "#ffffff" : CHART_COLORS.line}
        strokeWidth={isSwipe ? 1.5 : 2}
      />
    </g>
  );
}

function FlavorTrajectoryCard({
  focusedFlavor,
  focusedTrajectory,
  evaluableTrajectoryPoints,
  excludeHighRisk,
  isHydrated,
}: {
  focusedFlavor: AttributionLeaderboardRow | null;
  focusedTrajectory: readonly TrajectoryChartPoint[];
  evaluableTrajectoryPoints: readonly TrajectoryChartPoint[];
  excludeHighRisk: boolean;
  isHydrated: boolean;
}) {
  const yAxisDomain = useMemo<[number, number]>(() => {
    const rates = evaluableTrajectoryPoints
      .map((point) => point.ratePct)
      .filter((rate): rate is number => rate !== null && Number.isFinite(rate));
    if (rates.length === 0) {
      return [0, 100];
    }
    const minPct = Math.min(...rates);
    const maxPct = Math.max(...rates);
    const domainMin = Math.max(0, Math.floor((minPct - 8) / 5) * 5);
    const domainMax = Math.min(
      100,
      Math.max(domainMin + 10, Math.ceil((maxPct + 8) / 5) * 5),
    );
    return [domainMin, domainMax];
  }, [evaluableTrajectoryPoints]);

  return (
    <article className="app-chart-card flex min-w-0 flex-col justify-between gap-3 rounded-xl p-4">
      {focusedFlavor ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words font-mono text-sm font-semibold text-foreground">
              {focusedFlavor.label}
            </span>
            <div className="app-muted flex flex-wrap items-center gap-2.5 text-[11px] tabular-nums">
              {evaluableTrajectoryPoints.length >= 2 ? (
                <span
                  aria-hidden="true"
                  className="inline-flex items-center gap-2"
                >
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-teal-600" />
                    Swipe
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full border-2 border-teal-600 bg-white dark:bg-slate-950" />
                    Rating scale
                  </span>
                </span>
              ) : null}
              <span>
                {focusedTrajectory.length.toLocaleString()} study run
                {focusedTrajectory.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {evaluableTrajectoryPoints.length >= 2 ? (
            !isHydrated ? (
              <div
                aria-hidden="true"
                className="h-44 w-full rounded-lg bg-slate-200/35 dark:bg-slate-800/35"
              />
            ) : (
              <div className="h-44 min-w-0 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={[...focusedTrajectory]}
                    margin={{ top: 8, right: 12, bottom: 4, left: -12 }}
                    accessibilityLayer
                  >
                    <CartesianGrid
                      stroke={CHART_COLORS.grid}
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="studyTag"
                      stroke={CHART_COLORS.axis}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      stroke={CHART_COLORS.axis}
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value) => `${value}%`}
                      domain={yAxisDomain}
                    />
                    <Tooltip content={<TrajectoryTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="ratePct"
                      name="Positive rate"
                      stroke={CHART_COLORS.line}
                      strokeWidth={2.5}
                      connectNulls
                      dot={<TrajectoryDot />}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )
          ) : focusedTrajectory.length === 1 ? (
            <div className="rounded-lg border border-slate-200/70 bg-white/40 px-3 py-2.5 text-xs dark:border-slate-700/60 dark:bg-slate-950/20">
              Tested in 1 study so far (
              <span className="font-semibold tabular-nums">
                {formatStudioRate(focusedTrajectory[0].rate)}
              </span>{" "}
              positive across {focusedTrajectory[0].exposures.toLocaleString()}{" "}
              {focusedTrajectory[0].exposureMode === "swipe_navigation"
                ? "seen cards"
                : "votes"}
              ).
            </div>
          ) : null}

          {focusedTrajectory.length > 0 ? (
            <div className="max-h-40 divide-y divide-slate-200/60 overflow-y-auto pr-1 text-xs dark:divide-slate-700/60">
              {focusedTrajectory.map((point) => {
                const studyHref = `/study/${point.studyId}/attribution?flavor=${focusedFlavor.flavorId}${
                  point.isCurrentStudy && excludeHighRisk
                    ? "&excludeHighRisk=1"
                    : ""
                }`;
                return (
                  <Link
                    key={point.studyId}
                    href={studyHref}
                    className={`flex items-center justify-between gap-2 rounded px-1.5 py-2 transition hover:bg-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-white/6 ${
                      point.isCurrentStudy ? "font-semibold" : ""
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      <span className="app-muted mr-1.5 font-mono">
                        #{point.studyId}
                      </span>
                      <span>{point.friendlyStudyTitle}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      <span className="app-muted">
                        {point.displayFormatLabel} · {point.captionCount} cap
                      </span>
                      <span className="min-w-12 text-right font-semibold text-foreground">
                        {formatStudioRate(point.rate)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="app-muted text-xs">
              No cross-study history found for this flavor.
            </p>
          )}
        </>
      ) : (
        <div className="my-auto py-6 text-center text-xs">
          <p className="app-muted">
            All captions in this study are unattributed, so cross-study flavor
            trajectories do not apply.
          </p>
        </div>
      )}
    </article>
  );
}

function SameImagePunchlineCard({
  imageId,
  imageUrl,
  imageDescription,
  imageBroken,
  onImageError,
  card,
  exposureUnitLabel,
}: {
  imageId: string;
  imageUrl: string | null;
  imageDescription: string | null;
  imageBroken: boolean;
  onImageError: (id: string) => void;
  card: SameImageCaptionCardMetric;
  exposureUnitLabel: "seen cards" | "votes";
}) {
  const ciSummary =
    card.ciLow !== null && card.ciHigh !== null
      ? `[${formatStudioRate(card.ciLow)}, ${formatStudioRate(card.ciHigh)}] · `
      : "· ";

  return (
    <article className="app-card flex min-w-0 flex-col overflow-hidden rounded-xl">
      {imageUrl && !imageBroken ? (
        <div className="flex h-48 w-full items-center justify-center bg-white/40 p-2.5 dark:bg-slate-950/20 sm:h-56">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={imageDescription ?? card.captionText}
            loading="lazy"
            decoding="async"
            onError={() => onImageError(imageId)}
            className="h-full w-full object-contain"
          />
        </div>
      ) : (
        <div className="flex h-48 w-full items-center justify-center bg-white/40 p-5 text-sm dark:bg-slate-950/20 sm:h-56">
          <span className="app-muted">Image unavailable</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col p-3.5">
        <p className="break-words text-sm font-semibold leading-5 text-foreground sm:text-base sm:leading-6">
          {card.captionText}
        </p>
        <div className="mt-auto pt-2.5">
          <div className="space-y-1 border-t border-slate-200/70 pt-2.5 text-xs dark:border-slate-700/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="break-words font-mono font-semibold text-foreground">
                {card.flavorSlug}
              </span>
              <span
                className={`font-semibold tabular-nums ${getLiftToneClassName(card.liftPp)}`}
              >
                {card.liftPp === null
                  ? "—"
                  : `${formatSignedPp(card.liftPp)} vs. image mean`}
              </span>
            </div>
            <div className="app-muted flex flex-wrap items-center justify-between gap-2 tabular-nums">
              <span>
                <strong className="font-semibold text-foreground">
                  {formatStudioRate(card.rate)}
                </strong>{" "}
                {ciSummary}
                {card.positive.toLocaleString()}/
                {card.exposures.toLocaleString()} {exposureUnitLabel}
              </span>
              <span className="font-mono text-[11px]">
                {card.terminalModelLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function StudyCaptionSampleCard({
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
        <div className="flex h-48 w-full items-center justify-center bg-white/40 p-2.5 dark:bg-slate-950/20 sm:h-52">
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
        <div className="flex h-48 w-full items-center justify-center bg-white/40 p-5 text-sm dark:bg-slate-950/20 sm:h-52">
          <span className="app-muted">Image unavailable</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col p-3.5">
        <p className="break-words text-sm font-semibold leading-5 text-foreground sm:text-base sm:leading-6">
          {sample.captionText}
        </p>
        <div className="mt-auto pt-2.5">
          <div className="space-y-1 border-t border-slate-200/70 pt-2.5 text-xs tabular-nums dark:border-slate-700/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {sample.rate !== null ? (
                <span className="font-semibold text-foreground">
                  {formatStudioRate(sample.rate)}{" "}
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
                  95% CI [{formatStudioRate(sample.ciLow)},{" "}
                  {formatStudioRate(sample.ciHigh)}]
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function SameImageShowdownFeed({
  studyId,
  excludeHighRisk,
  exposureUnitLabel,
  flavorRows,
  headToHead,
  trajectoriesByFlavorId,
  initialFlavorParam,
  initialRivalParam,
  initialSortParam,
  totalExposures,
  studyCaptions = [],
}: SameImageShowdownFeedProps) {
  const isHydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const resolvedTotalExposures = useMemo(
    () =>
      totalExposures ??
      flavorRows.reduce((sum, row) => sum + row.exposures, 0),
    [flavorRows, totalExposures],
  );

  const resolvedTotalPositive = useMemo(
    () => flavorRows.reduce((sum, row) => sum + row.positive, 0),
    [flavorRows],
  );

  const resolvedTotalCaptions = useMemo(
    () =>
      studyCaptions.length > 0
        ? studyCaptions.length
        : flavorRows.reduce((sum, row) => sum + row.captionCount, 0),
    [flavorRows, studyCaptions.length],
  );

  const attributedFlavors = useMemo(
    () => flavorRows.filter((row) => !row.isUnattributed),
    [flavorRows],
  );

  const hasCrossFlavorShowdowns =
    attributedFlavors.length >= 2 && headToHead.crossFlavorSharedImageCount > 0;
  const isZeroVoteStagingStudy = resolvedTotalExposures === 0;
  const isSingleFlavorScoredStudy =
    !isZeroVoteStagingStudy && attributedFlavors.length === 1;

  const topLiftFlavor = useMemo(() => {
    let best: AttributionLeaderboardRow | null = null;
    for (const row of attributedFlavors) {
      if (row.meanLiftPp === null) {
        continue;
      }
      if (
        best === null ||
        row.meanLiftPp > (best.meanLiftPp ?? Number.NEGATIVE_INFINITY)
      ) {
        best = row;
      }
    }
    return best;
  }, [attributedFlavors]);

  const matchedInitialFlavor = useMemo(
    () => matchFlavorRowByParam(flavorRows, initialFlavorParam),
    [flavorRows, initialFlavorParam],
  );
  const matchedInitialRival = useMemo(
    () => matchFlavorRowByParam(flavorRows, initialRivalParam),
    [flavorRows, initialRivalParam],
  );

  const sharedFlavorOptions = useMemo(() => {
    const keysInGroups = new Set<string>();
    for (const group of headToHead.groups) {
      for (const card of group.captions) {
        keysInGroups.add(card.flavorKey);
      }
    }
    return flavorRows
      .filter((row) => keysInGroups.has(row.key))
      .map((row) => ({ key: row.key, label: row.label }));
  }, [flavorRows, headToHead.groups]);

  const sharedFlavorKeySet = useMemo(
    () => new Set(sharedFlavorOptions.map((opt) => opt.key)),
    [sharedFlavorOptions],
  );

  const controlsIdPrefix = useId();
  const flavorASelectId = `${controlsIdPrefix}-flavor-a`;
  const flavorBSelectId = `${controlsIdPrefix}-flavor-b`;
  const pairSortSelectId = `${controlsIdPrefix}-pair-sort`;

  const flavorAOptions = useMemo<AppSelectOption[]>(
    () => [
      { value: "all", label: "All flavors" },
      ...sharedFlavorOptions.map((option) => ({
        value: option.key,
        label: option.label,
      })),
    ],
    [sharedFlavorOptions],
  );

  const flavorBOptions = useMemo<AppSelectOption[]>(
    () => [
      { value: "all", label: "Any rival flavor" },
      ...sharedFlavorOptions.map((option) => ({
        value: option.key,
        label: option.label,
      })),
    ],
    [sharedFlavorOptions],
  );

  const defaultFocusedId =
    matchedInitialFlavor?.flavorId ??
    topLiftFlavor?.flavorId ??
    attributedFlavors[0]?.flavorId ??
    null;

  const [focusedFlavorId, setFocusedFlavorId] = useState<number | null>(
    defaultFocusedId,
  );
  const [dismissedMissingParam, setDismissedMissingParam] = useState(false);
  const [liftSortBy, setLiftSortBy] = useState<LiftSortKey>("meanLiftPp");
  const [liftSortDir, setLiftSortDir] = useState<SortDirection>("desc");

  const [flavorA, setFlavorA] = useState<string>(() =>
    matchedInitialFlavor && sharedFlavorKeySet.has(matchedInitialFlavor.key)
      ? matchedInitialFlavor.key
      : "all",
  );
  const [flavorB, setFlavorB] = useState<string>(() =>
    matchedInitialRival && sharedFlavorKeySet.has(matchedInitialRival.key)
      ? matchedInitialRival.key
      : "all",
  );
  const [pairSort, setPairSort] = useState<PairSortMode>(() =>
    parseInitialPairSort(initialSortParam),
  );
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_BATCH_SIZE);
  const [expandedImageIds, setExpandedImageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [brokenSampleCaptionIds, setBrokenSampleCaptionIds] = useState<
    Set<string>
  >(() => new Set());

  const resolveFlavorUrlToken = (flavorKey: string): string | number | null => {
    if (!flavorKey || flavorKey === "all") return null;
    const matched = flavorRows.find((row) => row.key === flavorKey);
    if (!matched) return null;
    return matched.flavorId ?? matched.label;
  };

  const focusedFlavor =
    attributedFlavors.find((row) => row.flavorId === focusedFlavorId) ??
    topLiftFlavor ??
    attributedFlavors[0] ??
    null;

  const focusedTrajectory: TrajectoryChartPoint[] = useMemo(() => {
    if (!focusedFlavor || focusedFlavor.flavorId === null) {
      return [];
    }
    const raw = trajectoriesByFlavorId[focusedFlavor.flavorId] ?? [];
    return raw.map((point) => ({
      ...point,
      studyTag: `#${point.studyId}`,
      friendlyStudyTitle: formatFriendlyStudyTitle({
        id: point.studyId,
        slug: point.studySlug,
        description: point.studyLabel,
      }),
      displayFormatLabel:
        point.exposureMode === "swipe_navigation" ? "Swipe" : "Rating scale",
      ratePct:
        point.rate === null ? null : Number((point.rate * 100).toFixed(2)),
      isCurrentStudy: point.studyId === studyId,
    }));
  }, [focusedFlavor, studyId, trajectoriesByFlavorId]);

  const evaluableTrajectoryPoints = focusedTrajectory.filter(
    (point) => point.ratePct !== null,
  );

  const resolvedStudySamples = useMemo(() => {
    const baseCaptions: AttributionSampleCaption[] =
      studyCaptions.length > 0
        ? [...studyCaptions]
        : flavorRows.flatMap((row) => [
            ...(row.topCaptions ?? []),
            ...(row.bottomCaptions ?? []),
          ]);

    const scored = baseCaptions.filter(
      (item) => item.exposures > 0 && item.rate !== null,
    );
    if (scored.length === 0) {
      return {
        staged: baseCaptions.slice(0, 6),
        highest: [] as AttributionSampleCaption[],
        lowest: [] as AttributionSampleCaption[],
        spreadPp: null as number | null,
      };
    }

    const orderedHigh = [...scored].sort(
      (a, b) =>
        (b.ciLow ?? -1) - (a.ciLow ?? -1) ||
        (b.rate ?? -1) - (a.rate ?? -1) ||
        b.exposures - a.exposures ||
        a.captionId.localeCompare(b.captionId),
    );
    const highLimit = Math.min(4, Math.ceil(orderedHigh.length / 2));
    const highest = orderedHigh.slice(0, highLimit);
    const highIds = new Set(highest.map((item) => item.captionId));

    const lowest =
      orderedHigh.length >= 2
        ? orderedHigh
            .filter((item) => !highIds.has(item.captionId))
            .sort(
              (a, b) =>
                (a.rate ?? 2) - (b.rate ?? 2) ||
                (a.ciHigh ?? 2) - (b.ciHigh ?? 2) ||
                b.exposures - a.exposures ||
                a.captionId.localeCompare(b.captionId),
            )
            .slice(0, 4)
        : [];

    const rates = scored.map((item) => item.rate ?? 0);
    const spreadPp =
      rates.length >= 2
        ? Number(((Math.max(...rates) - Math.min(...rates)) * 100).toFixed(2))
        : null;

    return {
      staged: [] as AttributionSampleCaption[],
      highest,
      lowest,
      spreadPp,
    };
  }, [flavorRows, studyCaptions]);

  const sortedLiftRows = useMemo(
    () => sortSameImageLiftRows(flavorRows, liftSortBy, liftSortDir),
    [flavorRows, liftSortBy, liftSortDir],
  );

  const filteredPairs = useMemo(() => {
    if (!hasCrossFlavorShowdowns) {
      return [];
    }
    const resolved: ResolvedGroupPair[] = [];
    for (const group of headToHead.groups) {
      const pair = resolveSameImageGroupPair({ group, flavorA, flavorB });
      if (pair) {
        resolved.push(pair);
      }
    }
    return sortResolvedGroupPairs(resolved, pairSort);
  }, [flavorA, flavorB, hasCrossFlavorShowdowns, headToHead.groups, pairSort]);

  const visiblePairs = filteredPairs.slice(0, visibleCount);
  const remainingPairs = Math.max(0, filteredPairs.length - visiblePairs.length);

  const handleLiftSort = (column: LiftSortKey) => {
    if (liftSortBy === column) {
      setLiftSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setLiftSortBy(column);
    setLiftSortDir(getDefaultLiftSortDirection(column));
  };

  const handleSelectFlavorRow = (row: AttributionLeaderboardRow) => {
    if (row.flavorId !== null) {
      setFocusedFlavorId(row.flavorId);
      syncHeadToHeadUrlParams({ flavor: row.flavorId });
    }
    if (sharedFlavorKeySet.has(row.key)) {
      setFlavorA(row.key);
      setVisibleCount(PAGE_BATCH_SIZE);
    }
  };

  const toggleExpandedImage = (imageId: string) => {
    setExpandedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  const markImageBroken = (imageId: string) => {
    setBrokenImageIds((prev) => {
      if (prev.has(imageId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(imageId);
      return next;
    });
  };

  const markSampleCaptionBroken = (captionId: string) => {
    setBrokenSampleCaptionIds((prev) => {
      if (prev.has(captionId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(captionId);
      return next;
    });
  };

  const renderLiftHeader = (
    label: string,
    column: LiftSortKey,
    align: "left" | "right" = "right",
    minWidthClass = "",
  ) => {
    const isActive = liftSortBy === column;
    const ariaSort = isActive
      ? liftSortDir === "asc"
        ? "ascending"
        : "descending"
      : "none";

    return (
      <th
        scope="col"
        aria-sort={ariaSort}
        className={`px-3 py-2.5 font-semibold ${align === "right" ? "text-right" : "text-left"} ${minWidthClass}`}
      >
        <button
          type="button"
          onClick={() => handleLiftSort(column)}
          className={`inline-flex cursor-pointer items-center gap-1.5 hover:underline focus-visible:outline-none focus-visible:underline ${
            align === "right" ? "justify-end" : ""
          }`}
        >
          <span>{label}</span>
          {isActive ? (
            <span className="app-muted text-xs" aria-hidden="true">
              {liftSortDir === "asc" ? "↑" : "↓"}
            </span>
          ) : null}
        </button>
      </th>
    );
  };

  const missingFlavorParam =
    Boolean(initialFlavorParam?.trim()) && matchedInitialFlavor === null
      ? initialFlavorParam!.trim()
      : null;
  const missingRivalParam =
    Boolean(initialRivalParam?.trim()) && matchedInitialRival === null
      ? initialRivalParam!.trim()
      : null;
  const showMissingFlavorNotice =
    (missingFlavorParam !== null || missingRivalParam !== null) &&
    !dismissedMissingParam;

  const isFiltered = flavorA !== "all" || flavorB !== "all";

  if (!hasCrossFlavorShowdowns) {
    const soleFlavor =
      attributedFlavors.length === 1 ? attributedFlavors[0] : null;
    const studyPositiveRate =
      resolvedTotalExposures > 0
        ? resolvedTotalPositive / resolvedTotalExposures
        : null;

    return (
      <div className="space-y-5">
        {showMissingFlavorNotice ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/14 px-3.5 py-2 text-xs text-amber-950 dark:text-amber-100">
            <span>
              Requested flavor filter is not mapped to this study · Showing
              study captions.
            </span>
            <button
              type="button"
              onClick={() => setDismissedMissingParam(true)}
              className="app-button h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="app-card flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs">
          <p className="text-foreground">
            {isZeroVoteStagingStudy ? (
              <>
                <span className="font-semibold">
                  No participant votes collected yet
                </span>{" "}
                <span className="app-muted">
                  · Showing staged study captions
                  {soleFlavor
                    ? ` for ${soleFlavor.label} and prior cross-study history.`
                    : attributedFlavors.length > 1
                      ? ` across ${attributedFlavors.length.toLocaleString()} prompt flavors and prior cross-study history.`
                      : "."}
                </span>
              </>
            ) : isSingleFlavorScoredStudy && soleFlavor ? (
              <>
                This study evaluates a single prompt flavor (
                <span className="font-mono font-semibold">
                  {soleFlavor.label}
                </span>
                ).{" "}
                <span className="app-muted">
                  Comparing highest vs. lowest rated captions within the deck
                  alongside its cross-study trajectory.
                </span>
              </>
            ) : attributedFlavors.length === 0 ? (
              <span className="app-muted">
                All captions in this study are unlinked manual entries.
                Comparing highest vs. lowest rated captions below.
              </span>
            ) : (
              <span className="app-muted">
                Prompt flavors in this study are assigned to separate images
                rather than shared prompts. Comparing top vs. lowest rated
                captions and cross-study trajectories below.
              </span>
            )}
          </p>
          <Link
            href="/"
            className="app-button inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            Browse multi-flavor studies →
          </Link>
        </div>

        {!isZeroVoteStagingStudy ? (
          <section className="grid grid-cols-2 gap-2.5 tabular-nums sm:gap-3 xl:grid-cols-4">
            <article className="app-card app-stat-card-teal flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
              <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                {soleFlavor
                  ? "Prompt Flavor"
                  : attributedFlavors.length >= 2
                    ? "Prompt Flavors"
                    : "Study Captions"}
              </p>
              {soleFlavor ? (
                <>
                  <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                    <p
                      title={soleFlavor.label}
                      className="truncate font-mono text-xs leading-5 font-semibold sm:text-base sm:leading-6 xl:text-sm xl:leading-5"
                    >
                      {soleFlavor.label}
                    </p>
                  </div>
                  <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                    {soleFlavor.dominantModelLabel ?? "Unattributed"} ·{" "}
                    {soleFlavor.captionCount.toLocaleString()}{" "}
                    {soleFlavor.captionCount === 1 ? "caption" : "captions"}
                  </p>
                </>
              ) : attributedFlavors.length >= 2 ? (
                <>
                  <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                    <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                      {attributedFlavors.length.toLocaleString()} flavors
                    </p>
                  </div>
                  <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                    {resolvedTotalCaptions.toLocaleString()} captions across
                    separate images
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                    <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                      {resolvedTotalCaptions.toLocaleString()}
                    </p>
                  </div>
                  <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                    Manual study deck
                  </p>
                </>
              )}
            </article>

            <article className="app-card app-stat-card-sky flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
              <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                Positive Rate
              </p>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                  {formatStudioRate(studyPositiveRate)}
                </p>
              </div>
              <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                {resolvedTotalPositive.toLocaleString()} /{" "}
                {resolvedTotalExposures.toLocaleString()} {exposureUnitLabel}
              </p>
            </article>

            <article className="app-card app-stat-card-amber flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
              <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                Deck Caption Spread
              </p>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                  {resolvedStudySamples.spreadPp === null
                    ? "—"
                    : `+${resolvedStudySamples.spreadPp.toFixed(1)} pp`}
                </p>
              </div>
              <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                Best vs. lowest rated caption in study
              </p>
            </article>

            <article className="app-card app-stat-card-rose flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
              <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                Cross-Study History
              </p>
              {focusedFlavor ? (
                <>
                  <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                    <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                      {focusedTrajectory.length.toLocaleString()}{" "}
                      {focusedTrajectory.length === 1 ? "study" : "studies"}
                    </p>
                  </div>
                  <p
                    title={focusedFlavor.label}
                    className="app-muted mt-1 truncate font-mono text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5"
                  >
                    {focusedFlavor.label}
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                    <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                      —
                    </p>
                  </div>
                  <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                    Manual entries only
                  </p>
                </>
              )}
            </article>
          </section>
        ) : null}

        {attributedFlavors.length > 0 ? (
          <div className="space-y-2.5">
            {attributedFlavors.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {attributedFlavors.map((row) => {
                  const active = row.flavorId === focusedFlavor?.flavorId;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleSelectFlavorRow(row)}
                      className={`h-8 cursor-pointer rounded-lg px-3 font-mono text-xs font-medium transition ${
                        active
                          ? "bg-sky-500/18 text-foreground ring-1 ring-sky-500/40"
                          : "app-button app-muted hover:text-foreground"
                      }`}
                    >
                      {row.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <FlavorTrajectoryCard
              focusedFlavor={focusedFlavor}
              focusedTrajectory={focusedTrajectory}
              evaluableTrajectoryPoints={evaluableTrajectoryPoints}
              excludeHighRisk={excludeHighRisk}
              isHydrated={isHydrated}
            />
          </div>
        ) : null}

        {isZeroVoteStagingStudy ? (
          resolvedStudySamples.staged.length > 0 ? (
            <section className="space-y-2.5">
              <p className="app-kicker text-xs font-semibold uppercase tracking-wide">
                Staged Captions ({resolvedStudySamples.staged.length})
              </p>
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {resolvedStudySamples.staged.map((sample) => (
                  <StudyCaptionSampleCard
                    key={sample.captionId}
                    sample={sample}
                    exposureUnitLabel={exposureUnitLabel}
                    imageBroken={brokenSampleCaptionIds.has(sample.captionId)}
                    onImageError={markSampleCaptionBroken}
                  />
                ))}
              </div>
            </section>
          ) : null
        ) : (
          <div className="space-y-5">
            {resolvedStudySamples.highest.length > 0 ? (
              <section className="space-y-2.5">
                <p className="app-kicker text-xs font-semibold uppercase tracking-wide">
                  Highest-Rated Captions in This Study (
                  {resolvedStudySamples.highest.length})
                </p>
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  {resolvedStudySamples.highest.map((sample) => (
                    <StudyCaptionSampleCard
                      key={`hi-${sample.captionId}`}
                      sample={sample}
                      exposureUnitLabel={exposureUnitLabel}
                      imageBroken={brokenSampleCaptionIds.has(sample.captionId)}
                      onImageError={markSampleCaptionBroken}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {resolvedStudySamples.lowest.length > 0 ? (
              <section className="space-y-2.5">
                <p className="app-kicker text-xs font-semibold uppercase tracking-wide">
                  Lowest-Rated Captions in This Study (
                  {resolvedStudySamples.lowest.length})
                </p>
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  {resolvedStudySamples.lowest.map((sample) => (
                    <StudyCaptionSampleCard
                      key={`lo-${sample.captionId}`}
                      sample={sample}
                      exposureUnitLabel={exposureUnitLabel}
                      imageBroken={brokenSampleCaptionIds.has(sample.captionId)}
                      onImageError={markSampleCaptionBroken}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {showMissingFlavorNotice ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/14 px-3.5 py-2 text-xs text-amber-950 dark:text-amber-100">
          <span>
            {missingFlavorParam !== null && missingRivalParam !== null ? (
              <>
                Requested flavors{" "}
                <span className="font-mono font-semibold">
                  {missingFlavorParam}
                </span>{" "}
                and{" "}
                <span className="font-mono font-semibold">
                  {missingRivalParam}
                </span>{" "}
                are not mapped to this study · Showing all study flavors.
              </>
            ) : missingFlavorParam !== null ? (
              <>
                Requested flavor{" "}
                <span className="font-mono font-semibold">
                  {missingFlavorParam}
                </span>{" "}
                is not mapped to this study · Showing all study flavors.
              </>
            ) : (
              <>
                Requested rival flavor{" "}
                <span className="font-mono font-semibold">
                  {missingRivalParam}
                </span>{" "}
                is not mapped to this study · Showing all rival flavors.
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setDismissedMissingParam(true)}
            className="app-button h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-2.5 tabular-nums sm:gap-3 xl:grid-cols-4">
        <article className="app-card app-stat-card-teal flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
          <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
            Shared Images
          </p>
          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
            <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
              {headToHead.crossFlavorSharedImageCount.toLocaleString()}
            </p>
          </div>
          <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
            {headToHead.comparableCaptionCount.toLocaleString()} caption
            {headToHead.comparableCaptionCount === 1 ? "" : "s"} competing on
            identical prompts
          </p>
        </article>

        <article className="app-card app-stat-card-sky flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
          <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
            Top Same-Image Lift
          </p>
          {topLiftFlavor ? (
            <>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p
                  title={topLiftFlavor.label}
                  className="truncate font-mono text-xs leading-5 font-semibold sm:text-base sm:leading-6 xl:text-sm xl:leading-5"
                >
                  {topLiftFlavor.label}
                </p>
              </div>
              <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                {formatSignedPp(topLiftFlavor.meanLiftPp)} across{" "}
                {topLiftFlavor.sharedImageCount.toLocaleString()} image
                {topLiftFlavor.sharedImageCount === 1 ? "" : "s"}
              </p>
            </>
          ) : (
            <>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                  —
                </p>
              </div>
              <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                No evaluated cross-flavor image pairs
              </p>
            </>
          )}
        </article>

        <article className="app-card app-stat-card-amber flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
          <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
            Widest Single-Image Gap
          </p>
          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
            <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
              {headToHead.maxImageSpreadPp === null
                ? "—"
                : `+${headToHead.maxImageSpreadPp.toFixed(1)} pp`}
            </p>
          </div>
          <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
            Best vs. lowest punchline on same image
          </p>
        </article>

        <article className="app-card app-stat-card-rose flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
          <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
            Cross-Study History
          </p>
          {focusedFlavor ? (
            <>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                  {focusedTrajectory.length.toLocaleString()}{" "}
                  {focusedTrajectory.length === 1 ? "study" : "studies"}
                </p>
              </div>
              <p
                title={focusedFlavor.label}
                className="app-muted mt-1 truncate font-mono text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5"
              >
                {focusedFlavor.label}
              </p>
            </>
          ) : (
            <>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                  —
                </p>
              </div>
              <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                No attributed prompt flavors in study
              </p>
            </>
          )}
        </article>
      </section>

      {sortedLiftRows.length > 0 ? (
        <section className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          {/* Mobile < md stacked cards */}
          <div className="min-w-0 space-y-2.5 md:hidden">
            {sortedLiftRows.map((row) => {
              const isFocused =
                !row.isUnattributed &&
                focusedFlavor?.flavorId !== null &&
                row.flavorId === focusedFlavor?.flavorId;
              return (
                <article
                  key={row.key}
                  className={`app-card min-w-0 rounded-xl p-3.5 tabular-nums ${
                    isFocused
                      ? "ring-2 ring-sky-500/50 dark:ring-cyan-300/45"
                      : ""
                  }`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {row.isUnattributed ? (
                        <p className="font-semibold text-foreground">
                          {row.label}
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelectFlavorRow(row)}
                          className="block max-w-full cursor-pointer text-left focus-visible:outline-none focus-visible:underline"
                        >
                          <span className="block break-words font-mono text-sm font-semibold text-foreground">
                            {row.label}
                          </span>
                        </button>
                      )}
                      <p className="app-muted mt-0.5 text-xs">
                        {row.dominantModelLabel ?? "Unattributed"} ·{" "}
                        {row.sharedImageCount === 0
                          ? "0 shared imgs"
                          : `${row.sharedImageCount.toLocaleString()} shared imgs`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={`text-sm font-semibold ${getLiftToneClassName(row.meanLiftPp)}`}
                      >
                        {formatSignedPp(row.meanLiftPp)} lift
                      </p>
                      <p className="app-muted text-xs">
                        {formatStudioRate(row.rate)} vs{" "}
                        {formatStudioRate(row.imageBaselineMean)} base
                      </p>
                    </div>
                  </div>
                  {row.pairWinRate !== null ? (
                    <p className="app-muted mt-1.5 text-xs">
                      Pairwise: {row.pairWins}W–{row.pairLosses}L–{row.pairTies}T
                      ({formatStudioRate(row.pairWinRate)})
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>

          {/* Desktop >= md sortable table */}
          <div className="app-table-shell hidden min-w-0 overflow-x-auto rounded-xl md:block">
            <table className="app-table min-w-full divide-y divide-slate-200/60 text-sm dark:divide-slate-700/60">
              <thead>
                <tr>
                  {renderLiftHeader("Prompt Flavor", "label", "left")}
                  {renderLiftHeader("Shared Imgs", "sharedImageCount")}
                  {renderLiftHeader("Raw Rate", "rate")}
                  {renderLiftHeader("Image Baseline", "imageBaselineMean")}
                  {renderLiftHeader(
                    "Mean-Centered Lift",
                    "meanLiftPp",
                    "right",
                    "min-w-44",
                  )}
                  {renderLiftHeader("Pair Wins", "pairWinRate")}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-700/60">
                {sortedLiftRows.map((row) => {
                  const isFocused =
                    !row.isUnattributed &&
                    focusedFlavor?.flavorId !== null &&
                    row.flavorId === focusedFlavor?.flavorId;
                  const liftClamped =
                    row.meanLiftPp === null
                      ? 0
                      : Math.max(
                          -DIVERGING_BAR_MAX_PP,
                          Math.min(DIVERGING_BAR_MAX_PP, row.meanLiftPp),
                        );
                  const barHalfPct =
                    (Math.abs(liftClamped) / DIVERGING_BAR_MAX_PP) * 50;

                  return (
                    <tr
                      key={row.key}
                      className={`${
                        row.isUnattributed
                          ? "border-t-2 border-slate-300/70 dark:border-slate-600/70"
                          : ""
                      } ${isFocused ? "bg-sky-500/12 dark:bg-cyan-300/12" : ""}`}
                    >
                      <td className="px-3 py-2.5 text-left align-middle">
                        {row.isUnattributed ? (
                          <div>
                            <span className="font-semibold text-foreground">
                              {row.label}
                            </span>
                            <span className="app-muted block text-xs">
                              Captions without prompt chain lineage
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSelectFlavorRow(row)}
                            className="cursor-pointer text-left focus-visible:outline-none focus-visible:underline"
                          >
                            <span className="block font-mono text-xs font-semibold text-foreground hover:underline sm:text-sm">
                              {row.label}
                            </span>
                            {row.dominantModelLabel ? (
                              <span className="app-muted block text-xs">
                                {row.dominantModelLabel}
                              </span>
                            ) : null}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                        {row.sharedImageCount === 0
                          ? "—"
                          : row.sharedImageCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                        <span className="font-semibold">
                          {formatStudioRate(row.rate)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                        {formatStudioRate(row.imageBaselineMean)}
                      </td>
                      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                        {row.meanLiftPp === null ? (
                          <span className="app-muted">—</span>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-2.5">
                            <div
                              className="relative h-2 w-20 shrink-0 rounded-full bg-slate-200/85 dark:bg-slate-800/90"
                              aria-hidden="true"
                            >
                              <span className="absolute top-[-2px] bottom-[-2px] left-1/2 w-px bg-slate-500/80" />
                              {liftClamped >= 0 ? (
                                <span
                                  className="absolute inset-y-0 rounded-r-full bg-teal-600 dark:bg-cyan-400"
                                  style={{
                                    left: "50%",
                                    width: `${barHalfPct}%`,
                                  }}
                                />
                              ) : (
                                <span
                                  className="absolute inset-y-0 rounded-l-full bg-rose-500/80 dark:bg-rose-400/80"
                                  style={{
                                    left: `${50 - barHalfPct}%`,
                                    width: `${barHalfPct}%`,
                                  }}
                                />
                              )}
                            </div>
                            <span
                              className={`min-w-16 font-semibold ${getLiftToneClassName(row.meanLiftPp)}`}
                            >
                              {formatSignedPp(row.meanLiftPp)}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle tabular-nums">
                        {row.pairWinRate === null ? (
                          <span className="app-muted">—</span>
                        ) : (
                          <span>
                            <span className="font-medium">
                              {row.pairWins}W–{row.pairLosses}L–{row.pairTies}T
                            </span>{" "}
                            <span className="app-muted text-xs">
                              ({formatStudioRate(row.pairWinRate)})
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <FlavorTrajectoryCard
            focusedFlavor={focusedFlavor}
            focusedTrajectory={focusedTrajectory}
            evaluableTrajectoryPoints={evaluableTrajectoryPoints}
            excludeHighRisk={excludeHighRisk}
            isHydrated={isHydrated}
          />
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 max-w-full flex-wrap items-end gap-3">
            <div className="app-muted w-full min-w-0 space-y-1 text-xs font-medium sm:w-auto">
              <label htmlFor={flavorASelectId} className="block">
                Flavor A
              </label>
              <AppSelect
                id={flavorASelectId}
                ariaLabel="Flavor A"
                options={flavorAOptions}
                value={flavorA}
                onValueChange={(nextValue) => {
                  setFlavorA(nextValue);
                  setVisibleCount(PAGE_BATCH_SIZE);
                  const matched = flavorRows.find(
                    (row) => row.key === nextValue,
                  );
                  if (matched?.flavorId !== null && matched?.flavorId !== undefined) {
                    setFocusedFlavorId(matched.flavorId);
                  }
                  syncHeadToHeadUrlParams({
                    flavor: resolveFlavorUrlToken(nextValue),
                  });
                }}
                menuMinWidthPx={220}
                menuMaxWidthPx={360}
                searchPlaceholder="Filter flavors..."
                className="w-full max-w-full rounded-lg text-sm sm:w-52"
              />
            </div>

            <div className="app-muted w-full min-w-0 space-y-1 text-xs font-medium sm:w-auto">
              <label htmlFor={flavorBSelectId} className="block">
                Flavor B
              </label>
              <AppSelect
                id={flavorBSelectId}
                ariaLabel="Flavor B"
                options={flavorBOptions}
                value={flavorB}
                onValueChange={(nextValue) => {
                  setFlavorB(nextValue);
                  setVisibleCount(PAGE_BATCH_SIZE);
                  syncHeadToHeadUrlParams({
                    rival: resolveFlavorUrlToken(nextValue),
                  });
                }}
                menuMinWidthPx={220}
                menuMaxWidthPx={360}
                searchPlaceholder="Filter rival flavors..."
                className="w-full max-w-full rounded-lg text-sm sm:w-52"
              />
            </div>

            <div className="app-muted w-full min-w-0 space-y-1 text-xs font-medium sm:w-auto">
              <label htmlFor={pairSortSelectId} className="block">
                Sort
              </label>
              <AppSelect<PairSortMode>
                id={pairSortSelectId}
                ariaLabel="Sort shared image pairs"
                options={PAIR_SORT_OPTIONS}
                value={pairSort}
                onValueChange={(nextSort) => {
                  setPairSort(nextSort);
                  syncHeadToHeadUrlParams({ sort: nextSort });
                }}
                menuMinWidthPx={190}
                className="w-full max-w-full rounded-lg text-sm sm:w-44"
              />
            </div>

            {isFiltered ? (
              <button
                type="button"
                onClick={() => {
                  setFlavorA("all");
                  setFlavorB("all");
                  setVisibleCount(PAGE_BATCH_SIZE);
                  syncHeadToHeadUrlParams({ flavor: null, rival: null });
                }}
                className="app-button h-9 cursor-pointer rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                Reset filters
              </button>
            ) : null}
          </div>

          <span className="app-muted pb-2 text-xs tabular-nums">
            Showing {visiblePairs.length.toLocaleString()} of{" "}
            {filteredPairs.length.toLocaleString()} shared image
            {filteredPairs.length === 1 ? "" : "s"}
          </span>
        </div>

        {visiblePairs.length > 0 ? (
          <div className="space-y-4">
            {visiblePairs.map((pair) => {
              const { group, leftCard, rightCard, extraCards } = pair;
              const isExpanded = expandedImageIds.has(group.imageId);
              const isImageBroken = brokenImageIds.has(group.imageId);

              return (
                <div
                  key={group.imageId}
                  className="space-y-2.5 rounded-2xl border border-slate-200/75 bg-white/35 p-3.5 dark:border-cyan-200/12 dark:bg-slate-950/25"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="app-muted line-clamp-1 max-w-3xl">
                      {group.imageDescription?.trim() || "Shared prompt image"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <span className="app-muted">
                        Image mean {formatStudioRate(group.imageMeanRate)} ·{" "}
                        {group.captions.length.toLocaleString()} captions ·{" "}
                      </span>
                      <span className="font-semibold text-foreground">
                        Gap{" "}
                        {pair.pairSpreadPp === null
                          ? "—"
                          : `+${pair.pairSpreadPp.toFixed(1)} pp`}
                      </span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 items-stretch gap-3.5 md:grid-cols-2">
                    <SameImagePunchlineCard
                      imageId={group.imageId}
                      imageUrl={group.imageUrl}
                      imageDescription={group.imageDescription}
                      imageBroken={isImageBroken}
                      onImageError={markImageBroken}
                      card={leftCard}
                      exposureUnitLabel={exposureUnitLabel}
                    />
                    <SameImagePunchlineCard
                      imageId={group.imageId}
                      imageUrl={group.imageUrl}
                      imageDescription={group.imageDescription}
                      imageBroken={isImageBroken}
                      onImageError={markImageBroken}
                      card={rightCard}
                      exposureUnitLabel={exposureUnitLabel}
                    />
                  </div>

                  {extraCards.length > 0 ? (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => toggleExpandedImage(group.imageId)}
                        aria-expanded={isExpanded}
                        className="app-button inline-flex h-8 cursor-pointer items-center rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      >
                        {isExpanded
                          ? "Hide extra captions"
                          : `Show ${extraCards.length.toLocaleString()} more caption${extraCards.length === 1 ? "" : "s"} on this image`}
                      </button>

                      {isExpanded ? (
                        <div className="grid grid-cols-1 items-stretch gap-3.5 md:grid-cols-2">
                          {extraCards.map((extra) => (
                            <SameImagePunchlineCard
                              key={extra.captionId}
                              imageId={group.imageId}
                              imageUrl={group.imageUrl}
                              imageDescription={group.imageDescription}
                              imageBroken={isImageBroken}
                              onImageError={markImageBroken}
                              card={extra}
                              exposureUnitLabel={exposureUnitLabel}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {remainingPairs > 0 ? (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleCount((current) => current + PAGE_BATCH_SIZE)
                  }
                  className="app-button inline-flex h-9 cursor-pointer items-center rounded-lg px-4 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  Show {Math.min(PAGE_BATCH_SIZE, remainingPairs)} more image
                  {Math.min(PAGE_BATCH_SIZE, remainingPairs) === 1 ? "" : "s"} (
                  {remainingPairs.toLocaleString()} remaining)
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <article className="app-card space-y-3 rounded-xl p-6 text-sm">
            <p className="app-muted">
              No shared prompt images in this study contain captions matching
              both selected flavors.
            </p>
            <button
              type="button"
              onClick={() => {
                setFlavorA("all");
                setFlavorB("all");
                setVisibleCount(PAGE_BATCH_SIZE);
                syncHeadToHeadUrlParams({ flavor: null, rival: null });
              }}
              className="app-button inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              Reset filters
            </button>
          </article>
        )}
      </section>
    </div>
  );
}
