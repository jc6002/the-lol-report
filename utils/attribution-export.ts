import {
  MIN_COHORT_VOTERS,
  type AttributionLeaderboardRow,
  type CohortTasteGapRow,
  type DemographicCohortRow,
  type DemographicQuestionMatrix,
  type SameImageCaptionCardMetric,
  type SameImageComparisonGroup,
} from "@/utils/attribution-stats";
import { formatDurationFromMinutes } from "@/utils/format-duration";
import {
  buildStudyPdfReportData,
  type StudyPdfReportData,
} from "@/utils/pdf-report-builder";
import type { StudyAttributionBundle } from "@/utils/study-lineage-loader";

export type { StudyPdfReportData };

export type StudyExportPayload = {
  studyId: number;
  pdfFilename: string;
  pdfReport: StudyPdfReportData;
  csvFilename: string;
  csvContent: string;
  briefFilename: string;
  briefMarkdown: string;
};

export type LiftSortKey =
  | "label"
  | "sharedImageCount"
  | "rate"
  | "imageBaselineMean"
  | "meanLiftPp"
  | "pairWinRate";

export type SortDirection = "asc" | "desc";
export type PairSortMode = "gap" | "winner" | "exposures";

export type ResolvedGroupPair = {
  group: SameImageComparisonGroup;
  leftCard: SameImageCaptionCardMetric;
  rightCard: SameImageCaptionCardMetric;
  extraCards: SameImageCaptionCardMetric[];
  pairSpreadPp: number | null;
  winnerRate: number;
};

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r", "\n"]);

const ATTRIBUTION_CSV_HEADERS = [
  "study_id",
  "study_slug",
  "era_format",
  "rater_filter",
  "flavor_slug",
  "terminal_model",
  "captions",
  "exposures",
  "positive_count",
  "positive_rate",
  "wilson_95_low",
  "wilson_95_high",
  "shared_images",
  "mean_same_image_lift_pp",
  "median_chain_seconds",
] as const;

const utcBriefDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function formatStudioRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}

export function formatSignedPp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const rounded = Number(value.toFixed(1));
  if (rounded > 0) {
    return `+${rounded.toFixed(1)} pp`;
  }
  if (rounded < 0) {
    return `${rounded.toFixed(1)} pp`;
  }
  return "0.0 pp";
}

export function formatChainSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  if (value > 0 && value < 0.05) {
    return "<0.1s";
  }
  return `${value.toFixed(1)}s`;
}

export function getHeatmapTintClassName(deltaPp: number): string {
  if (deltaPp <= -8) {
    return "bg-rose-500/22";
  }
  if (deltaPp < -2) {
    return "bg-rose-500/10";
  }
  if (deltaPp <= 2) {
    return "bg-transparent";
  }
  if (deltaPp < 8) {
    return "bg-teal-500/12";
  }
  return "bg-teal-500/24";
}

export function buildHeadToHeadFlavorHref(
  studyId: number,
  flavorId: number | null,
  excludeHighRisk: boolean,
): string {
  const params = new URLSearchParams();
  if (flavorId !== null) {
    params.set("flavor", String(flavorId));
  }
  if (excludeHighRisk) {
    params.set("excludeHighRisk", "1");
  }
  const query = params.toString();
  const basePath = `/study/${studyId}/head-to-head`;
  return query.length > 0 ? `${basePath}?${query}` : basePath;
}

/**
 * Returns true when a question contains a pooled small-segment row (`masked_pool`)
 * whose combined headcount is itself below the `k >= 5` privacy threshold.
 */
export function hasSuppressedCohortPool(
  question: DemographicQuestionMatrix,
): boolean {
  return question.rows.some(
    (row) => row.rowKind === "masked_pool" && row.distinctVoters === null,
  );
}

/**
 * Formats the respondent count badge for a survey question in dropdown controls
 * without exposing direct `1..4` counts or allowing subtraction against visible
 * answer rows (`surveyedRespondentCount - sum(visibleAnswerRows)`).
 */
