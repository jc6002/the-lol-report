"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type {
  AttributionLeaderboardRow,
  CaptionRateDistribution,
  CaptionRateHistogramBucket,
} from "@/utils/attribution-stats";
import {
  type AttributionGroupBy,
  buildLatencyScatterPoints,
  formatChainSecondsLabel,
  type LatencyScatterPoint,
} from "@/utils/attribution-ui-helpers";
import type {
  RetentionStepPoint,
  StudyParticipationFunnel,
} from "@/utils/study-exposure-adapter";

type StudyAttributionChartsProps = {
  funnel: StudyParticipationFunnel;
  activeGroupBy: AttributionGroupBy;
  activeRows: readonly AttributionLeaderboardRow[];
  captionRateHistogram?: CaptionRateDistribution;
  studyPositiveRate: number | null;
  totalExposures: number;
  exposureUnitLabel: "seen cards" | "votes";
  unattributedCaptionCount: number;
};

type AnnotatedScatterPoint = LatencyScatterPoint & {
  shortLabel: string;
  showLabel: boolean;
  labelAnchor: "start" | "middle" | "end";
  labelDx: number;
  labelDy: number;
  radiusPx: number;
};

type PixelRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const CHART_COLORS = {
  grid: "rgba(148, 163, 184, 0.28)",
  axis: "#64748b",
  retentionStroke: "#0d9488",
  retentionFill: "rgba(20, 184, 166, 0.16)",
  scatterFill: "#0284c7",
  scatterStroke: "#0f766e",
  baselineLine: "rgba(100, 116, 139, 0.72)",
};

const HISTOGRAM_BAR_FILLS: readonly string[] = [
  "#e11d48",
  "#f59e0b",
  "#64748b",
  "#0284c7",
  "#0d9488",
];

const subscribeNoop = () => () => undefined;

const SCATTER_CHART_HEIGHT_PX = 240;
const SCATTER_MARGIN = { top: 18, right: 24, bottom: 6, left: 0 } as const;
const SCATTER_Y_AXIS_WIDTH_PX = 44;
const SCATTER_X_AXIS_HEIGHT_PX = 30;