export function formatQuestionRespondentLabel(
  question: DemographicQuestionMatrix,
): string {
  if (question.surveyedRespondentCount <= 0) {
    return "n=0";
  }
  if (question.surveyedRespondentCount < MIN_COHORT_VOTERS) {
    return "n < 5";
  }
  if (hasSuppressedCohortPool(question)) {
    const disclosedVoters = question.rows.reduce(
      (sum, row) =>
        row.rowKind === "answer" ? sum + (row.distinctVoters ?? 0) : sum,
      0,
    );
    return `n≥${disclosedVoters.toLocaleString()}`;
  }
  const studyTotal =
    question.surveyedRespondentCount + question.unsurveyedVoterCount;
  const hasSmallUnsurveyed =
    question.unsurveyedVoterCount > 0 &&
    question.unsurveyedVoterCount < MIN_COHORT_VOTERS;
  const skippedSurveyed =
    question.studySurveyedVoterCount !== undefined
      ? question.studySurveyedVoterCount - question.surveyedRespondentCount
      : 0;
  const hasSmallSkippedSurveyed =
    skippedSurveyed > 0 && skippedSurveyed < MIN_COHORT_VOTERS;
  if (hasSmallUnsurveyed || hasSmallSkippedSurveyed) {
    const bounds: number[] = [MIN_COHORT_VOTERS];
    if (hasSmallUnsurveyed) {
      bounds.push(studyTotal - (MIN_COHORT_VOTERS - 1));
    }
    if (
      hasSmallSkippedSurveyed &&
      question.studySurveyedVoterCount !== undefined
    ) {
      bounds.push(question.studySurveyedVoterCount - (MIN_COHORT_VOTERS - 1));
    }
    const lowerBound = Math.min(
      question.surveyedRespondentCount,
      Math.max(...bounds),
    );
    return `n≥${lowerBound.toLocaleString()}`;
  }
  return `n=${question.surveyedRespondentCount.toLocaleString()}`;
}

/**
 * Formats the study-level surveyed voter KPI text while masking direct `1..4`
 * participant counts and derivative coverage percentages.
 */
export function formatSurveyedVoterSummary(
  surveyed: number,
  total: number,
): { primary: string; subtitle: string } {
  if (surveyed > 0 && surveyed < MIN_COHORT_VOTERS) {
    return {
      primary: `< ${MIN_COHORT_VOTERS} surveyed`,
      subtitle: `${total.toLocaleString()} study voter${total === 1 ? "" : "s"} · masked below k ≥ ${MIN_COHORT_VOTERS}`,
    };
  }
  const unsurveyed = total - surveyed;
  if (
    surveyed >= MIN_COHORT_VOTERS &&
    unsurveyed > 0 &&
    unsurveyed < MIN_COHORT_VOTERS
  ) {
    const lowerBound = Math.min(
      surveyed,
      Math.max(MIN_COHORT_VOTERS, total - (MIN_COHORT_VOTERS - 1)),
    );
    const floorPct =
      total > 0 ? ((lowerBound / total) * 100).toFixed(1) : "—";
    return {
      primary: `≥ ${lowerBound.toLocaleString()} / ${total.toLocaleString()}`,
      subtitle: `≥ ${floorPct}% with demographic responses · < ${MIN_COHORT_VOTERS} unsurveyed masked`,
    };
  }
  const coverageText =
    total > 0 ? `${((surveyed / total) * 100).toFixed(1)}%` : "—";
  return {
    primary: `${surveyed.toLocaleString()} / ${total.toLocaleString()}`,
    subtitle: `${coverageText} with demographic responses`,
  };
}

export function getCohortRowVoterSubtitle(
  row: DemographicCohortRow,
  hasSuppressedMaskedPool = false,
  options?: {
    coarsenVoterCounts?: boolean;
    hideUnsurveyedCount?: boolean;
  },
): string {
  const coarsen = Boolean(options?.coarsenVoterCounts);
  const hideUnsurv =
    hasSuppressedMaskedPool || Boolean(options?.hideUnsurveyedCount) || coarsen;
  if (row.rowKind === "masked_pool") {
    const optionLabel = `${row.pooledOptionCount} option${row.pooledOptionCount === 1 ? "" : "s"}`;
    if (row.distinctVoters === null) {
      return optionLabel;
    }
    if (coarsen) {
      return `${optionLabel} · n≥${MIN_COHORT_VOTERS} voters`;
    }
    return `${optionLabel} · n=${row.distinctVoters.toLocaleString()} voters`;
  }
  if (row.rowKind === "unsurveyed" && hideUnsurv) {
    return "";
  }
  if (row.distinctVoters === null) {
    return "";
  }
  if (coarsen) {
    return `n≥${MIN_COHORT_VOTERS} voters`;
  }
  return `n=${row.distinctVoters.toLocaleString()} voters`;
}

export function matchFlavorRowByParam(
  rows: readonly AttributionLeaderboardRow[],
  rawParam: string | null,
): AttributionLeaderboardRow | null {
  const trimmed = rawParam?.trim();
  if (!trimmed) {
    return null;
  }
  const normalizedLower = trimmed.toLowerCase();
  for (const row of rows) {
    if (row.isUnattributed) {
      continue;
    }
    if (
      (row.flavorId !== null && String(row.flavorId) === trimmed) ||
      row.key.toLowerCase() === normalizedLower ||
      row.label.toLowerCase() === normalizedLower
    ) {
      return row;
    }
  }
  return null;
}

export function getDefaultLiftSortDirection(
  column: LiftSortKey,
): SortDirection {
  return column === "label" ? "asc" : "desc";
}

const compareNullableMetric = (
  left: number | null,
  right: number | null,
  direction: SortDirection,
): number => {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return direction === "asc" ? left - right : right - left;
};

/**
 * Sorts flavor rows for the Same-Image Lift leaderboard while always pinning
 * any `Unattributed / Manual` reconciliation row at the bottom.
 */
export function sortSameImageLiftRows(
  rows: readonly AttributionLeaderboardRow[],
  sortBy: LiftSortKey,
  direction: SortDirection,
): AttributionLeaderboardRow[] {
  return [...rows].sort((left, right) => {
    if (left.isUnattributed !== right.isUnattributed) {
      return left.isUnattributed ? 1 : -1;
    }

    let primary = 0;
    switch (sortBy) {
      case "label": {
        const cmp = left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
        });
        primary = direction === "asc" ? cmp : -cmp;
        break;
      }
      case "sharedImageCount":
        primary =
          direction === "asc"
            ? left.sharedImageCount - right.sharedImageCount
            : right.sharedImageCount - left.sharedImageCount;
        break;
      case "rate":
        primary = compareNullableMetric(left.rate, right.rate, direction);
        break;
      case "imageBaselineMean":
        primary = compareNullableMetric(
          left.imageBaselineMean,
          right.imageBaselineMean,
          direction,
        );
        break;
      case "meanLiftPp":
        primary = compareNullableMetric(
          left.meanLiftPp,
          right.meanLiftPp,
          direction,
        );
        break;
      case "pairWinRate":
        primary = compareNullableMetric(
          left.pairWinRate,
          right.pairWinRate,
          direction,
        );
        break;
    }

    if (primary !== 0) {
      return primary;
    }

    const fallbackLift = compareNullableMetric(
      left.meanLiftPp,
      right.meanLiftPp,
      "desc",
    );
    if (fallbackLift !== 0) {
      return fallbackLift;
    }
    if (left.exposures !== right.exposures) {
      return right.exposures - left.exposures;
    }
    return left.label.localeCompare(right.label);
  });
}

/**
 * Selects the left (higher/focus) and right (rival/lower) cards for a shared
 * prompt image given the active Flavor A and Flavor B filters.
 */