const shortenBubbleLabel = (
  rawLabel: string,
  groupBy: AttributionGroupBy,
  maxChars: number,
): string => {
  const cleaned =
    groupBy === "flavor" ? rawLabel.replace(/^flavor-/i, "") : rawLabel;
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(6, maxChars - 1))}…`;
};

const computeScatterDomainX = (
  points: readonly LatencyScatterPoint[],
): [number, number] => {
  if (points.length === 0) {
    return [0, 10];
  }
  const rawMax =
    Math.max(...points.map((point) => point.medianChainSeconds), 0.5) * 1.15;
  const step = rawMax <= 10 ? 2 : rawMax <= 40 ? 10 : 20;
  return [0, Math.ceil(rawMax / step) * step];
};

const rectsOverlap = (a: PixelRect, b: PixelRect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const annotateScatterPoints = ({
  points,
  groupBy,
  containerWidthPx,
  domainX,
  domainY,
}: {
  points: readonly LatencyScatterPoint[];
  groupBy: AttributionGroupBy;
  containerWidthPx: number;
  domainX: readonly [number, number];
  domainY: readonly [number, number];
}): AnnotatedScatterPoint[] => {
  if (points.length === 0) {
    return [];
  }

  const exps = points.map((p) => p.exposures);
  const maxExp = Math.max(...exps, 1);
  const minExp = Math.min(...exps);

  const plotLeft = SCATTER_MARGIN.left + SCATTER_Y_AXIS_WIDTH_PX;
  const plotRight = containerWidthPx - SCATTER_MARGIN.right;
  const plotWidth = Math.max(0, plotRight - plotLeft);
  const plotTop = SCATTER_MARGIN.top;
  const plotBottom =
    SCATTER_CHART_HEIGHT_PX - SCATTER_MARGIN.bottom - SCATTER_X_AXIS_HEIGHT_PX;
  const plotHeight = Math.max(1, plotBottom - plotTop);

  const maxChars = plotWidth < 300 ? 15 : 22;
  const xSpan = Math.max(domainX[1] - domainX[0], 0.001);
  const ySpan = Math.max(domainY[1] - domainY[0], 0.001);

  const projected = points.map((point) => {
    const expRatio =
      maxExp === minExp ? 0.5 : (point.exposures - minExp) / (maxExp - minExp);
    const radiusPx = Math.round(5.5 + expRatio * 5.5);
    const px =
      plotLeft + ((point.medianChainSeconds - domainX[0]) / xSpan) * plotWidth;
    const py =
      plotBottom - ((point.positiveRatePct - domainY[0]) / ySpan) * plotHeight;
    return {
      point,
      radiusPx,
      px,
      py,
      shortLabel: shortenBubbleLabel(point.label, groupBy, maxChars),
    };
  });

  if (plotWidth < 120) {
    return projected.map(({ point, shortLabel, radiusPx }) => ({
      ...point,
      shortLabel,
      showLabel: false,
      labelAnchor: "start",
      labelDx: radiusPx + 6,
      labelDy: 4,
      radiusPx,
    }));
  }

  // Every bubble circle (with safety margin) blocks any label from crossing it.
  const circleObstacles: PixelRect[] = projected.map(({ px, py, radiusPx }) => ({
    left: px - radiusPx - 5,
    right: px + radiusPx + 5,
    top: py - radiusPx - 5,
    bottom: py + radiusPx + 5,
  }));

  // Prioritize highest positive-rate leader, then fastest Pareto frontier, then exposures.
  const fastestX = Math.min(...points.map((p) => p.medianChainSeconds));
  const prioritized = [...projected].sort((left, right) => {
    const leftFastest = left.point.medianChainSeconds === fastestX ? 1 : 0;
    const rightFastest = right.point.medianChainSeconds === fastestX ? 1 : 0;
    if (left.point.positiveRatePct !== right.point.positiveRatePct) {
      // Highest point always places first; tie/near-tie yields to fastest frontier.
      const diff = right.point.positiveRatePct - left.point.positiveRatePct;
      if (Math.abs(diff) > 2.5 || leftFastest === rightFastest) {
        return diff;
      }
      return rightFastest - leftFastest;
    }
    if (leftFastest !== rightFastest) {
      return rightFastest - leftFastest;
    }
    return right.point.exposures - left.point.exposures;
  });

  const acceptedLabelObstacles: PixelRect[] = [];
  const placementByKey = new Map<
    string,
    Pick<
      AnnotatedScatterPoint,
      "showLabel" | "labelAnchor" | "labelDx" | "labelDy"
    >
  >();

  for (const item of prioritized) {
    const r = item.radiusPx;
    const estWidth = item.shortLabel.length * 6.9 + 6;
    const candidates: ReadonlyArray<{
      anchor: "start" | "middle" | "end";
      dx: number;
      dy: number;
    }> = [
      { anchor: "start", dx: r + 6, dy: 4 },
      { anchor: "middle", dx: 0, dy: -(r + 9) },
      { anchor: "middle", dx: 0, dy: r + 16 },
      { anchor: "end", dx: -(r + 6), dy: 4 },
      { anchor: "start", dx: -4, dy: -(r + 9) },
      { anchor: "start", dx: -4, dy: r + 16 },
      { anchor: "end", dx: 4, dy: -(r + 9) },
      { anchor: "end", dx: 4, dy: r + 16 },
    ];

    let chosen: {
      anchor: "start" | "middle" | "end";
      dx: number;
      dy: number;
      rect: PixelRect;
    } | null = null;

    for (const candidate of candidates) {
      const anchorX = item.px + candidate.dx;
      const anchorY = item.py + candidate.dy;
      const left =
        candidate.anchor === "start"
          ? anchorX
          : candidate.anchor === "middle"
            ? anchorX - estWidth / 2
            : anchorX - estWidth;
      const rect: PixelRect = {
        left,
        right: left + estWidth,
        top: anchorY - 11,
        bottom: anchorY + 3,
      };

      if (
        rect.left < plotLeft + 2 ||
        rect.right > plotRight + 16 ||
        rect.top < 4 ||
        rect.bottom > plotBottom - 4
      ) {
        continue;
      }
      if (circleObstacles.some((obs) => rectsOverlap(rect, obs))) {
        continue;
      }
      if (acceptedLabelObstacles.some((obs) => rectsOverlap(rect, obs))) {
        continue;
      }
      chosen = { ...candidate, rect };
      break;
    }

    if (chosen) {
      acceptedLabelObstacles.push({
        left: chosen.rect.left - 6,
        right: chosen.rect.right + 6,
        top: chosen.rect.top - 4,
        bottom: chosen.rect.bottom + 4,
      });
      placementByKey.set(item.point.key, {
        showLabel: true,
        labelAnchor: chosen.anchor,
        labelDx: chosen.dx,
        labelDy: chosen.dy,
      });
    } else {
      placementByKey.set(item.point.key, {
        showLabel: false,
        labelAnchor: "start",
        labelDx: r + 6,
        labelDy: 4,
      });
    }
  }

  return projected.map(({ point, shortLabel, radiusPx }) => {
    const placement = placementByKey.get(point.key);
    return {
      ...point,
      shortLabel,
      showLabel: placement?.showLabel ?? false,
      labelAnchor: placement?.labelAnchor ?? "start",
      labelDx: placement?.labelDx ?? radiusPx + 6,
      labelDy: placement?.labelDy ?? 4,
      radiusPx,
    };
  });
};

const LabeledScatterShape = (props: {
  cx?: number;
  cy?: number;
  payload?: AnnotatedScatterPoint;
}) => {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) {
    return null;
  }

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={payload.radiusPx}
        fill={CHART_COLORS.scatterFill}
        fillOpacity={0.78}
        stroke={CHART_COLORS.scatterStroke}
        strokeWidth={1.5}
      />
      {payload.showLabel ? (
        <text
          x={cx + payload.labelDx}
          y={cy + payload.labelDy}
          textAnchor={payload.labelAnchor}
          fontSize={11}
          fontWeight={600}
          className="pointer-events-none select-none fill-slate-900 dark:fill-slate-100"
          style={{
            paintOrder: "stroke",
            stroke: "var(--surface)",
            strokeWidth: 3.5,
            strokeLinejoin: "round",
          }}
        >
          {payload.shortLabel}
        </text>
      ) : null}
    </g>
  );
};

const RetentionTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: RetentionStepPoint }>;
}) => {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="app-tooltip rounded-xl p-3 text-xs tabular-nums">
      <p className="font-semibold text-foreground">
        Card #{point.captionPosition.toLocaleString()}
      </p>
      <p className="mt-1 text-foreground">
        {point.activeUsers.toLocaleString()} active (
        {point.activeSharePct.toFixed(1)}%)
      </p>
      <p className="app-muted mt-0.5">
        Finished here: {point.droppedUsers.toLocaleString()}
      </p>
    </div>
  );
};

const LatencyScatterTooltip = ({
  active,
  payload,
  exposureUnitLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: AnnotatedScatterPoint }>;
  exposureUnitLabel: "seen cards" | "votes";
}) => {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="app-tooltip max-w-xs rounded-xl p-3 text-xs tabular-nums">
      <p className="break-words font-mono font-semibold text-foreground">
        {point.label}
      </p>
      <p className="mt-1 text-foreground">
        Positive rate:{" "}
        <span className="font-semibold">
          {point.positiveRatePct.toFixed(1)}%
        </span>{" "}
        <span className="app-muted">
          [{point.ciLowPct.toFixed(1)}%, {point.ciHighPct.toFixed(1)}%]
        </span>
      </p>
      <p className="app-muted mt-0.5">
        {point.positive.toLocaleString()} / {point.exposures.toLocaleString()}{" "}
        {exposureUnitLabel} across {point.captionCount.toLocaleString()}{" "}
        {point.captionCount === 1 ? "caption" : "captions"}
      </p>
      <p className="app-muted mt-0.5">
        Median generation: {formatChainSecondsLabel(point.medianChainSeconds)}
      </p>
    </div>
  );
};

const HistogramTooltip = ({
  active,
  payload,
  scoredCaptionCount,
}: {
  active?: boolean;
  payload?: Array<{ payload: CaptionRateHistogramBucket }>;
  scoredCaptionCount: number;
}) => {
  const bucket = payload?.[0]?.payload;
  if (!active || !bucket) {
    return null;
  }
  const sharePct =
    scoredCaptionCount > 0
      ? ((bucket.captionCount / scoredCaptionCount) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="app-tooltip rounded-xl p-3 text-xs tabular-nums">
      <p className="font-semibold text-foreground">
        {bucket.label} positive rate
      </p>
      <p className="mt-1 text-foreground">
        <span className="font-semibold">
          {bucket.captionCount.toLocaleString()}
        </span>{" "}
        {bucket.captionCount === 1 ? "caption" : "captions"} ({sharePct}%)
      </p>
    </div>
  );
};

export function StudyAttributionCharts({
  funnel,
  activeGroupBy,
  activeRows,
  captionRateHistogram,
  studyPositiveRate,
  totalExposures,
  exposureUnitLabel,
  unattributedCaptionCount,
}: StudyAttributionChartsProps) {
  const isHydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const [scatterContainerEl, setScatterContainerEl] =
    useState<HTMLDivElement | null>(null);
  const [scatterWidthPx, setScatterWidthPx] = useState<number>(0);

  useEffect(() => {
    if (!scatterContainerEl) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const rounded = Math.round(entry.contentRect.width);
      if (rounded > 0) {
        setScatterWidthPx((prev) => (prev === rounded ? prev : rounded));
      }
    });
    observer.observe(scatterContainerEl);
    return () => observer.disconnect();
  }, [scatterContainerEl]);

  const rawScatterPoints = useMemo(
    () => buildLatencyScatterPoints(activeRows),
    [activeRows],
  );

  const showScatter = rawScatterPoints.length >= 2;
  const studyMeanPct =
    studyPositiveRate !== null
      ? Number((studyPositiveRate * 100).toFixed(2))
      : null;

  const scatterDomainX = useMemo<[number, number]>(
    () => computeScatterDomainX(rawScatterPoints),
    [rawScatterPoints],
  );

  const scatterDomainY = useMemo<[number, number]>(() => {
    if (rawScatterPoints.length === 0) {
      return [0, 100];
    }
    const observed = rawScatterPoints.map((p) => p.positiveRatePct);
    if (studyMeanPct !== null) {
      observed.push(studyMeanPct);
    }
    const rawMin = Math.min(...observed);
    const rawMax = Math.max(...observed);
    let low = Math.max(0, Math.floor((rawMin - 8) / 5) * 5);
    let high = Math.min(100, Math.ceil((rawMax + 8) / 5) * 5);
    if (high - low < 15) {
      low = Math.max(0, low - 5);
      high = Math.min(100, high + 5);
    }
    return [low, high];
  }, [rawScatterPoints, studyMeanPct]);

  const scatterPoints = useMemo(
    () =>
      annotateScatterPoints({
        points: rawScatterPoints,
        groupBy: activeGroupBy,
        containerWidthPx: scatterWidthPx,
        domainX: scatterDomainX,
        domainY: scatterDomainY,
      }),
    [
      activeGroupBy,
      rawScatterPoints,
      scatterDomainX,
      scatterDomainY,
      scatterWidthPx,
    ],
  );

  const retentionDomainY = useMemo<[number, number]>(() => {
    if (funnel.retentionCurve.length < 2) {
      return [0, 100];
    }
    const minShare = Math.min(
      ...funnel.retentionCurve.map((point) => point.activeSharePct),
    );
    if (minShare >= 75) {
      return [Math.max(0, Math.floor((minShare - 8) / 10) * 10), 100];
    }
    return [0, 100];
  }, [funnel.retentionCurve]);

  const finalRetentionStep =
    funnel.retentionCurve.length > 0
      ? funnel.retentionCurve[funnel.retentionCurve.length - 1]
      : null;

  const stageRows = [
    {
      label: "Started run",
      count: funnel.participationsStarted,
    },
    {
      label: "Judged ≥ 1 caption",
      count: funnel.judgedAtLeastOneCount,
    },
    {
      label: "Completed study",
      count: funnel.participationsEnded,
    },
  ];
  const maxStageCount = Math.max(...stageRows.map((row) => row.count), 1);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <article className="app-chart-card min-w-0 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            Retention Across Study Deck
          </h2>
          <span className="app-muted text-xs tabular-nums">
            {funnel.participationsStarted > 0
              ? `${funnel.participationsStarted.toLocaleString()} started · ${funnel.participationsEnded.toLocaleString()} finished`
              : `${funnel.distinctVoters.toLocaleString()} active ${funnel.distinctVoters === 1 ? "voter" : "voters"}`}
            {finalRetentionStep
              ? ` · card #${finalRetentionStep.captionPosition}: ${finalRetentionStep.activeSharePct.toFixed(1)}%`
              : ""}
          </span>
        </div>

        {funnel.retentionCurve.length < 2 ? (
          <div className="mt-3 flex h-60 flex-col justify-center space-y-4 rounded-lg border border-slate-200/70 bg-white/30 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-950/20">
            {stageRows.map((stage) => {
              const widthPct = Math.min(
                100,
                Math.max(0, (stage.count / maxStageCount) * 100),
              );
              return (
                <div key={stage.label} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground">
                      {stage.label}
                    </span>
                    <span className="app-muted font-semibold tabular-nums">
                      {stage.count.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/85 dark:bg-slate-800/90">
                    <div
                      className="h-full rounded-full bg-teal-600 dark:bg-cyan-400"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : !isHydrated ? (
          <div
            aria-hidden="true"
            className="mt-3 h-60 w-full rounded-lg bg-slate-200/35 dark:bg-slate-800/35"
          />
        ) : (
          <div className="mt-3 h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={funnel.retentionCurve}
                margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
                accessibilityLayer
              >
                <CartesianGrid
                  stroke={CHART_COLORS.grid}
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="captionPosition"
                  stroke={CHART_COLORS.axis}
                  tick={{ fontSize: 11 }}
                  minTickGap={28}
                  tickFormatter={(value) => `#${Math.round(Number(value))}`}
                />
                <YAxis
                  domain={retentionDomainY}
                  stroke={CHART_COLORS.axis}
                  width={44}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => `${Math.round(Number(value))}%`}
                />
                <Tooltip content={<RetentionTooltip />} />
                <Area
                  type="monotone"
                  dataKey="activeSharePct"
                  name="Active voters"
                  stroke={CHART_COLORS.retentionStroke}
                  strokeWidth={2.25}
                  fill={CHART_COLORS.retentionFill}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </article>

      <article className="app-chart-card flex min-w-0 flex-col justify-between rounded-xl p-4">
        <div>
          {showScatter ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Positive Rate vs. Generation Time
                </h2>
                <span className="app-muted text-xs tabular-nums">
                  {studyMeanPct !== null
                    ? `Dashed = ${studyMeanPct.toFixed(1)}% study mean · size = ${exposureUnitLabel}`
                    : `Size = ${exposureUnitLabel}`}
                </span>
              </div>

              {!isHydrated ? (
                <div
                  aria-hidden="true"
                  className="mt-3 h-60 w-full rounded-lg bg-slate-200/35 dark:bg-slate-800/35"
                />
              ) : (
                <div ref={setScatterContainerEl} className="mt-3 h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart
                      margin={SCATTER_MARGIN}
                      accessibilityLayer
                    >
                      <CartesianGrid
                        stroke={CHART_COLORS.grid}
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        type="number"
                        dataKey="medianChainSeconds"
                        name="Generation time"
                        domain={scatterDomainX}
                        allowDataOverflow
                        height={SCATTER_X_AXIS_HEIGHT_PX}
                        stroke={CHART_COLORS.axis}
                        tick={{ fontSize: 11 }}
                        minTickGap={24}
                        tickFormatter={(value) =>
                          formatChainSecondsLabel(Number(value))
                        }
                      />
                      <YAxis
                        type="number"
                        dataKey="positiveRatePct"
                        name="Positive rate"
                        domain={scatterDomainY}
                        allowDataOverflow
                        stroke={CHART_COLORS.axis}
                        width={SCATTER_Y_AXIS_WIDTH_PX}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) =>
                          `${Math.round(Number(value))}%`
                        }
                      />
                      <ZAxis
                        type="number"
                        dataKey="exposures"
                        range={[64, 340]}
                        name="Exposures"
                      />
                      <Tooltip
                        cursor={{
                          stroke: "rgba(148, 163, 184, 0.5)",
                          strokeDasharray: "4 4",
                        }}
                        content={
                          <LatencyScatterTooltip
                            exposureUnitLabel={exposureUnitLabel}
                          />
                        }
                      />
                      {studyMeanPct !== null ? (
                        <ReferenceLine
                          y={studyMeanPct}
                          stroke={CHART_COLORS.baselineLine}
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      <Scatter
                        name="Evaluated groups"
                        data={scatterPoints}
                        shape={<LabeledScatterShape />}
                        isAnimationActive={false}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Caption Positive-Rate Distribution
                </h2>
                <span className="app-muted text-xs tabular-nums">
                  {captionRateHistogram
                    ? `${captionRateHistogram.scoredCaptionCount.toLocaleString()} scored caption${captionRateHistogram.scoredCaptionCount === 1 ? "" : "s"}${
                        captionRateHistogram.unratedCaptionCount > 0
                          ? ` · ${captionRateHistogram.unratedCaptionCount.toLocaleString()} unrated`
                          : ""
                      }`
                    : `${totalExposures.toLocaleString()} ${exposureUnitLabel}`}
                </span>
              </div>

              {!captionRateHistogram ||
              captionRateHistogram.scoredCaptionCount === 0 ? (
                <div className="mt-3 flex h-60 w-full items-center justify-center rounded-lg border border-dashed border-slate-300/75 bg-white/30 px-5 text-center dark:border-slate-700/70 dark:bg-slate-950/20">
                  <p className="app-muted max-w-sm text-xs leading-5">
                    No {exposureUnitLabel} have been recorded yet for captions
                    in this study.
                  </p>
                </div>
              ) : !isHydrated ? (
                <div
                  aria-hidden="true"
                  className="mt-3 h-60 w-full rounded-lg bg-slate-200/35 dark:bg-slate-800/35"
                />
              ) : (
                <div className="mt-3 h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={captionRateHistogram.buckets}
                      margin={{ top: 10, right: 12, bottom: 4, left: 0 }}
                      accessibilityLayer
                    >
                      <CartesianGrid
                        stroke={CHART_COLORS.grid}
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        stroke={CHART_COLORS.axis}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        allowDecimals={false}
                        stroke={CHART_COLORS.axis}
                        width={36}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                        content={
                          <HistogramTooltip
                            scoredCaptionCount={
                              captionRateHistogram.scoredCaptionCount
                            }
                          />
                        }
                      />
                      <Bar
                        dataKey="captionCount"
                        name="Captions"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={52}
                        isAnimationActive={false}
                      >
                        {captionRateHistogram.buckets.map((bucket, index) => (
                          <Cell
                            key={bucket.bucketKey}
                            fill={
                              HISTOGRAM_BAR_FILLS[index] ??
                              CHART_COLORS.scatterFill
                            }
                            fillOpacity={0.82}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </div>

        {unattributedCaptionCount > 0 ? (
          <p className="app-muted mt-2 text-xs tabular-nums">
            {unattributedCaptionCount.toLocaleString()} manual/unlinked{" "}
            {unattributedCaptionCount === 1 ? "caption is" : "captions are"}{" "}
            included in the study totals below.
          </p>
        ) : null}
      </article>
    </div>
  );
}