export function resolveSameImageGroupPair({
  group,
  flavorA,
  flavorB,
}: {
  group: SameImageComparisonGroup;
  flavorA: string;
  flavorB: string;
}): ResolvedGroupPair | null {
  if (group.captions.length < 2) {
    return null;
  }

  const filterAllA = flavorA === "all";
  const filterAllB = flavorB === "all";

  let leftCard: SameImageCaptionCardMetric | undefined;
  let rightCard: SameImageCaptionCardMetric | undefined;

  if (filterAllA && filterAllB) {
    leftCard = group.captions[0];
    const crossFlavorFlop = [...group.captions]
      .reverse()
      .find(
        (card) =>
          card.captionId !== leftCard?.captionId &&
          card.flavorKey !== leftCard?.flavorKey,
      );
    rightCard = crossFlavorFlop ?? group.captions[group.captions.length - 1];
  } else if (!filterAllA && filterAllB) {
    leftCard = group.captions.find((card) => card.flavorKey === flavorA);
    if (!leftCard) {
      return null;
    }
    const crossFlavorRival = [...group.captions]
      .reverse()
      .find(
        (card) =>
          card.captionId !== leftCard?.captionId && card.flavorKey !== flavorA,
      );
    rightCard =
      crossFlavorRival ??
      [...group.captions]
        .reverse()
        .find((card) => card.captionId !== leftCard?.captionId);
  } else if (filterAllA && !filterAllB) {
    rightCard = [...group.captions]
      .reverse()
      .find((card) => card.flavorKey === flavorB);
    if (!rightCard) {
      return null;
    }
    const crossFlavorLeader = group.captions.find(
      (card) =>
        card.captionId !== rightCard?.captionId && card.flavorKey !== flavorB,
    );
    leftCard =
      crossFlavorLeader ??
      group.captions.find((card) => card.captionId !== rightCard?.captionId);
  } else if (flavorA === flavorB) {
    const matching = group.captions.filter((card) => card.flavorKey === flavorA);
    if (matching.length < 2) {
      return null;
    }
    leftCard = matching[0];
    rightCard = matching[matching.length - 1];
  } else {
    leftCard = group.captions.find((card) => card.flavorKey === flavorA);
    rightCard = group.captions.find(
      (card) =>
        card.flavorKey === flavorB && card.captionId !== leftCard?.captionId,
    );
  }

  if (!leftCard || !rightCard || leftCard.captionId === rightCard.captionId) {
    return null;
  }

  const extraCards = group.captions.filter(
    (card) =>
      card.captionId !== leftCard.captionId &&
      card.captionId !== rightCard.captionId,
  );
  const pairSpreadPp =
    leftCard.rate !== null && rightCard.rate !== null
      ? Math.abs(leftCard.rate - rightCard.rate) * 100
      : group.spreadPp;
  const winnerRate = Math.max(leftCard.rate ?? -1, rightCard.rate ?? -1);

  return {
    group,
    leftCard,
    rightCard,
    extraCards,
    pairSpreadPp,
    winnerRate,
  };
}

export function sortResolvedGroupPairs(
  pairs: readonly ResolvedGroupPair[],
  pairSort: PairSortMode,
): ResolvedGroupPair[] {
  const isReliablePair = (pair: ResolvedGroupPair): number =>
    pair.leftCard.rate !== null &&
    pair.rightCard.rate !== null &&
    Math.min(pair.leftCard.exposures, pair.rightCard.exposures) >=
      MIN_COHORT_VOTERS
      ? 1
      : 0;

  return [...pairs].sort((left, right) => {
    if (pairSort === "winner") {
      if (left.winnerRate !== right.winnerRate) {
        return right.winnerRate - left.winnerRate;
      }
    } else if (pairSort === "exposures") {
      if (left.group.totalExposures !== right.group.totalExposures) {
        return right.group.totalExposures - left.group.totalExposures;
      }
    } else {
      const leftReliable = isReliablePair(left);
      const rightReliable = isReliablePair(right);
      if (leftReliable !== rightReliable) {
        return rightReliable - leftReliable;
      }
      const leftGap = left.pairSpreadPp ?? -1;
      const rightGap = right.pairSpreadPp ?? -1;
      if (leftGap !== rightGap) {
        return rightGap - leftGap;
      }
    }

    if (left.group.totalExposures !== right.group.totalExposures) {
      return right.group.totalExposures - left.group.totalExposures;
    }
    return left.group.imageId.localeCompare(right.group.imageId);
  });
}

/**
 * Neutralizes spreadsheet formula injection on free-text CSV cells by prefixing
 * leading formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`, `\n`) with `'`.
 */
export function sanitizeCsvText(rawValue: string): string {
  if (rawValue.length === 0) {
    return "";
  }
  const firstChar = rawValue[0];
  const trimmedFirstChar = rawValue.trimStart()[0];
  if (
    FORMULA_TRIGGER_CHARS.has(firstChar) ||
    (trimmedFirstChar !== undefined && FORMULA_TRIGGER_CHARS.has(trimmedFirstChar))
  ) {
    return `'${rawValue}`;
  }
  return rawValue;
}

/**
 * Encodes a scalar cell according to RFC 4180 while applying formula-injection
 * neutralization on `"text"` cells and preserving clean numeric literals on
 * `"number"` cells.
 */
export function encodeCsvCell(
  value: string | number | null | undefined,
  kind: "text" | "number",
): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (kind === "number") {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? String(numeric) : "";
  }

  const sanitized = sanitizeCsvText(String(value));
  if (sanitized.length === 0) {
    return "";
  }

  const mustQuote =
    sanitized.startsWith("'") ||
    /[",\r\n\t]/.test(sanitized) ||
    sanitized.trim() !== sanitized;

  if (mustQuote) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

export function getStudyAttributionPdfFilename(
  studyId: number,
  excludeHighRisk = false,
): string {
  return excludeHighRisk
    ? `study-${studyId}-attribution-report-clean-raters.pdf`
    : `study-${studyId}-attribution-report.pdf`;
}

export function getStudyAttributionCsvFilename(studyId: number): string {
  return `study-${studyId}-attribution.csv`;
}

export function getStudyResearchBriefFilename(studyId: number): string {
  return `study-${studyId}-research-brief.md`;
}

const getExportStudySlug = (bundle: StudyAttributionBundle): string => {
  const slug = bundle.study.slug?.trim();
  if (slug) {
    return slug;
  }
  const description = bundle.study.description?.trim();
  if (description) {
    return description;
  }
  return `study-${bundle.study.id}`;
};

const roundMetric = (value: number | null, digits: number): number | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
};

/**
 * Builds the RFC 4180 CSV export for a single study's prompt flavor attribution
 * leaderboard, including the unattributed reconciliation bucket when present.
 */
export function buildStudyAttributionCsv(bundle: StudyAttributionBundle): string {
  const studySlug = getExportStudySlug(bundle);
  const eraFormat =
    bundle.exposureBundle.mode === "swipe_navigation" ? "Swipe" : "Likert";
  const raterFilter = bundle.excludeHighRisk ? "exclude_high_risk" : "all_raters";

  const lines: string[] = [ATTRIBUTION_CSV_HEADERS.join(",")];

  for (const row of bundle.leaderboards.flavors) {
    const terminalModel =
      row.dominantModelLabel ?? (row.isUnattributed ? "Unattributed" : "");
    const fields = [
      encodeCsvCell(bundle.study.id, "number"),
      encodeCsvCell(studySlug, "text"),
      encodeCsvCell(eraFormat, "text"),
      encodeCsvCell(raterFilter, "text"),
      encodeCsvCell(row.label, "text"),
      encodeCsvCell(terminalModel, "text"),
      encodeCsvCell(row.captionCount, "number"),
      encodeCsvCell(row.exposures, "number"),
      encodeCsvCell(row.positive, "number"),
      encodeCsvCell(roundMetric(row.rate, 4), "number"),
      encodeCsvCell(roundMetric(row.ciLow, 4), "number"),
      encodeCsvCell(roundMetric(row.ciHigh, 4), "number"),
      encodeCsvCell(row.sharedImageCount, "number"),
      encodeCsvCell(roundMetric(row.meanLiftPp, 2), "number"),
      encodeCsvCell(roundMetric(row.medianChainSeconds, 2), "number"),
    ];
    lines.push(fields.join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

const formatUtcTimestamp = (iso: string | null): string => {
  if (!iso) {
    return "Open";
  }
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return iso;
  }
  return utcBriefDateFormatter.format(new Date(parsed));
};

const escapeMarkdownInline = (text: string): string =>
  text
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\|/g, "\\|");

const formatLeaderboardBriefRow = (row: AttributionLeaderboardRow): string => {
  const rateCell =
    row.rate !== null && row.ciLow !== null && row.ciHigh !== null
      ? `${formatStudioRate(row.rate)} [${formatStudioRate(row.ciLow)}, ${formatStudioRate(row.ciHigh)}]`
      : formatStudioRate(row.rate);
  const modelCell =
    row.dominantModelLabel ?? (row.isUnattributed ? "Unattributed" : "—");
  return `| \`${escapeMarkdownInline(row.label)}\` | ${escapeMarkdownInline(modelCell)} | ${row.captionCount.toLocaleString()} | ${row.exposures.toLocaleString()} | ${rateCell} | ${formatSignedPp(row.meanLiftPp)} | ${formatChainSeconds(row.medianChainSeconds)} |`;
};

const formatTasteGapBriefRow = (gap: CohortTasteGapRow): string => {
  const highCount = gap.coarsenVoters
    ? `n>=${MIN_COHORT_VOTERS}`
    : `n=${gap.highVoters}`;
  const lowCount = gap.coarsenVoters
    ? `n>=${MIN_COHORT_VOTERS}`
    : `n=${gap.lowVoters}`;
  return `| \`${escapeMarkdownInline(gap.flavorSlug)}\` | ${escapeMarkdownInline(gap.questionText)} | ${escapeMarkdownInline(gap.highAnswerLabel)} (${formatStudioRate(gap.highRate)}, ${highCount}) | ${escapeMarkdownInline(gap.lowAnswerLabel)} (${formatStudioRate(gap.lowRate)}, ${lowCount}) | +${gap.spreadPp.toFixed(1)} pp |`;
};

const pickGroupEndpointPair = (
  group: SameImageComparisonGroup,
): {
  winner: SameImageCaptionCardMetric;
  flop: SameImageCaptionCardMetric;
} | null => {
  const evaluated = group.captions.filter((card) => card.rate !== null);
  if (evaluated.length < 2) {
    return null;
  }
  const winner = evaluated[0];
  const crossFlavorFlop = [...evaluated]
    .reverse()
    .find((card) => card.flavorKey !== winner.flavorKey);
  const flop = crossFlavorFlop ?? evaluated[evaluated.length - 1];
  return { winner, flop };
};

/**
 * Builds a plain-English Markdown research brief summarizing empirical prompt
 * flavor attribution, privacy-safe (k >= 5) audience gaps, and same-image pairs.
 */
export function buildStudyResearchBriefMarkdown(
  bundle: StudyAttributionBundle,
): string {
  const titleSlug = getExportStudySlug(bundle);
  const startLabel = formatUtcTimestamp(
    bundle.study.start_datetime_utc ?? bundle.study.created_datetime_utc,
  );
  const endLabel = formatUtcTimestamp(bundle.study.end_datetime_utc);

  const denominatorNote =
    bundle.exposureBundle.mode === "swipe_navigation"
      ? "Swipe card views (distinct voter-card navigation exposures matched to same-session likes)"
      : '6-point Likert votes ("funny" and "very funny" counted as positive upvotes)';

  const highRiskCount = bundle.exposureBundle.highRiskVoterCount;
  const raterFilterNote = bundle.excludeHighRisk
    ? `Rushed high-risk raters excluded (${bundle.exposureBundle.excludedVoterCount.toLocaleString()} voter${bundle.exposureBundle.excludedVoterCount === 1 ? "" : "s"} removed)`
    : `All raters included (${highRiskCount.toLocaleString()} high-risk voter${highRiskCount === 1 ? "" : "s"} detected)`;

  const rateLabel =
    bundle.exposureBundle.mode === "swipe_navigation"
      ? "Study like rate"
      : "Study upvote rate";
  const studyCiText =
    bundle.studyRateCi.rate !== null &&
    bundle.studyRateCi.low !== null &&
    bundle.studyRateCi.high !== null
      ? `${formatStudioRate(bundle.studyRateCi.rate)} (95% Wilson CI [${formatStudioRate(bundle.studyRateCi.low)}, ${formatStudioRate(bundle.studyRateCi.high)}])`
      : "—";

  const funnel = bundle.participationFunnel;
  const completionLine =
    funnel.participationsStarted > 0
      ? `- **Completion funnel:** ${formatStudioRate(funnel.completionRate)} (${funnel.participationsEnded.toLocaleString()} of ${funnel.participationsStarted.toLocaleString()} started runs finished; median run ${formatDurationFromMinutes(funnel.medianRunMinutes)})`
      : `- **Participants active:** ${bundle.exposureBundle.distinctVoters.toLocaleString()} distinct voter${bundle.exposureBundle.distinctVoters === 1 ? "" : "s"} (no session start/end records logged for this study)`;

  const sections: string[] = [
    `# Study #${bundle.study.id} Research Brief — ${escapeMarkdownInline(titleSlug)}`,
    "",
    `- **Study window:** ${startLabel} to ${endLabel}`,
    `- **Exposure denominator:** ${denominatorNote}`,
    `- **Rater quality filter:** ${raterFilterNote}`,
    "",
    "## Summary Metrics",
    "",
    `- **${rateLabel}:** ${studyCiText} across ${bundle.exposureBundle.totalPositive.toLocaleString()} / ${bundle.exposureBundle.totalExposures.toLocaleString()} ${bundle.exposureBundle.exposureUnitLabel}`,
    completionLine,
    `- **Study deck:** ${bundle.mappedCaptionCount.toLocaleString()} mapped caption${bundle.mappedCaptionCount === 1 ? "" : "s"} (${bundle.headToHead.structuralSharedImageCount.toLocaleString()} shared prompt image${bundle.headToHead.structuralSharedImageCount === 1 ? "" : "s"})`,
    bundle.demographics.surveyedVoterCount > 0 &&
    bundle.demographics.surveyedVoterCount < MIN_COHORT_VOTERS
      ? `- **Surveyed voters:** Masked (< ${MIN_COHORT_VOTERS} surveyed across ${bundle.demographics.studyVoterCount.toLocaleString()} study voter${bundle.demographics.studyVoterCount === 1 ? "" : "s"})`
      : bundle.demographics.surveyedVoterCount >= MIN_COHORT_VOTERS &&
          bundle.demographics.studyVoterCount -
            bundle.demographics.surveyedVoterCount >
            0 &&
          bundle.demographics.studyVoterCount -
            bundle.demographics.surveyedVoterCount <
            MIN_COHORT_VOTERS
        ? `- **Surveyed voters:** ≥ ${Math.min(
            bundle.demographics.surveyedVoterCount,
            Math.max(
              MIN_COHORT_VOTERS,
              bundle.demographics.studyVoterCount - (MIN_COHORT_VOTERS - 1),
            ),
          ).toLocaleString()} of ${bundle.demographics.studyVoterCount.toLocaleString()} study voters have demographic responses on file (< ${MIN_COHORT_VOTERS} unsurveyed masked)`
        : `- **Surveyed voters:** ${bundle.demographics.surveyedVoterCount.toLocaleString()} of ${bundle.demographics.studyVoterCount.toLocaleString()} study voters have demographic responses on file`,
    "",
    "## Prompt Flavor Empirical Leaderboard",
    "",
  ];

  if (bundle.leaderboards.flavors.length === 0) {
    sections.push("No captions are mapped to this study.");
  } else {
    const attributedRows = bundle.leaderboards.flavors.filter(
      (row) => !row.isUnattributed,
    );
    const unattributedRows = bundle.leaderboards.flavors.filter(
      (row) => row.isUnattributed,
    );
    const displayRows =
      attributedRows.length <= 10
        ? [...attributedRows, ...unattributedRows]
        : [
            ...attributedRows.slice(0, 5),
            ...attributedRows.slice(-5),
            ...unattributedRows,
          ];

    sections.push(
      "| Prompt Flavor | Terminal Model | Captions | Exposures | Positive Rate (95% CI) | Same-Image Lift | Median Chain |",
      "| --- | --- | ---: | ---: | --- | ---: | ---: |",
      ...displayRows.map(formatLeaderboardBriefRow),
    );
  }

  sections.push("", "## Audience Cohort Taste Gaps (k >= 5 Voters)", "");

  if (bundle.demographics.tasteGaps.length === 0) {
    sections.push(
      "No multi-segment demographic taste gaps meet the k >= 5 distinct-voter privacy threshold in this study.",
    );
  } else {
    const topGaps = bundle.demographics.tasteGaps.slice(0, 5);
    sections.push(
      "| Prompt Flavor | Survey Question | Highest Reception | Lowest Reception | Spread |",
      "| --- | --- | --- | --- | ---: |",
      ...topGaps.map(formatTasteGapBriefRow),
    );
  }

  sections.push("", "## Top Same-Image Wins vs. Flops", "");

  const topPairs = bundle.headToHead.groups
    .filter((group) => group.spreadPp !== null)
    .map((group) => {
      const pair = pickGroupEndpointPair(group);
      if (!pair) {
        return null;
      }
      const pairSpreadPp = Math.max(
        0,
        ((pair.winner.rate ?? 0) - (pair.flop.rate ?? 0)) * 100,
      );
      const isReliable =
        Math.min(pair.winner.exposures, pair.flop.exposures) >=
        MIN_COHORT_VOTERS
          ? 1
          : 0;
      return { group, pair, pairSpreadPp, isReliable };
    })
    .filter(
      (
        entry,
      ): entry is {
        group: SameImageComparisonGroup;
        pair: NonNullable<ReturnType<typeof pickGroupEndpointPair>>;
        pairSpreadPp: number;
        isReliable: number;
      } => entry !== null,
    )
    .sort(
      (a, b) =>
        b.isReliable - a.isReliable ||
        b.pairSpreadPp - a.pairSpreadPp ||
        b.group.totalExposures - a.group.totalExposures ||
        a.group.imageId.localeCompare(b.group.imageId),
    )
    .slice(0, 3);

  if (topPairs.length === 0) {
    sections.push(
      "No evaluated multi-caption prompt images are available in this study.",
    );
  } else {
    topPairs.forEach(({ group, pair, pairSpreadPp }, index) => {
      const promptTitle = escapeMarkdownInline(
        group.imageDescription ?? "Shared prompt image",
      );
      sections.push(
        `### ${index + 1}. ${promptTitle}`,
        "",
        `- **Image baseline:** ${formatStudioRate(group.imageMeanRate)} across ${group.captions.length} captions (top-to-bottom gap: +${pairSpreadPp.toFixed(1)} pp)`,
        `- **Winner (\`${escapeMarkdownInline(pair.winner.flavorSlug)}\` · ${formatStudioRate(pair.winner.rate)}, ${pair.winner.positive}/${pair.winner.exposures} ${bundle.exposureBundle.exposureUnitLabel}):** "${escapeMarkdownInline(pair.winner.captionText)}"`,
        `- **Lowest (\`${escapeMarkdownInline(pair.flop.flavorSlug)}\` · ${formatStudioRate(pair.flop.rate)}, ${pair.flop.positive}/${pair.flop.exposures} ${bundle.exposureBundle.exposureUnitLabel}):** "${escapeMarkdownInline(pair.flop.captionText)}"`,
        "",
      );
    });
  }

  return `${sections.join("\n").trimEnd()}\n`;
}

export function buildStudyExportPayload(
  bundle: StudyAttributionBundle,
): StudyExportPayload {
  return {
    studyId: bundle.study.id,
    pdfFilename: getStudyAttributionPdfFilename(
      bundle.study.id,
      bundle.excludeHighRisk,
    ),
    pdfReport: buildStudyPdfReportData(bundle),
    csvFilename: getStudyAttributionCsvFilename(bundle.study.id),
    csvContent: buildStudyAttributionCsv(bundle),
    briefFilename: getStudyResearchBriefFilename(bundle.study.id),
    briefMarkdown: buildStudyResearchBriefMarkdown(bundle),
  };
}
