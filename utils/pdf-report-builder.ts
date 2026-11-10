import {
  abbreviateSurveyQuestion,
  MIN_COHORT_VOTERS,
  RELIABLE_TASTE_GAP_MIN_VOTERS,
  type AttributionLeaderboardRow,
  type CohortTasteGapRow,
  type SameImageCaptionCardMetric,
  type SameImageComparisonGroup,
} from "@/utils/attribution-stats";
import {
  formatChainSecondsLabel,
  formatDwellDurationLabel,
  formatFriendlyStudyTitle,
  formatRatePercent,
  formatSignedLiftPp,
} from "@/utils/attribution-ui-helpers";
import { formatDurationFromMinutes } from "@/utils/format-duration";
import {
  layoutRichTextRuns,
  normalizeToWinAnsiText,
  PDF_COLORS,
  PDF_CONTENT_RIGHT_X_PT,
  PDF_CONTENT_WIDTH_PT,
  PDF_CONTINUATION_BODY_START_Y_PT,
  PDF_MARGIN_X_PT,
  PDF_MAX_BODY_BOTTOM_Y_PT,
  PDF_RUNNING_HEADER_BASELINE_Y_PT,
  PDF_RUNNING_HEADER_RULE_Y_PT,
  PDF_TOP_MARGIN_PT,
  PdfDocumentBuilder,
  type PdfRichTextBlockLayout,
  type PdfTextAlign,
  type PdfTextRun,
} from "@/utils/pdf-report-engine";
import type { StudyAttributionBundle } from "@/utils/study-lineage-loader";

export type PdfSerializedRunStyle =
  | "regular"
  | "bold"
  | "italic"
  | "boldItalic"
  | "code"
  | "codeBold"
  | "codePositiveBold"
  | "codeNegativeBold"
  | "muted"
  | "mutedItalic"
  | "mutedBoldItalic"
  | "amberBold"
  | "positive"
  | "positiveBold"
  | "negative"
  | "negativeBold";

export interface PdfSerializedTextRun {
  readonly text: string;
  readonly style?: PdfSerializedRunStyle;
  readonly fontSizePt?: number;
}

export interface StudyPdfTableColumnSpec {
  readonly header: string;
  readonly widthPt: number;
  readonly align: PdfTextAlign;
}

export interface StudyPdfTableSpec {
  readonly columns: readonly StudyPdfTableColumnSpec[];
  readonly rows: readonly (readonly (readonly PdfSerializedTextRun[])[])[];
  readonly takeawayRuns: readonly PdfSerializedTextRun[] | null;
}

export interface StudyPdfNoteBoxSpec {
  readonly tone: "warning" | "info";
  readonly runs: readonly PdfSerializedTextRun[];
}

export interface StudyPdfSubBlockSpec {
  readonly leadRuns: readonly PdfSerializedTextRun[];
  readonly table?: StudyPdfTableSpec;
  readonly noteBox?: StudyPdfNoteBoxSpec;
}

export interface StudyPdfSectionSpec {
  readonly numberPrefix: string;
  readonly title: string;
  readonly leadRuns: readonly PdfSerializedTextRun[];
  readonly bullets?: readonly (readonly PdfSerializedTextRun[])[];
  readonly primaryTable?: StudyPdfTableSpec;
  readonly primaryNoteBox?: StudyPdfNoteBoxSpec;
  readonly subBlocks?: readonly StudyPdfSubBlockSpec[];
}

export interface StudyPdfReportData {
  readonly studyId: number;
  readonly shortTitle: string;
  readonly pdfInfoTitle: string;
  readonly pdfInfoSubject: string;
  readonly overlineBadge: string;
  readonly thesisTitle: string;
  readonly bylineRuns: readonly PdfSerializedTextRun[];
  readonly runningHeaderLeft: string;
  readonly excludeHighRisk: boolean;
  readonly isZeroVoteStagingStudy: boolean;
  readonly mappedCaptionCount: number;
  readonly sections: readonly StudyPdfSectionSpec[];
}

export interface PdfReportBuildOptions {
  readonly generatedAtUtc?: Date | string;
}

const MAX_STAGED_PREVIEW_ROWS = 10;
const MAX_TASTE_GAP_ROWS = 8;
const MAX_SHOWDOWN_ROWS = 5;
const PROMPT_DESC_MAX_CHARS = 135;

const TABLE_PAD_X_PT = 6;
const TABLE_PAD_Y_PT = 5.5;
const TABLE_HEADER_FONT_SIZE_PT = 8.5;
const TABLE_HEADER_LINE_HEIGHT_PT = 11.2;
const TABLE_CELL_FONT_SIZE_PT = 8.5;
const TABLE_CELL_LINE_HEIGHT_PT = 11.8;
const TABLE_MAX_CELL_LINES = 18;

const NOTE_BOX_PAD_X_PT = 12;
const NOTE_BOX_PAD_Y_PT = 9;
const NOTE_BOX_ACCENT_WIDTH_PT = 2.5;

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const pluralize = (
  count: number,
  singular: string,
  plural = `${singular}s`,
): string => (count === 1 ? singular : plural);

const pluralizeCount = (
  count: number,
  singular: string,
  plural = `${singular}s`,
): string => `${count.toLocaleString()} ${pluralize(count, singular, plural)}`;

const formatCompactUtcDate = (iso: string | null): string => {
  if (!iso) {
    return "Open";
  }
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return iso;
  }
  const d = new Date(parsed);
  const month = SHORT_MONTHS[d.getUTCMonth()] ?? "Jan";
  return `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

const formatExportedDateShortUtc = (raw?: Date | string): string => {
  const dateObj =
    raw instanceof Date
      ? raw
      : typeof raw === "string"
        ? new Date(raw)
        : new Date();
  const validDate = Number.isFinite(dateObj.getTime()) ? dateObj : new Date(0);
  const month = SHORT_MONTHS[validDate.getUTCMonth()] ?? "Jan";
  return `${month} ${validDate.getUTCDate()}, ${validDate.getUTCFullYear()} UTC`;
};

const unwrapWholeStringQuotes = (input: string): string => {
  const trimmed = input.trim();
  const straightMatch = /^"([^"]*)"$/.exec(trimmed);
  if (straightMatch) {
    return straightMatch[1]!.trim();
  }
  const curlyMatch = /^\u201c([^\u201c\u201d]*)\u201d$/.exec(trimmed);
  if (curlyMatch) {
    return curlyMatch[1]!.trim();
  }
  return trimmed;
};

const convertInternalDoubleQuotesToSingle = (input: string): string => {
  let converted = input
    .replace(/\u201c/g, "\u2018")
    .replace(/\u201d/g, "\u2019");
  let open = true;
  converted = converted.replace(/"/g, () => {
    const mark = open ? "\u2018" : "\u2019";
    open = !open;
    return mark;
  });
  return converted;
};

const sanitizeQuotedCaption = (rawText: string | null | undefined): string => {
  const unwrapped = unwrapWholeStringQuotes(rawText ?? "");
  if (unwrapped.length === 0) {
    return "\u2014";
  }
  const normalized = unwrapWholeStringQuotes(normalizeToWinAnsiText(unwrapped));
  if (normalized.length === 0) {
    return "\u201c[Emoji-only caption]\u201d";
  }
  const nestedClean = convertInternalDoubleQuotesToSingle(normalized);
  return `\u201c${nestedClean}\u201d`;
};

const straightDoubleQuotesToCurly = (input: string): string => {
  let open = true;
  return input.replace(/"/g, () => {
    const mark = open ? "\u201c" : "\u201d";
    open = !open;
    return mark;
  });
};

const concisePromptDescription = (rawDesc: string | null | undefined): string => {
  const unstarred = (rawDesc?.trim() ?? "").replace(/\*+([^*]+)\*+/g, "$1");
  const cleaned = straightDoubleQuotesToCurly(normalizeToWinAnsiText(unstarred));
  if (cleaned.length === 0) {
    return "Shared study prompt image";
  }
  if (cleaned.length <= PROMPT_DESC_MAX_CHARS) {
    return cleaned;
  }
  const sliced = cleaned.slice(0, PROMPT_DESC_MAX_CHARS);
  const lastSpace = sliced.lastIndexOf(" ");
  let cut = (lastSpace >= 60 ? sliced.slice(0, lastSpace) : sliced).replace(
    /[\s,;:._/-]+$/,
    "",
  );
  // Close an unclosed curly quote if truncation sliced mid-quotation.
  const openCount = (cut.match(/\u201c/g) ?? []).length;
  const closeCount = (cut.match(/\u201d/g) ?? []).length;
  if (openCount > closeCount) {
    cut = `${cut}\u201d`;
  }
  return `${cut}\u2026`;
};

const pickShowdownEndpointPair = (
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
  if (!winner) {
    return null;
  }
  const crossFlavorFlop = [...evaluated]
    .reverse()
    .find((card) => card.flavorKey !== winner.flavorKey);
  const flop = crossFlavorFlop ?? evaluated[evaluated.length - 1];
  if (!flop || flop.captionId === winner.captionId) {
    return null;
  }
  return { winner, flop };
};

const r = (
  text: string,
  style: PdfSerializedRunStyle = "regular",
  fontSizePt?: number,
): PdfSerializedTextRun =>
  fontSizePt === undefined ? { text, style } : { text, style, fontSizePt };

const takeawayLine = (sentence: string): readonly PdfSerializedTextRun[] => [
  r("Takeaway: ", "mutedBoldItalic", 9),
  r(sentence, "mutedItalic", 9),
];

const buildFlavorEvidenceTable = (
  rows: readonly AttributionLeaderboardRow[],
  exposureUnitLabel: string,
  totalExposures: number,
): StudyPdfTableSpec => {
  const columns: readonly StudyPdfTableColumnSpec[] = [
    { header: "Prompt flavor", widthPt: 160, align: "left" },
    { header: "Synthesis\nmodel", widthPt: 78, align: "left" },
    { header: "Captions", widthPt: 50, align: "right" },
    { header: "Sample", widthPt: 76, align: "right" },
    { header: "Positive rate\n(95% CI)", widthPt: 72, align: "right" },
    { header: "Same-image\nlift", widthPt: 64, align: "right" },
  ];

  let rank = 0;
  const tableRows = rows.map((row) => {
    if (!row.isUnattributed) {
      rank += 1;
    }

    const flavorCell: PdfSerializedTextRun[] = row.isUnattributed
      ? [
          r("Unattributed / manual", "bold", 8.5),
          r("\nNo linked prompt chain", "muted", 7.5),
        ]
      : [
          r(`${rank}. `, "bold", 8.5),
          r(row.label, "codeBold", 8),
          r(
            `\n${
              row.stepCount !== null && row.stepCount > 0
                ? `${row.stepCount}-step chain`
                : "Metadata-linked flavor"
            }`,
            "muted",
            7.5,
          ),
        ];

    const modelCell: PdfSerializedTextRun[] = [
      r(
        row.dominantModelLabel ??
          (row.isUnattributed ? "Unattributed" : "\u2014"),
        row.dominantModelLabel ? "regular" : "muted",
        8.5,
      ),
    ];

    const captionsCell: PdfSerializedTextRun[] = [
      r(row.captionCount.toLocaleString(), "regular", 8.5),
    ];

    const sampleCell: PdfSerializedTextRun[] = [
      r(
        `${row.positive.toLocaleString()} / ${row.exposures.toLocaleString()}`,
        "regular",
        8.5,
      ),
      r(`\n${exposureUnitLabel}`, "muted", 7.5),
    ];

    const rateCell: PdfSerializedTextRun[] =
      row.rate !== null && row.ciLow !== null && row.ciHigh !== null
        ? [
            r(formatRatePercent(row.rate), "bold", 8.5),
            r(
              `\n[${formatRatePercent(row.ciLow)}, ${formatRatePercent(row.ciHigh)}]`,
              "muted",
              7.5,
            ),
          ]
        : [r(formatRatePercent(row.rate), "muted", 8.5)];

    let liftCell: PdfSerializedTextRun[];
    if (row.meanLiftPp !== null && row.sharedImageCount > 0) {
      const roundedLift = Number(row.meanLiftPp.toFixed(1));
      const liftStyle: PdfSerializedRunStyle =
        roundedLift > 0
          ? "positiveBold"
          : roundedLift < 0
            ? "negativeBold"
            : "bold";
      liftCell = [
        r(formatSignedLiftPp(row.meanLiftPp), liftStyle, 8.5),
        r(`\n${pluralizeCount(row.sharedImageCount, "prompt")}`, "muted", 7.5),
      ];
    } else {
      liftCell = [r("\u2014", "muted", 8.5)];
    }

    return [flavorCell, modelCell, captionsCell, sampleCell, rateCell, liftCell];
  });

  const evaluated = rows.filter((row) => !row.isUnattributed && row.exposures > 0);
  let takeawayText: string;
  if (evaluated.length >= 2) {
    const top = evaluated[0]!;
    const bottom = evaluated[evaluated.length - 1]!;
    const spreadPp =
      top.rate !== null && bottom.rate !== null
        ? Math.max(0, (top.rate - bottom.rate) * 100)
        : 0;
    const ciSeparated =
      top.ciLow !== null && bottom.ciHigh !== null && top.ciLow > bottom.ciHigh;
    const liftNote =
      top.meanLiftPp !== null && top.sharedImageCount > 0
        ? `, reinforced by ${formatSignedLiftPp(top.meanLiftPp)} mean-centered lift across ${pluralizeCount(top.sharedImageCount, "shared prompt")}`
        : "";
    takeawayText = `${top.label} outpaces ${bottom.label} by ${spreadPp.toFixed(1)} pp (${formatRatePercent(top.rate)} vs. ${formatRatePercent(bottom.rate)}) with ${ciSeparated ? "non-overlapping" : "overlapping"} 95% Wilson intervals${liftNote}.`;
  } else if (evaluated.length === 1) {
    const only = evaluated[0]!;
    takeawayText = `Single attributed flavor in this study; ${only.label} accounts for ${only.exposures.toLocaleString()} of ${totalExposures.toLocaleString()} ${exposureUnitLabel} at ${formatRatePercent(only.rate)} positive reception (95% CI [${formatRatePercent(only.ciLow)}, ${formatRatePercent(only.ciHigh)}]).`;
  } else {
    takeawayText = `Captions in this deck do not carry prompt-flavor foreign keys; all ${totalExposures.toLocaleString()} ${exposureUnitLabel} reconcile under the unattributed row.`;
  }

  return {
    columns,
    rows: tableRows,
    takeawayRuns: takeawayLine(takeawayText),
  };
};

const buildModelEvidenceTable = (
  rows: readonly AttributionLeaderboardRow[],
  exposureUnitLabel: string,
): StudyPdfTableSpec => {
  const columns: readonly StudyPdfTableColumnSpec[] = [
    { header: "Synthesis model", widthPt: 176, align: "left" },
    { header: "Flavors", widthPt: 46, align: "right" },
    { header: "Captions", widthPt: 52, align: "right" },
    { header: "Sample", widthPt: 78, align: "right" },
    { header: "Positive rate\n(95% CI)", widthPt: 88, align: "right" },
    { header: "Median\nchain", widthPt: 60, align: "right" },
  ];

  const tableRows = rows.map((row) => {
    const modelCell: PdfSerializedTextRun[] = [
      r(row.label, "bold", 8.5),
      ...(row.subtitle ? [r(`\n${row.subtitle}`, "muted", 7.5)] : []),
    ];
    const flavorsCell = [r(row.flavorCount.toLocaleString(), "regular", 8.5)];
    const captionsCell = [r(row.captionCount.toLocaleString(), "regular", 8.5)];
    const sampleCell = [
      r(
        `${row.positive.toLocaleString()} / ${row.exposures.toLocaleString()}`,
        "regular",
        8.5,
      ),
    ];
    const rateCell: PdfSerializedTextRun[] =
      row.rate !== null && row.ciLow !== null && row.ciHigh !== null
        ? [
            r(formatRatePercent(row.rate), "bold", 8.5),
            r(
              `\n[${formatRatePercent(row.ciLow)}, ${formatRatePercent(row.ciHigh)}]`,
              "muted",
              7.5,
            ),
          ]
        : [r(formatRatePercent(row.rate), "muted", 8.5)];
    const chainCell = [
      r(
        formatChainSecondsLabel(row.medianChainSeconds),
        row.medianChainSeconds !== null ? "regular" : "muted",
        8.5,
      ),
    ];

    return [
      modelCell,
      flavorsCell,
      captionsCell,
      sampleCell,
      rateCell,
      chainCell,
    ];
  });

  const attributedModels = rows.filter(
    (row) => !row.isUnattributed && row.exposures > 0,
  );
  let takeawayText: string;
  if (attributedModels.length >= 2) {
    const top = attributedModels[0]!;
    const runnerUp = attributedModels[1]!;
    const deltaPp =
      top.rate !== null && runnerUp.rate !== null
        ? ((top.rate - runnerUp.rate) * 100).toFixed(1)
        : "0.0";
    const latencyClause =
      top.medianChainSeconds !== null
        ? ` at ${formatChainSecondsLabel(top.medianChainSeconds)} median generation latency`
        : "";
    takeawayText = `${top.label} leads ${runnerUp.label} by ${deltaPp} pp (${formatRatePercent(top.rate)} vs. ${formatRatePercent(runnerUp.rate)} across ${top.exposures.toLocaleString()} and ${runnerUp.exposures.toLocaleString()} ${exposureUnitLabel})${latencyClause}.`;
  } else if (attributedModels.length === 1) {
    const only = attributedModels[0]!;
    const chainNote =
      only.medianChainSeconds !== null
        ? ` with a median prompt-chain runtime of ${formatChainSecondsLabel(only.medianChainSeconds)}`
        : "";
    takeawayText = `${only.label} synthesized all attributed captions in this study, recording ${formatRatePercent(only.rate)} positive reception across ${only.exposures.toLocaleString()} ${exposureUnitLabel}${chainNote}.`;
  } else {
    takeawayText =
      "No terminal LLM model lineage records are linked to evaluated captions in this study.";
  }

  return {
    columns,
    rows: tableRows,
    takeawayRuns: takeawayLine(takeawayText),
  };
};

/**
 * Distills a server-loaded `StudyAttributionBundle` into a compact, JSON-serializable
 * written-report view-model ready for client-side pure-vector `%PDF-1.4` compilation.
 */
export function buildStudyPdfReportData(
  bundle: StudyAttributionBundle,
  options?: PdfReportBuildOptions,
): StudyPdfReportData {
  const studyId = bundle.study.id;
  const shortTitle = formatFriendlyStudyTitle(bundle.study);
  const exportDateShortUtc = formatExportedDateShortUtc(options?.generatedAtUtc);

  const isSwipe = bundle.exposureBundle.mode === "swipe_navigation";
  const formatBaseLabel = isSwipe ? "Swipe" : "Rating scale";
  const formatBylineLabel = bundle.exposureBundle.isTransitionalLikert
    ? `${formatBaseLabel} (transitional Likert)`
    : formatBaseLabel;

  const startLabel = formatCompactUtcDate(
    bundle.study.start_datetime_utc ?? bundle.study.created_datetime_utc,
  );
  const endLabel = formatCompactUtcDate(bundle.study.end_datetime_utc);
  const windowRange = `${startLabel} \u2013 ${endLabel}`;

  const totalExposures = bundle.exposureBundle.totalExposures;
  const totalPositive = bundle.exposureBundle.totalPositive;
  const distinctVoters = bundle.exposureBundle.distinctVoters;
  const unit = bundle.exposureBundle.exposureUnitLabel;
  const mappedCaptionCount = bundle.mappedCaptionCount;
  const isZeroVoteStagingStudy = mappedCaptionCount > 0 && totalExposures === 0;

  const excludedVoterCount = bundle.exposureBundle.excludedVoterCount;
  const excludedExposureCount = bundle.exposureBundle.excludedExposureCount;
  const highRiskVoterCount = bundle.exposureBundle.highRiskVoterCount;

  const attributedFlavors = bundle.leaderboards.flavors.filter(
    (row) => !row.isUnattributed,
  );
  const evaluatedFlavors = attributedFlavors.filter((row) => row.exposures > 0);
  const attributedModels = bundle.leaderboards.models.filter(
    (row) => !row.isUnattributed,
  );
  const evaluatedModels = attributedModels.filter((row) => row.exposures > 0);

  const topFlavor = evaluatedFlavors[0] ?? attributedFlavors[0] ?? null;
  const bottomFlavor =
    evaluatedFlavors.length >= 2
      ? evaluatedFlavors[evaluatedFlavors.length - 1]!
      : null;
  const topModel = evaluatedModels[0] ?? attributedModels[0] ?? null;

  let overlineBadge = `EMPIRICAL STUDY REPORT  \u00b7  STUDY #${studyId}`;
  if (isZeroVoteStagingStudy) {
    overlineBadge = `EMPIRICAL STUDY REPORT  \u00b7  STUDY #${studyId}  \u00b7  STAGING DECK`;
  } else if (bundle.excludeHighRisk) {
    overlineBadge = `EMPIRICAL STUDY REPORT  \u00b7  STUDY #${studyId}  \u00b7  RUSHED RATERS EXCLUDED`;
  }

  let thesisTitle: string;
  if (mappedCaptionCount === 0) {
    thesisTitle = `Study #${studyId} (${shortTitle}): Study deck awaiting caption assignment`;
  } else if (isZeroVoteStagingStudy) {
    const flavorCountForStaging = Math.max(1, attributedFlavors.length);
    thesisTitle = `Study #${studyId} (${shortTitle}): ${pluralizeCount(mappedCaptionCount, "caption")} staged across ${pluralizeCount(flavorCountForStaging, "prompt flavor")}`;
  } else if (evaluatedFlavors.length >= 2 && topFlavor != null) {
    thesisTitle = `Study #${studyId} (${shortTitle}): ${topFlavor.label} leads ${evaluatedFlavors.length.toLocaleString()} prompt flavors at ${formatRatePercent(topFlavor.rate)} positive reception`;
  } else if (evaluatedFlavors.length === 1 && topFlavor != null) {
    thesisTitle = `Study #${studyId} (${shortTitle}): ${topFlavor.label} reaches ${formatRatePercent(bundle.studyRateCi.rate)} positive reception across ${totalExposures.toLocaleString()} ${unit}`;
  } else {
    thesisTitle = `Study #${studyId} (${shortTitle}): ${formatRatePercent(bundle.studyRateCi.rate)} positive reception across ${totalExposures.toLocaleString()} ${unit}`;
  }

  const sep = "  \u00b7  ";
  const sampleSegment = isZeroVoteStagingStudy
    ? "Sample: 0 recorded evaluations"
    : `Sample: ${pluralizeCount(distinctVoters, "voter")}, ${totalExposures.toLocaleString()} ${unit}`;

  const bylineRuns: PdfSerializedTextRun[] = [
    r(
      `Window: ${windowRange}${sep}Format: ${formatBylineLabel}${sep}${sampleSegment}${sep}Deck: ${pluralizeCount(mappedCaptionCount, "caption")}${sep}Rater filter: `,
      "muted",
      9,
    ),
    ...(bundle.excludeHighRisk
      ? [
          r(
            `${pluralizeCount(excludedVoterCount, "rushed rater")} excluded`,
            "amberBold",
            9,
          ),
        ]
      : [
          r(
            `All raters included${highRiskVoterCount > 0 ? ` (${highRiskVoterCount.toLocaleString()} high-risk flagged)` : ""}`,
            "muted",
            9,
          ),
        ]),
    r(`${sep}Exported ${exportDateShortUtc}`, "muted", 9),
  ];

  const runningHeaderLeft = `Study #${studyId} (${shortTitle})  \u00b7  Empirical Attribution Report${
    bundle.excludeHighRisk ? "  \u00b7  Rushed raters excluded" : ""
  }`;

  const pdfInfoTitle = `Study #${studyId} Empirical Attribution Report \u2014 ${shortTitle}`;
  const pdfInfoSubject = `Empirical prompt flavor, synthesis model, and k >= ${MIN_COHORT_VOTERS} audience cohort report for Study #${studyId}.`;

  // Empty study fallback (0 mapped captions).
  if (mappedCaptionCount === 0) {
    return {
      studyId,
      shortTitle,
      pdfInfoTitle,
      pdfInfoSubject,
      overlineBadge,
      thesisTitle,
      bylineRuns,
      runningHeaderLeft,
      excludeHighRisk: bundle.excludeHighRisk,
      isZeroVoteStagingStudy: false,
      mappedCaptionCount: 0,
      sections: [
        {
          numberPrefix: "01",
          title: "Study scope & headline findings",
          leadRuns: [
            r(
              `Study #${studyId} (${shortTitle}) currently has 0 captions mapped to its deck and 0 recorded participant evaluations.`,
            ),
          ],
          primaryNoteBox: {
            tone: "info",
            runs: [
              r("Study deck awaiting caption assignment. ", "bold", 9),
              r(
                "Assign prompt-flavor captions to this study before collecting participant evaluations or computing flavor, model, and cohort attribution tables.",
                "regular",
                9,
              ),
            ],
          },
        },
      ],
    };
  }

  // Zero-vote staging study 2-section written report flow (Spec §4.6).
  if (isZeroVoteStagingStudy) {
    const sharedPrompts = bundle.headToHead.structuralSharedImageCount;
    const flavorSummaryText =
      attributedFlavors.length > 0
        ? `${pluralizeCount(attributedFlavors.length, "prompt flavor")} (${attributedFlavors.map((f) => f.label).slice(0, 3).join(", ")}${attributedFlavors.length > 3 ? ", \u2026" : ""})`
        : "manual / unlinked caption entries";

    const configColumns: readonly StudyPdfTableColumnSpec[] = [
      { header: "Prompt flavor", widthPt: 190, align: "left" },
      { header: "Synthesis model", widthPt: 140, align: "left" },
      { header: "Staged captions", widthPt: 85, align: "right" },
      { header: "Chain depth", widthPt: 85, align: "right" },
    ];
    const configRows = bundle.leaderboards.flavors.map((row) => [
      row.isUnattributed
        ? [r("Unattributed / manual", "bold", 8.5)]
        : [r(row.label, "codeBold", 8)],
      [
        r(
          row.dominantModelLabel ??
            (row.isUnattributed ? "Unattributed" : "\u2014"),
          row.dominantModelLabel ? "regular" : "muted",
          8.5,
        ),
      ],
      [r(row.captionCount.toLocaleString(), "bold", 8.5)],
      [
        r(
          row.stepCount !== null && row.stepCount > 0
            ? `${row.stepCount}-step chain`
            : "\u2014",
          row.stepCount !== null && row.stepCount > 0 ? "regular" : "muted",
          8.5,
        ),
      ],
    ]);

    const rawSamples =
      bundle.captionMetrics && bundle.captionMetrics.length > 0
        ? bundle.captionMetrics.slice(0, MAX_STAGED_PREVIEW_ROWS).map((item) => ({
            flavorSlug: item.flavorSlug || "Unattributed / manual",
            modelLabel: item.modelName || "\u2014",
            captionText: sanitizeQuotedCaption(item.captionText),
          }))
        : Array.from(bundle.captionsById.values())
            .slice(0, MAX_STAGED_PREVIEW_ROWS)
            .map((info) => ({
              flavorSlug: info.flavorSlug ?? "Unattributed / manual",
              modelLabel: info.terminalModelName ?? "\u2014",
              captionText: sanitizeQuotedCaption(info.content),
            }));

    const sampleColumns: readonly StudyPdfTableColumnSpec[] = [
      { header: "#", widthPt: 28, align: "right" },
      { header: "Prompt flavor & model", widthPt: 152, align: "left" },
      { header: "Staged caption copy", widthPt: 320, align: "left" },
    ];
    const sampleRows = rawSamples.map((sample, idx) => [
      [r(String(idx + 1), "muted", 8.5)],
      [
        r(
          sample.flavorSlug,
          sample.flavorSlug === "Unattributed / manual" ? "bold" : "codeBold",
          8,
        ),
        r(`\n${sample.modelLabel}`, "muted", 7.5),
      ],
      [r(sample.captionText, "italic", 8.5)],
    ]);

    return {
      studyId,
      shortTitle,
      pdfInfoTitle,
      pdfInfoSubject,
      overlineBadge,
      thesisTitle,
      bylineRuns,
      runningHeaderLeft,
      excludeHighRisk: bundle.excludeHighRisk,
      isZeroVoteStagingStudy: true,
      mappedCaptionCount,
      sections: [
        {
          numberPrefix: "01",
          title: "Study scope & staging status",
          leadRuns: [
            r(`Study #${studyId} (${shortTitle}) stages `),
            r(pluralizeCount(mappedCaptionCount, "caption"), "bold"),
            r(` across ${flavorSummaryText}, with `),
            r("0 participant evaluations", "bold"),
            r(
              " recorded to date. Empirical reception rates, Wilson confidence intervals, and audience cohort tables populate automatically once rating sessions begin.",
            ),
          ],
          bullets: [
            [
              r("Deck composition. ", "bold"),
              r(
                `${pluralizeCount(mappedCaptionCount, "caption")} mapped across ${pluralizeCount(sharedPrompts, "shared prompt image")} in ${formatBylineLabel.toLowerCase()} format.`,
              ),
            ],
            [
              r("Configured lineage. ", "bold"),
              ...(topFlavor
                ? [
                    r("Primary flavor "),
                    r(topFlavor.label, "code", 9),
                    r(
                      `${topModel ? ` synthesized by ${topModel.label}` : ""} (${pluralizeCount(topFlavor.captionCount, "staged caption")}).`,
                    ),
                  ]
                : [
                    r(
                      `All ${pluralizeCount(mappedCaptionCount, "caption")} are staged without linked prompt-flavor lineage keys.`,
                    ),
                  ]),
            ],
            [
              r("Visibility and schedule. ", "bold"),
              r(
                `${bundle.study.is_private ? "Private staging study" : "Public study deck"} scheduled for ${windowRange}.`,
              ),
            ],
          ],
        },
        {
          numberPrefix: "02",
          title: "Staged flavor configuration & sample captions",
          leadRuns: [
            r(
              "The configuration table below summarizes the staged prompt-flavor allocation prior to participant exposure.",
            ),
          ],
          primaryTable: {
            columns: configColumns,
            rows: configRows,
            takeawayRuns: null,
          },
          subBlocks:
            sampleRows.length > 0
              ? [
                  {
                    leadRuns: [
                      r(
                        `Representative sample of ${sampleRows.length.toLocaleString()} of ${pluralizeCount(mappedCaptionCount, "staged caption")} currently loaded in the study deck.`,
                      ),
                    ],
                    table: {
                      columns: sampleColumns,
                      rows: sampleRows,
                      takeawayRuns: takeawayLine(
                        `Deck verification complete for ${pluralizeCount(mappedCaptionCount, "staged caption")}; empirical leaderboards unlock once participant votes arrive.`,
                      ),
                    },
                  },
                ]
              : undefined,
        },
      ],
    };
  }

  // Scored study 4-section written research report (Spec §4.2 – §4.5).
  const studyRateLabel = formatRatePercent(bundle.studyRateCi.rate);
  const studyCiLowLabel = formatRatePercent(bundle.studyRateCi.low);
  const studyCiHighLabel = formatRatePercent(bundle.studyRateCi.high);
  const positiveDefinition = isSwipe
    ? "swipe-right likes divided by distinct voter-card exposures"
    : "\u201cfunny\u201d and \u201cvery funny\u201d ratings divided by recorded votes";

  const section1Lead: PdfSerializedTextRun[] = [
    r(
      `Study #${studyId} evaluated ${pluralizeCount(mappedCaptionCount, "caption")}${
        evaluatedFlavors.length > 0
          ? ` across ${pluralizeCount(evaluatedFlavors.length, "prompt flavor")}`
          : ""
      } with ${pluralizeCount(distinctVoters, "distinct voter")} (${totalExposures.toLocaleString()} ${unit}). Positive reception measures ${positiveDefinition} and reached `,
    ),
    r(studyRateLabel, "bold"),
    r(` overall (95% Wilson CI [${studyCiLowLabel}, ${studyCiHighLabel}]). `),
  ];

  if (evaluatedFlavors.length >= 2 && topFlavor != null && bottomFlavor != null) {
    const gapPp =
      topFlavor.rate !== null && bottomFlavor.rate !== null
        ? Math.max(0, (topFlavor.rate - bottomFlavor.rate) * 100).toFixed(1)
        : "0.0";
    section1Lead.push(
      r("Prompt flavor "),
      r(topFlavor.label, "code", 9),
      r(" led the study at "),
      r(formatRatePercent(topFlavor.rate), "bold"),
      ...(topFlavor.meanLiftPp !== null && topFlavor.sharedImageCount > 0
        ? [
            r(" ("),
            r(formatSignedLiftPp(topFlavor.meanLiftPp), "bold"),
            r(" same-image lift)"),
          ]
        : []),
      r(`, ${gapPp} pp ahead of lowest-scoring `),
      r(bottomFlavor.label, "code", 9),
      r(` (${formatRatePercent(bottomFlavor.rate)}).`),
    );
  } else if (evaluatedFlavors.length === 1 && topFlavor != null) {
    section1Lead.push(
      r("Single evaluated flavor "),
      r(topFlavor.label, "code", 9),
      ...(topModel ? [r(` (synthesized by ${topModel.label})`)] : []),
      r(" generated the attributed deck across "),
      r(
        pluralizeCount(
          bundle.headToHead.structuralSharedImageCount,
          "shared prompt image",
        ),
      ),
      r("."),
    );
  } else {
    section1Lead.push(
      r(
        "Captions in this deck were uploaded without prompt-chain foreign keys and reconcile under the unattributed baseline.",
      ),
    );
  }

  const avgPerVoter =
    distinctVoters > 0 ? Math.round(totalExposures / distinctVoters) : 0;
  const dwellSuffix =
    bundle.exposureBundle.medianStudyDwellMs !== null
      ? `, with a median per-card dwell of ${formatDwellDurationLabel(bundle.exposureBundle.medianStudyDwellMs)}`
      : "";

  const bullet1: PdfSerializedTextRun[] = [
    r("Overall reception and confidence bounds. ", "bold"),
    r(
      `${totalPositive.toLocaleString()} positive evaluations out of ${totalExposures.toLocaleString()} ${unit} (`,
    ),
    r(studyRateLabel, "bold"),
    r(
      `, 95% Wilson CI [${studyCiLowLabel}, ${studyCiHighLabel}]), averaging ${avgPerVoter.toLocaleString()} ${unit} per voter${dwellSuffix}.`,
    ),
  ];

  const funnel = bundle.participationFunnel;
  const bullet2: PdfSerializedTextRun[] =
    funnel.participationsStarted > 0
      ? [
          r("Participant completion funnel. ", "bold"),
          r(
            `${funnel.participationsEnded.toLocaleString()} of ${funnel.participationsStarted.toLocaleString()} started sessions finished (`,
          ),
          r(formatRatePercent(funnel.completionRate), "bold"),
          r(
            `), with a median session duration of ${formatDurationFromMinutes(funnel.medianRunMinutes)}.`,
          ),
        ]
      : [
          r("Participant completion funnel. ", "bold"),
          r(
            `${pluralizeCount(distinctVoters, "distinct rater")} evaluated the ${mappedCaptionCount.toLocaleString()}-caption deck (${pluralizeCount(bundle.headToHead.structuralSharedImageCount, "shared prompt image")}; session start/end timestamps were not logged in this study era).`,
          ),
        ];

  let bullet3: PdfSerializedTextRun[];
  if (evaluatedFlavors.length >= 2 && topFlavor != null && bottomFlavor != null) {
    bullet3 = [
      r("Prompt flavor and model leadership. ", "bold"),
      r(topFlavor.label, "code", 9),
      r(" ranked first at "),
      r(formatRatePercent(topFlavor.rate), "bold"),
      r(
        topFlavor.meanLiftPp !== null && topFlavor.sharedImageCount > 0
          ? ` (${formatSignedLiftPp(topFlavor.meanLiftPp)} same-image lift across ${pluralizeCount(topFlavor.sharedImageCount, "prompt")}), vs. `
          : ", vs. ",
      ),
      r(bottomFlavor.label, "code", 9),
      r(` at ${formatRatePercent(bottomFlavor.rate)}.`),
      ...(topModel
        ? [
            r(" Top synthesis model: "),
            r(topModel.label, "bold"),
            r(
              ` at ${formatRatePercent(topModel.rate)}${
                topModel.medianChainSeconds !== null
                  ? ` (${formatChainSecondsLabel(topModel.medianChainSeconds)} median chain)`
                  : ""
              }.`,
            ),
          ]
        : []),
    ];
  } else if (evaluatedFlavors.length === 1 && topFlavor != null) {
    const chainDepth =
      topFlavor.stepCount !== null && topFlavor.stepCount > 0
        ? ` via a ${topFlavor.stepCount}-step prompt chain`
        : "";
    const modelClause = topModel
      ? ` synthesized by ${topModel.label}${
          topModel.medianChainSeconds !== null
            ? ` (${formatChainSecondsLabel(topModel.medianChainSeconds)} median chain)`
            : ""
        }`
      : "";
    bullet3 = [
      r("Prompt flavor and model attribution. ", "bold"),
      r(topFlavor.label, "code", 9),
      r(
        ` produced ${pluralizeCount(topFlavor.captionCount, "caption")}${chainDepth}${modelClause}, scoring `,
      ),
      r(formatRatePercent(topFlavor.rate), "bold"),
      r(` across ${topFlavor.exposures.toLocaleString()} ${unit}.`),
    ];
  } else {
    bullet3 = [
      r("Prompt flavor and model attribution. ", "bold"),
      r(
        `All ${pluralizeCount(mappedCaptionCount, "caption")} in this study are unlinked to prompt-chain records and are accounted for in the unattributed reconciliation row.`,
      ),
    ];
  }

  const surveyedVoters = bundle.demographics.surveyedVoterCount;
  const studyVoters = bundle.demographics.studyVoterCount;
  const raterClause = bundle.excludeHighRisk
    ? `Excluding ${pluralizeCount(excludedVoterCount, "rushed high-risk rater")} removed ${excludedExposureCount.toLocaleString()} rapid or uniform ${unit}. `
    : `All recorded raters are included (${
        highRiskVoterCount > 0
          ? `${pluralizeCount(highRiskVoterCount, "high-risk rater")} flagged for rapid or uniform pacing`
          : "0 high-risk raters flagged"
      }). `;

  const unsurveyedVoters = studyVoters - surveyedVoters;
  const hasSmallUnsurveyed =
    surveyedVoters >= MIN_COHORT_VOTERS &&
    unsurveyedVoters > 0 &&
    unsurveyedVoters < MIN_COHORT_VOTERS;
  const coarsenedSurveyedFloor = Math.min(
    surveyedVoters,
    Math.max(MIN_COHORT_VOTERS, studyVoters - (MIN_COHORT_VOTERS - 1)),
  );

  const surveyCoverageClause =
    surveyedVoters > 0 && surveyedVoters < MIN_COHORT_VOTERS
      ? `Surveyed voter headcount is masked below k >= ${MIN_COHORT_VOTERS} across ${pluralizeCount(studyVoters, "study voter")}.`
      : hasSmallUnsurveyed
        ? `At least ${coarsenedSurveyedFloor.toLocaleString()} of ${studyVoters.toLocaleString()} study voters have demographic responses on file (< ${MIN_COHORT_VOTERS} unsurveyed masked; cohort segments require k >= ${MIN_COHORT_VOTERS} distinct voters).`
        : `${surveyedVoters.toLocaleString()} of ${studyVoters.toLocaleString()} study voters have demographic responses on file (cohort segments require k >= ${MIN_COHORT_VOTERS} distinct voters).`;

  const bullet4: PdfSerializedTextRun[] = [
    r("Rater quality and survey coverage. ", "bold"),
    r(`${raterClause}${surveyCoverageClause}`),
  ];

  // Section 02: Flavor & Model Attribution
  const flavorTable = buildFlavorEvidenceTable(
    bundle.leaderboards.flavors,
    unit,
    totalExposures,
  );
  const modelSubBlocks: StudyPdfSubBlockSpec[] =
    bundle.leaderboards.models.length > 0
      ? [
          {
            leadRuns: [
              r(
                `Grouping the same ${totalExposures.toLocaleString()} ${unit} by terminal synthesis model isolates model-level reception and end-to-end prompt-chain runtime.`,
              ),
            ],
            table: buildModelEvidenceTable(bundle.leaderboards.models, unit),
          },
        ]
      : [];

  // Section 03: Audience Cohort Reception (k >= 5 Voters)
  const safeGaps: CohortTasteGapRow[] =
    surveyedVoters >= MIN_COHORT_VOTERS
      ? [...bundle.demographics.tasteGaps]
          .filter(
            (gap) =>
              gap.highVoters >= MIN_COHORT_VOTERS &&
              gap.lowVoters >= MIN_COHORT_VOTERS,
          )
          .sort((a, b) => b.spreadPp - a.spreadPp)
          .slice(0, MAX_TASTE_GAP_ROWS)
      : [];

  let section3Lead: PdfSerializedTextRun[];
  if (surveyedVoters === 0) {
    section3Lead = [
      r(
        `None of the ${pluralizeCount(studyVoters, "voter")} in Study #${studyId} have linked demographic survey responses on file. Every audience breakdown enforces a minimum floor of k >= ${MIN_COHORT_VOTERS} distinct voters per segment.`,
      ),
    ];
  } else if (surveyedVoters < MIN_COHORT_VOTERS) {
    section3Lead = [
      r(
        `Surveyed respondent count is masked below k >= ${MIN_COHORT_VOTERS} across ${pluralizeCount(studyVoters, "study voter")} to prevent small-cohort re-identification.`,
      ),
    ];
  } else if (hasSmallUnsurveyed) {
    const floorPct =
      studyVoters > 0
        ? ((coarsenedSurveyedFloor / studyVoters) * 100).toFixed(1)
        : "0.0";
    section3Lead = [
      r(
        `Demographic profiles link to at least ${coarsenedSurveyedFloor.toLocaleString()} of ${studyVoters.toLocaleString()} study voters (>= ${floorPct}%, < ${MIN_COHORT_VOTERS} unsurveyed masked), yielding ${pluralizeCount(bundle.demographics.totalVisibleSegments, "privacy-cleared segment")} at k >= ${MIN_COHORT_VOTERS} distinct voters and pooling or masking ${pluralizeCount(bundle.demographics.totalMaskedSegments, "smaller segment")}.`,
      ),
    ];
  } else {
    const coveragePct =
      studyVoters > 0 ? ((surveyedVoters / studyVoters) * 100).toFixed(1) : "0.0";
    section3Lead = [
      r(
        `Demographic profiles link to ${surveyedVoters.toLocaleString()} of ${studyVoters.toLocaleString()} study voters (${coveragePct}%), yielding ${pluralizeCount(bundle.demographics.totalVisibleSegments, "privacy-cleared segment")} at k >= ${MIN_COHORT_VOTERS} distinct voters and pooling or masking ${pluralizeCount(bundle.demographics.totalMaskedSegments, "smaller segment")}.`,
      ),
    ];
  }

  let section3Table: StudyPdfTableSpec | undefined;
  let section3Note: StudyPdfNoteBoxSpec | undefined;
  if (safeGaps.length > 0) {
    const gapColumns: readonly StudyPdfTableColumnSpec[] = [
      { header: "Survey dimension", widthPt: 116, align: "left" },
      { header: "Prompt flavor", widthPt: 116, align: "left" },
      { header: "Highest-reception cohort", widthPt: 108, align: "left" },
      { header: "Lowest-reception cohort", widthPt: 108, align: "left" },
      { header: "Spread", widthPt: 52, align: "right" },
    ];
    const gapRows = safeGaps.map((gap) => {
      const highSampleLabel = gap.coarsenVoters
        ? `n >= ${MIN_COHORT_VOTERS}`
        : `n = ${gap.highVoters.toLocaleString()}`;
      const lowSampleLabel = gap.coarsenVoters
        ? `n >= ${MIN_COHORT_VOTERS}`
        : `n = ${gap.lowVoters.toLocaleString()}`;
      return [
        [
          r(
            gap.questionLabel ?? abbreviateSurveyQuestion(gap.questionText),
            "bold",
            8.5,
          ),
        ],
        [r(gap.flavorSlug, "code", 8)],
        [
          r(gap.highAnswerLabel, "bold", 8.5),
          r(
            `\n${formatRatePercent(gap.highRate)} (${highSampleLabel})`,
            "positive",
            7.5,
          ),
        ],
        [
          r(gap.lowAnswerLabel, "regular", 8.5),
          r(
            `\n${formatRatePercent(gap.lowRate)} (${lowSampleLabel})`,
            "negative",
            7.5,
          ),
        ],
        [r(`+${gap.spreadPp.toFixed(1)} pp`, "positiveBold", 8.5)],
      ];
    });

    const widest = safeGaps[0]!;
    const widestDim =
      widest.questionLabel ?? abbreviateSurveyQuestion(widest.questionText);
    const minSample = Math.min(widest.highVoters, widest.lowVoters);
    const directionalCaution =
      minSample < RELIABLE_TASTE_GAP_MIN_VOTERS
        ? widest.coarsenVoters
          ? `; treat as directional given cohort sample sizes near the k >= ${MIN_COHORT_VOTERS} threshold`
          : `; treat as directional given cohort sample sizes down to n = ${minSample}`
        : "";
    section3Table = {
      columns: gapColumns,
      rows: gapRows,
      takeawayRuns: takeawayLine(
        `Widest audience split occurs on ${widestDim} for ${widest.flavorSlug} (+${widest.spreadPp.toFixed(1)} pp between ${widest.highAnswerLabel} at ${formatRatePercent(widest.highRate)} and ${widest.lowAnswerLabel} at ${formatRatePercent(widest.lowRate)})${directionalCaution}.`,
      ),
    };
  } else if (surveyedVoters < MIN_COHORT_VOTERS) {
    section3Note = {
      tone: "warning",
      runs: [
        r(
          `Cohort breakdown withheld under the k >= ${MIN_COHORT_VOTERS} privacy threshold. `,
          "bold",
          9,
        ),
        r(
          surveyedVoters === 0
            ? `0 of ${studyVoters.toLocaleString()} voters in this study have demographic survey responses on file.`
            : `Fewer than ${MIN_COHORT_VOTERS} voters in this study have demographic survey responses on file, so exact respondent counts and segment rates are suppressed.`,
          "regular",
          9,
        ),
      ],
    };
  } else {
    section3Note = {
      tone: "info",
      runs: [
        r(
          `No multi-cohort divergence meets k >= ${MIN_COHORT_VOTERS} in this study. `,
          "bold",
          9,
        ),
        r(
          `${hasSmallUnsurveyed ? `At least ${coarsenedSurveyedFloor.toLocaleString()}` : surveyedVoters.toLocaleString()} surveyed voters participated, but no survey question recorded two or more distinct answer cohorts with at least ${MIN_COHORT_VOTERS} voters on the same prompt flavor.`,
          "regular",
          9,
        ),
      ],
    };
  }

  // Section 04: Controlled Same-Image Caption Comparisons
  const showdownCandidates = [...bundle.headToHead.groups]
    .filter((g) => g.spreadPp !== null)
    .map((group) => {
      const pair = pickShowdownEndpointPair(group);
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
        item,
      ): item is {
        group: SameImageComparisonGroup;
        pair: NonNullable<ReturnType<typeof pickShowdownEndpointPair>>;
        pairSpreadPp: number;
        isReliable: number;
      } => item !== null,
    )
    .sort(
      (a, b) =>
        b.isReliable - a.isReliable ||
        b.pairSpreadPp - a.pairSpreadPp ||
        b.group.totalExposures - a.group.totalExposures ||
        a.group.imageId.localeCompare(b.group.imageId),
    )
    .slice(0, MAX_SHOWDOWN_ROWS);

  const hasCrossFlavorShowdowns = showdownCandidates.some(
    ({ pair }) => pair.winner.flavorKey !== pair.flop.flavorKey,
  );
  const soleShowdownFlavorSlug =
    !hasCrossFlavorShowdowns && evaluatedFlavors.length === 1 && topFlavor != null
      ? topFlavor.label
      : !hasCrossFlavorShowdowns && showdownCandidates[0] != null
        ? showdownCandidates[0].pair.winner.flavorSlug
        : null;

  const section4Lead: PdfSerializedTextRun[] = hasCrossFlavorShowdowns
    ? [
        r(
          `Comparing captions written for the exact same image holds visual context constant across ${pluralizeCount(bundle.headToHead.evaluatedSharedImageCount, "evaluated shared prompt")}, isolating how prompt-chain framing shifts reception.`,
        ),
      ]
    : soleShowdownFlavorSlug != null &&
        !soleShowdownFlavorSlug.toLowerCase().includes("unattributed")
      ? [
          r("Holding both visual context and prompt flavor "),
          r(soleShowdownFlavorSlug, "code", 9),
          r(
            ` constant across ${pluralizeCount(bundle.headToHead.evaluatedSharedImageCount, "evaluated shared prompt")} isolates punchline-level variance between individual caption realizations.`,
          ),
        ]
      : [
          r(
            `Comparing multiple captions written for the exact same image across ${pluralizeCount(bundle.headToHead.evaluatedSharedImageCount, "evaluated shared prompt")} measures within-prompt punchline dispersion while holding visual context constant.`,
          ),
        ];

  let section4Table: StudyPdfTableSpec | undefined;
  let section4Note: StudyPdfNoteBoxSpec | undefined;
  if (showdownCandidates.length > 0) {
    const showdownColumns: readonly StudyPdfTableColumnSpec[] = [
      { header: "Shared prompt & baseline", widthPt: 124, align: "left" },
      { header: "Highest-rated caption", widthPt: 164, align: "left" },
      { header: "Lowest-rated caption", widthPt: 164, align: "left" },
      { header: "Spread", widthPt: 48, align: "right" },
    ];
    const showdownRows = showdownCandidates.map(
      ({ group, pair, pairSpreadPp }, idx) => [
        [
          r(`Prompt #${idx + 1}`, "bold", 8.5),
          r(`\n${concisePromptDescription(group.imageDescription)}`, "regular", 8),
          r(
            `\nBaseline: ${formatRatePercent(group.imageMeanRate)} (${pluralizeCount(group.captions.length, "caption")})`,
            "muted",
            7.5,
          ),
        ],
        [
          r(sanitizeQuotedCaption(pair.winner.captionText), "italic", 8.5),
          r(`\n${pair.winner.flavorSlug}`, "codePositiveBold", 7.5),
          r(
            ` \u00b7 ${formatRatePercent(pair.winner.rate)} (${pair.winner.positive.toLocaleString()}/${pair.winner.exposures.toLocaleString()})`,
            "muted",
            7.5,
          ),
        ],
        [
          r(sanitizeQuotedCaption(pair.flop.captionText), "italic", 8.5),
          r(`\n${pair.flop.flavorSlug}`, "codeNegativeBold", 7.5),
          r(
            ` \u00b7 ${formatRatePercent(pair.flop.rate)} (${pair.flop.positive.toLocaleString()}/${pair.flop.exposures.toLocaleString()})`,
            "muted",
            7.5,
          ),
        ],
        [r(`+${pairSpreadPp.toFixed(1)} pp`, "positiveBold", 8.5)],
      ],
    );

    const topSpread = showdownCandidates[0]!.pairSpreadPp;
    const minShownSpread =
      showdownCandidates[showdownCandidates.length - 1]!.pairSpreadPp;

    let section4TakeawayText: string;
    if (hasCrossFlavorShowdowns) {
      const winnerCounts = new Map<string, number>();
      for (const { pair } of showdownCandidates) {
        winnerCounts.set(
          pair.winner.flavorSlug,
          (winnerCounts.get(pair.winner.flavorSlug) ?? 0) + 1,
        );
      }
      const topRecurringWinner = [...winnerCounts.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      const spreadRangeClause =
        showdownCandidates.length === 1
          ? `+${topSpread.toFixed(1)} pp on the single shared prompt`
          : `+${minShownSpread.toFixed(1)} pp to +${topSpread.toFixed(1)} pp across the top ${showdownCandidates.length} shared prompts`;
      const winnerPatternClause = topRecurringWinner
        ? `, with ${topRecurringWinner[0]} capturing the highest-rated caption on ${topRecurringWinner[1]} of ${showdownCandidates.length} ${pluralize(showdownCandidates.length, "prompt")}`
        : "";
      section4TakeawayText = `Controlled same-image spreads span ${spreadRangeClause}${winnerPatternClause}.`;
    } else if (showdownCandidates.length === 1) {
      const singlePair = showdownCandidates[0]!.pair;
      const flavorContext =
        soleShowdownFlavorSlug != null &&
        !soleShowdownFlavorSlug.toLowerCase().includes("unattributed")
          ? ` under prompt flavor ${soleShowdownFlavorSlug}`
          : " within the same caption pool";
      section4TakeawayText = `Within-prompt punchline reception diverges by +${topSpread.toFixed(1)} pp (${formatRatePercent(singlePair.winner.rate)} vs. ${formatRatePercent(singlePair.flop.rate)})${flavorContext}, showing substantial caption-to-caption spread even on an identical image.`;
    } else {
      const flavorContext =
        soleShowdownFlavorSlug != null &&
        !soleShowdownFlavorSlug.toLowerCase().includes("unattributed")
          ? `holding prompt flavor ${soleShowdownFlavorSlug} and image constant`
          : "holding the prompt image constant within a single caption pool";
      section4TakeawayText = `Even ${flavorContext}, individual caption realizations diverge by +${minShownSpread.toFixed(1)} pp to +${topSpread.toFixed(1)} pp across the top ${showdownCandidates.length} shared prompts.`;
    }

    section4Table = {
      columns: showdownColumns,
      rows: showdownRows,
      takeawayRuns: takeawayLine(section4TakeawayText),
    };
  } else {
    section4Note = {
      tone: "info",
      runs: [
        r("No multi-caption shared-image comparisons available. ", "bold", 9),
        r(
          "Each evaluated image in this study maps to a single scored caption, so within-image spread cannot be computed.",
          "regular",
          9,
        ),
      ],
    };
  }

  return {
    studyId,
    shortTitle,
    pdfInfoTitle,
    pdfInfoSubject,
    overlineBadge,
    thesisTitle,
    bylineRuns,
    runningHeaderLeft,
    excludeHighRisk: bundle.excludeHighRisk,
    isZeroVoteStagingStudy: false,
    mappedCaptionCount,
    sections: [
      {
        numberPrefix: "01",
        title: "Study scope & headline findings",
        leadRuns: section1Lead,
        bullets: [bullet1, bullet2, bullet3, bullet4],
      },
      {
        numberPrefix: "02",
        title: "Prompt flavor & model attribution",
        leadRuns: [
          r(
            "Flavors are ordered by the lower bound of their 95% Wilson confidence interval so sustained positive reception outranks small-sample variance; same-image lift mean-centers each caption against rival captions on the same image.",
          ),
        ],
        primaryTable: flavorTable,
        subBlocks: modelSubBlocks,
      },
      {
        numberPrefix: "03",
        title: "Audience cohort reception",
        leadRuns: section3Lead,
        primaryTable: section3Table,
        primaryNoteBox: section3Note,
      },
      {
        numberPrefix: "04",
        title: "Controlled same-image caption comparisons",
        leadRuns: section4Lead,
        primaryTable: section4Table,
        primaryNoteBox: section4Note,
      },
    ],
  };
}

const mapSerializedRunToEngineRun = (
  item: PdfSerializedTextRun,
  baseSizePt: number,
): PdfTextRun => {
  const fontSizePt = item.fontSizePt ?? baseSizePt;
  switch (item.style ?? "regular") {
    case "bold":
      return {
        text: item.text,
        font: "F2",
        fontSizePt,
        color: PDF_COLORS.bodyInk,
      };
    case "italic":
      return {
        text: item.text,
        font: "F3",
        fontSizePt,
        color: PDF_COLORS.bodyInk,
      };
    case "boldItalic":
      return {
        text: item.text,
        font: "F6",
        fontSizePt,
        color: PDF_COLORS.bodyInk,
      };
    case "code":
      return {
        text: item.text,
        font: "F4",
        fontSizePt,
        color: PDF_COLORS.bodyInk,
      };
    case "codeBold":
      return {
        text: item.text,
        font: "F5",
        fontSizePt,
        color: PDF_COLORS.bodyInk,
      };
    case "codePositiveBold":
      return {
        text: item.text,
        font: "F5",
        fontSizePt,
        color: PDF_COLORS.positiveInk,
      };
    case "codeNegativeBold":
      return {
        text: item.text,
        font: "F5",
        fontSizePt,
        color: PDF_COLORS.negativeInk,
      };
    case "muted":
      return {
        text: item.text,
        font: "F1",
        fontSizePt,
        color: PDF_COLORS.mutedInk,
      };
    case "mutedItalic":
      return {
        text: item.text,
        font: "F3",
        fontSizePt,
        color: PDF_COLORS.mutedInk,
      };
    case "mutedBoldItalic":
      return {
        text: item.text,
        font: "F6",
        fontSizePt,
        color: PDF_COLORS.mutedInk,
      };
    case "amberBold":
      return {
        text: item.text,
        font: "F2",
        fontSizePt,
        color: PDF_COLORS.amberAccentInk,
      };
    case "positive":
      return {
        text: item.text,
        font: "F1",
        fontSizePt,
        color: PDF_COLORS.positiveInk,
      };
    case "positiveBold":
      return {
        text: item.text,
        font: "F2",
        fontSizePt,
        color: PDF_COLORS.positiveInk,
      };
    case "negative":
      return {
        text: item.text,
        font: "F1",
        fontSizePt,
        color: PDF_COLORS.negativeInk,
      };
    case "negativeBold":
      return {
        text: item.text,
        font: "F2",
        fontSizePt,
        color: PDF_COLORS.negativeInk,
      };
    case "regular":
    default:
      return {
        text: item.text,
        font: "F1",
        fontSizePt,
        color: PDF_COLORS.bodyInk,
      };
  }
};

const toEngineRuns = (
  runs: readonly PdfSerializedTextRun[],
  baseSizePt: number,
): PdfTextRun[] => runs.map((item) => mapSerializedRunToEngineRun(item, baseSizePt));

interface MeasuredTableHeader {
  readonly cellLayouts: readonly PdfRichTextBlockLayout[];
  readonly heightPt: number;
}

interface MeasuredTableRow {
  readonly cellLayouts: readonly PdfRichTextBlockLayout[];
  readonly heightPt: number;
}

class WrittenReportLayoutEngine {
  private readonly doc = new PdfDocumentBuilder();
  private cursorY = PDF_TOP_MARGIN_PT;
  private readonly runningHeaderLeft: string;

  constructor(runningHeaderLeft: string) {
    this.runningHeaderLeft = runningHeaderLeft;
  }

  getBuilder(): PdfDocumentBuilder {
    return this.doc;
  }

  drawPage1DocumentHeader(report: StudyPdfReportData): void {
    // 1. Clean 8.5 pt #1A73E8 ALL-CAPS overline (topY = 54 pt, baseline = 62 pt, zero background strip).
    this.doc.drawText({
      text: report.overlineBadge,
      x: PDF_MARGIN_X_PT,
      baselineTopY: 62,
      font: "F2",
      fontSizePt: 8.5,
      color: PDF_COLORS.houseBlue,
      align: "left",
    });
    this.cursorY = 69;

    // 2. Sentence-case empirical thesis title (18.5 pt /F2, lineHeight = 23 pt).
    const titleLayout = layoutRichTextRuns(
      [
        {
          text: report.thesisTitle,
          font: "F2",
          fontSizePt: 18.5,
          color: PDF_COLORS.bodyInk,
        },
      ],
      {
        maxWidthPt: PDF_CONTENT_WIDTH_PT,
        lineHeightPt: 23,
        defaultFont: "F2",
        defaultFontSizePt: 18.5,
        defaultColor: PDF_COLORS.bodyInk,
        cushionPt: 1,
      },
    );
    this.doc.drawRichTextBlock(
      titleLayout,
      PDF_MARGIN_X_PT,
      this.cursorY + 15.5,
    );
    this.cursorY += titleLayout.heightPt + 6;

    // 3. Plain ·-separated document byline (9 pt mixed runs, lineHeight = 13 pt, zero pill chips).
    const bylineLayout = layoutRichTextRuns(toEngineRuns(report.bylineRuns, 9), {
      maxWidthPt: PDF_CONTENT_WIDTH_PT,
      lineHeightPt: 13,
      defaultFont: "F1",
      defaultFontSizePt: 9,
      defaultColor: PDF_COLORS.mutedInk,
      cushionPt: 1,
    });
    this.doc.drawRichTextBlock(
      bylineLayout,
      PDF_MARGIN_X_PT,
      this.cursorY + 7.4,
    );
    this.cursorY += bylineLayout.heightPt + 8;

    // 4. Crisp 0.75 pt #DADCE0 rule + 14 pt spacer before Section 01.
    this.doc.drawLine({
      x1: PDF_MARGIN_X_PT,
      topY1: this.cursorY,
      x2: PDF_CONTENT_RIGHT_X_PT,
      topY2: this.cursorY,
      stroke: PDF_COLORS.borderRule,
      lineWidthPt: 0.75,
    });
    this.cursorY += 14;
  }

  drawSection(section: StudyPdfSectionSpec, isFirstSection: boolean): void {
    const spaceAbove = isFirstSection ? 0 : 14;

    const headingLayout = layoutRichTextRuns(
      [
        {
          text: `${section.numberPrefix} \u00b7 `,
          font: "F2",
          fontSizePt: 13.5,
          color: PDF_COLORS.houseBlue,
        },
        {
          text: section.title,
          font: "F2",
          fontSizePt: 13.5,
          color: PDF_COLORS.bodyInk,
        },
      ],
      {
        maxWidthPt: PDF_CONTENT_WIDTH_PT,
        lineHeightPt: 17.5,
        defaultFont: "F2",
        defaultFontSizePt: 13.5,
        cushionPt: 1,
      },
    );

    const leadLayout = layoutRichTextRuns(toEngineRuns(section.leadRuns, 9.5), {
      maxWidthPt: PDF_CONTENT_WIDTH_PT,
      lineHeightPt: 14.2,
      defaultFont: "F1",
      defaultFontSizePt: 9.5,
      defaultColor: PDF_COLORS.bodyInk,
      cushionPt: 1.5,
    });

    // Compute minimum height of the first element following lead-in prose so headings never orphan.
    let firstFollowHeight = 0;
    if (section.bullets && section.bullets.length > 0) {
      firstFollowHeight = this.measureBulletItem(section.bullets[0]!).heightPt;
    } else if (section.primaryTable) {
      const measuredHdr = this.measureTableHeader(section.primaryTable.columns);
      const firstRowH =
        section.primaryTable.rows.length > 0
          ? this.measureTableRow(
              section.primaryTable.columns,
              section.primaryTable.rows[0]!,
            ).heightPt
          : 0;
      const singleRowTakeawayExtra =
        section.primaryTable.rows.length <= 1
          ? this.measureTakeawayExtraHeight(section.primaryTable.takeawayRuns)
          : 0;
      firstFollowHeight =
        measuredHdr.heightPt + firstRowH + singleRowTakeawayExtra;
    } else if (section.primaryNoteBox) {
      firstFollowHeight = this.measureNoteBox(section.primaryNoteBox).boxHeightPt;
    }

    const keepTogetherHeight =
      headingLayout.heightPt + 6 + leadLayout.heightPt + 8 + firstFollowHeight;
    if (this.cursorY + spaceAbove + keepTogetherHeight > PDF_MAX_BODY_BOTTOM_Y_PT) {
      this.startContinuationPage();
    } else {
      this.cursorY += spaceAbove;
    }

    this.doc.drawRichTextBlock(
      headingLayout,
      PDF_MARGIN_X_PT,
      this.cursorY + 11.2,
    );
    this.cursorY += headingLayout.heightPt + 6;

    this.drawMeasuredParagraph(leadLayout, 8);

    if (section.bullets && section.bullets.length > 0) {
      this.drawBulletList(section.bullets);
    }

    if (section.primaryTable) {
      this.drawTable(
        section.numberPrefix,
        section.title,
        section.primaryTable,
      );
    }

    if (section.primaryNoteBox) {
      this.drawNoteBox(section.primaryNoteBox);
    }

    if (section.subBlocks) {
      for (const sub of section.subBlocks) {
        const subLeadLayout = layoutRichTextRuns(
          toEngineRuns(sub.leadRuns, 9.5),
          {
            maxWidthPt: PDF_CONTENT_WIDTH_PT,
            lineHeightPt: 14.2,
            defaultFont: "F1",
            defaultFontSizePt: 9.5,
            defaultColor: PDF_COLORS.bodyInk,
            cushionPt: 1.5,
          },
        );

        let subFollowHeight = 0;
        if (sub.table) {
          const hdr = this.measureTableHeader(sub.table.columns);
          const firstRow =
            sub.table.rows.length > 0
              ? this.measureTableRow(sub.table.columns, sub.table.rows[0]!)
                  .heightPt
              : 0;
          const singleRowTakeawayExtra =
            sub.table.rows.length <= 1
              ? this.measureTakeawayExtraHeight(sub.table.takeawayRuns)
              : 0;
          subFollowHeight = hdr.heightPt + firstRow + singleRowTakeawayExtra;
        } else if (sub.noteBox) {
          subFollowHeight = this.measureNoteBox(sub.noteBox).boxHeightPt;
        }

        if (
          this.cursorY + subLeadLayout.heightPt + 6 + subFollowHeight >
          PDF_MAX_BODY_BOTTOM_Y_PT
        ) {
          this.startContinuationPage();
        }

        this.drawMeasuredParagraph(subLeadLayout, 6);
        if (sub.table) {
          this.drawTable(section.numberPrefix, section.title, sub.table);
        }
        if (sub.noteBox) {
          this.drawNoteBox(sub.noteBox);
        }
      }
    }
  }

  private startContinuationPage(): void {
    this.doc.addPage();
    this.doc.drawText({
      text: this.runningHeaderLeft,
      x: PDF_MARGIN_X_PT,
      baselineTopY: PDF_RUNNING_HEADER_BASELINE_Y_PT,
      font: "F3",
      fontSizePt: 8.5,
      color: PDF_COLORS.mutedInk,
      align: "left",
    });
    this.doc.drawLine({
      x1: PDF_MARGIN_X_PT,
      topY1: PDF_RUNNING_HEADER_RULE_Y_PT,
      x2: PDF_CONTENT_RIGHT_X_PT,
      topY2: PDF_RUNNING_HEADER_RULE_Y_PT,
      stroke: PDF_COLORS.borderRule,
      lineWidthPt: 0.5,
    });
    this.cursorY = PDF_CONTINUATION_BODY_START_Y_PT;
  }

  private drawMeasuredParagraph(
    block: PdfRichTextBlockLayout,
    spaceBelowPt: number,
  ): void {
    if (this.cursorY + block.heightPt > PDF_MAX_BODY_BOTTOM_Y_PT) {
      this.startContinuationPage();
    }
    this.doc.drawRichTextBlock(block, PDF_MARGIN_X_PT, this.cursorY + 7.8);
    this.cursorY += block.heightPt + spaceBelowPt;
  }

  private measureBulletItem(
    runs: readonly PdfSerializedTextRun[],
  ): PdfRichTextBlockLayout {
    return layoutRichTextRuns(toEngineRuns(runs, 9.5), {
      maxWidthPt: 486,
      lineHeightPt: 13.8,
      defaultFont: "F1",
      defaultFontSizePt: 9.5,
      defaultColor: PDF_COLORS.bodyInk,
      cushionPt: 1.5,
    });
  }

  private drawBulletList(
    bullets: readonly (readonly PdfSerializedTextRun[])[],
  ): void {
    bullets.forEach((itemRuns, idx) => {
      const layout = this.measureBulletItem(itemRuns);
      if (this.cursorY + layout.heightPt > PDF_MAX_BODY_BOTTOM_Y_PT) {
        this.startContinuationPage();
      }
      const firstBaseline = this.cursorY + 7.8;
      this.doc.drawText({
        text: "\u2022",
        x: 60,
        baselineTopY: firstBaseline,
        font: "F2",
        fontSizePt: 9.5,
        color: PDF_COLORS.bodyInk,
        align: "left",
      });
      this.doc.drawRichTextBlock(layout, 70, firstBaseline);
      const isLast = idx === bullets.length - 1;
      this.cursorY += layout.heightPt + (isLast ? 10 : 4);
    });
  }

  private measureNoteBox(spec: StudyPdfNoteBoxSpec): {
    readonly textLayout: PdfRichTextBlockLayout;
    readonly boxHeightPt: number;
  } {
    const innerWidthPt = PDF_CONTENT_WIDTH_PT - 2 * NOTE_BOX_PAD_X_PT;
    const textLayout = layoutRichTextRuns(toEngineRuns(spec.runs, 9), {
      maxWidthPt: innerWidthPt,
      lineHeightPt: 13.4,
      defaultFont: "F1",
      defaultFontSizePt: 9,
      defaultColor: PDF_COLORS.bodyInk,
      cushionPt: 1.5,
    });
    return {
      textLayout,
      boxHeightPt: textLayout.heightPt + 2 * NOTE_BOX_PAD_Y_PT,
    };
  }

  private drawNoteBox(spec: StudyPdfNoteBoxSpec): void {
    const { textLayout, boxHeightPt } = this.measureNoteBox(spec);
    if (this.cursorY + boxHeightPt > PDF_MAX_BODY_BOTTOM_Y_PT) {
      this.startContinuationPage();
    }

    const fill =
      spec.tone === "warning" ? PDF_COLORS.noteBg : PDF_COLORS.infoNoteBg;
    const accent =
      spec.tone === "warning"
        ? PDF_COLORS.amberAccentInk
        : PDF_COLORS.houseBlue;

    this.doc.drawRect({
      x: PDF_MARGIN_X_PT,
      topY: this.cursorY,
      width: PDF_CONTENT_WIDTH_PT,
      height: boxHeightPt,
      fill,
      stroke: PDF_COLORS.borderRule,
      lineWidthPt: 0.5,
    });
    this.doc.drawRect({
      x: PDF_MARGIN_X_PT,
      topY: this.cursorY,
      width: NOTE_BOX_ACCENT_WIDTH_PT,
      height: boxHeightPt,
      fill: accent,
    });
    this.doc.drawRichTextBlock(
      textLayout,
      PDF_MARGIN_X_PT + NOTE_BOX_PAD_X_PT,
      this.cursorY + NOTE_BOX_PAD_Y_PT + 7.4,
    );
    this.cursorY += boxHeightPt + 12;
  }

  private validateColumnWidthSum(
    columns: readonly StudyPdfTableColumnSpec[],
  ): void {
    const sum = columns.reduce((acc, col) => acc + col.widthPt, 0);
    if (Math.abs(sum - PDF_CONTENT_WIDTH_PT) > 0.01) {
      throw new Error(
        `Table columns sum to ${sum.toFixed(2)} pt instead of ${PDF_CONTENT_WIDTH_PT} pt.`,
      );
    }
  }

  private measureTableHeader(
    columns: readonly StudyPdfTableColumnSpec[],
  ): MeasuredTableHeader {
    this.validateColumnWidthSum(columns);
    let maxLines = 1;
    const cellLayouts = columns.map((col) => {
      const innerWidth = Math.max(12, col.widthPt - 2 * TABLE_PAD_X_PT);
      const layout = layoutRichTextRuns(
        [
          {
            text: col.header,
            font: "F2",
            fontSizePt: TABLE_HEADER_FONT_SIZE_PT,
            color: PDF_COLORS.tableHeaderInk,
          },
        ],
        {
          maxWidthPt: innerWidth,
          lineHeightPt: TABLE_HEADER_LINE_HEIGHT_PT,
          defaultFont: "F2",
          defaultFontSizePt: TABLE_HEADER_FONT_SIZE_PT,
          defaultColor: PDF_COLORS.tableHeaderInk,
          align: col.align,
          cushionPt: 1,
        },
      );
      if (layout.lines.length > maxLines) {
        maxLines = layout.lines.length;
      }
      return layout;
    });

    const contentHeight =
      (maxLines - 1) * TABLE_HEADER_LINE_HEIGHT_PT + 8.6;
    return {
      cellLayouts,
      heightPt: Math.max(21, contentHeight + 2 * TABLE_PAD_Y_PT),
    };
  }

  private measureTableRow(
    columns: readonly StudyPdfTableColumnSpec[],
    rowCells: readonly (readonly PdfSerializedTextRun[])[],
  ): MeasuredTableRow {
    let maxLines = 1;
    const cellLayouts = columns.map((col, idx) => {
      const innerWidth = Math.max(12, col.widthPt - 2 * TABLE_PAD_X_PT);
      const cellRuns = rowCells[idx] ?? [];
      const layout = layoutRichTextRuns(
        toEngineRuns(cellRuns, TABLE_CELL_FONT_SIZE_PT),
        {
          maxWidthPt: innerWidth,
          lineHeightPt: TABLE_CELL_LINE_HEIGHT_PT,
          defaultFont: "F1",
          defaultFontSizePt: TABLE_CELL_FONT_SIZE_PT,
          defaultColor: PDF_COLORS.bodyInk,
          align: col.align,
          cushionPt: 1.5,
          maxLines: TABLE_MAX_CELL_LINES,
        },
      );
      if (layout.lines.length > maxLines) {
        maxLines = layout.lines.length;
      }
      return layout;
    });

    const contentHeight = (maxLines - 1) * TABLE_CELL_LINE_HEIGHT_PT + 9.0;
    return {
      cellLayouts,
      heightPt: Math.max(21, contentHeight + 2 * TABLE_PAD_Y_PT),
    };
  }

  private drawTableHeaderRow(
    columns: readonly StudyPdfTableColumnSpec[],
    measured: MeasuredTableHeader,
  ): void {
    const topY = this.cursorY;
    this.doc.drawRect({
      x: PDF_MARGIN_X_PT,
      topY,
      width: PDF_CONTENT_WIDTH_PT,
      height: measured.heightPt,
      fill: PDF_COLORS.tableHeaderBg,
      stroke: PDF_COLORS.borderRule,
      lineWidthPt: 0.5,
    });

    let colX = PDF_MARGIN_X_PT;
    columns.forEach((col, idx) => {
      if (idx > 0) {
        this.doc.drawLine({
          x1: colX,
          topY1: topY,
          x2: colX,
          topY2: topY + measured.heightPt,
          stroke: PDF_COLORS.borderRule,
          lineWidthPt: 0.5,
        });
      }
      const layout = measured.cellLayouts[idx]!;
      this.doc.drawRichTextBlock(
        layout,
        colX + TABLE_PAD_X_PT,
        topY + TABLE_PAD_Y_PT + 7.1,
      );
      colX += col.widthPt;
    });

    this.cursorY += measured.heightPt;
  }

  private measureTakeawayLayout(
    takeawayRuns: readonly PdfSerializedTextRun[] | null,
  ): PdfRichTextBlockLayout | null {
    if (!takeawayRuns || takeawayRuns.length === 0) {
      return null;
    }
    return layoutRichTextRuns(toEngineRuns(takeawayRuns, 9), {
      maxWidthPt: PDF_CONTENT_WIDTH_PT,
      lineHeightPt: 13.2,
      defaultFont: "F3",
      defaultFontSizePt: 9,
      defaultColor: PDF_COLORS.mutedInk,
      cushionPt: 1.5,
    });
  }

  private measureTakeawayExtraHeight(
    takeawayRuns: readonly PdfSerializedTextRun[] | null,
  ): number {
    const layout = this.measureTakeawayLayout(takeawayRuns);
    return layout ? 6 + layout.heightPt : 0;
  }

  private drawTable(
    sectionNumberPrefix: string,
    sectionTitle: string,
    table: StudyPdfTableSpec,
  ): void {
    const measuredHeader = this.measureTableHeader(table.columns);
    const measuredRows = table.rows.map((row) =>
      this.measureTableRow(table.columns, row),
    );
    const takeawayLayout = this.measureTakeawayLayout(table.takeawayRuns);
    const takeawayExtraPt = takeawayLayout ? 6 + takeawayLayout.heightPt : 0;

    const firstRowHeight = measuredRows[0]?.heightPt ?? 0;
    const initialKeepExtra =
      measuredRows.length <= 1 ? takeawayExtraPt : 0;
    if (
      this.cursorY +
        measuredHeader.heightPt +
        firstRowHeight +
        initialKeepExtra >
      PDF_MAX_BODY_BOTTOM_Y_PT
    ) {
      this.startContinuationPage();
      this.drawContinuationHeading(sectionNumberPrefix, sectionTitle);
    }

    this.drawTableHeaderRow(table.columns, measuredHeader);

    measuredRows.forEach((measuredRow, rowIdx) => {
      const isLastRow = rowIdx === measuredRows.length - 1;
      const rowKeepExtra =
        isLastRow && measuredRows.length >= 2 &&
        measuredHeader.heightPt + measuredRow.heightPt + takeawayExtraPt <=
          PDF_MAX_BODY_BOTTOM_Y_PT - PDF_CONTINUATION_BODY_START_Y_PT - 20
          ? takeawayExtraPt
          : 0;

      if (
        this.cursorY + measuredRow.heightPt + rowKeepExtra >
        PDF_MAX_BODY_BOTTOM_Y_PT
      ) {
        this.startContinuationPage();
        this.drawContinuationHeading(sectionNumberPrefix, sectionTitle);
        this.drawTableHeaderRow(table.columns, measuredHeader);
      }

      const rowTopY = this.cursorY;
      const fill =
        rowIdx % 2 === 0 ? PDF_COLORS.paper : PDF_COLORS.subtleRowBg;
      this.doc.drawRect({
        x: PDF_MARGIN_X_PT,
        topY: rowTopY,
        width: PDF_CONTENT_WIDTH_PT,
        height: measuredRow.heightPt,
        fill,
        stroke: PDF_COLORS.borderRule,
        lineWidthPt: 0.5,
      });

      let colX = PDF_MARGIN_X_PT;
      table.columns.forEach((col, colIdx) => {
        if (colIdx > 0) {
          this.doc.drawLine({
            x1: colX,
            topY1: rowTopY,
            x2: colX,
            topY2: rowTopY + measuredRow.heightPt,
            stroke: PDF_COLORS.borderRule,
            lineWidthPt: 0.5,
          });
        }
        const cellLayout = measuredRow.cellLayouts[colIdx]!;
        this.doc.drawRichTextBlock(
          cellLayout,
          colX + TABLE_PAD_X_PT,
          rowTopY + TABLE_PAD_Y_PT + 7.2,
        );
        colX += col.widthPt;
      });

      this.cursorY += measuredRow.heightPt;
    });

    if (takeawayLayout) {
      if (this.cursorY + 6 + takeawayLayout.heightPt > PDF_MAX_BODY_BOTTOM_Y_PT) {
        this.startContinuationPage();
      } else {
        this.cursorY += 6;
      }
      this.doc.drawRichTextBlock(
        takeawayLayout,
        PDF_MARGIN_X_PT,
        this.cursorY + 7.4,
      );
      this.cursorY += takeawayLayout.heightPt + 12;
    } else {
      this.cursorY += 12;
    }
  }

  private drawContinuationHeading(
    sectionNumberPrefix: string,
    sectionTitle: string,
  ): void {
    const contLayout = layoutRichTextRuns(
      [
        {
          text: `${sectionNumberPrefix} \u00b7 `,
          font: "F2",
          fontSizePt: 10.5,
          color: PDF_COLORS.houseBlue,
        },
        {
          text: `${sectionTitle} (continued)`,
          font: "F2",
          fontSizePt: 10.5,
          color: PDF_COLORS.mutedInk,
        },
      ],
      {
        maxWidthPt: PDF_CONTENT_WIDTH_PT,
        lineHeightPt: 14,
        defaultFont: "F2",
        defaultFontSizePt: 10.5,
        cushionPt: 1,
      },
    );
    this.doc.drawRichTextBlock(contLayout, PDF_MARGIN_X_PT, this.cursorY + 8.6);
    this.cursorY += contLayout.heightPt + 5;
  }
}

/**
 * Compiles a pure-vector `%PDF-1.4` written empirical research report (`612 x 792 pt`,
 * `56 pt` side margins = `500.0 pt` measure, zero SaaS web-dashboard chrome) for a single study.
 */
export function renderStudyAttributionPdf(
  report: StudyPdfReportData,
): Uint8Array<ArrayBuffer> {
  const engine = new WrittenReportLayoutEngine(report.runningHeaderLeft);
  engine.drawPage1DocumentHeader(report);

  report.sections.forEach((section, idx) => {
    engine.drawSection(section, idx === 0);
  });

  const doc = engine.getBuilder();
  doc.stampStudyReportFooters(report.studyId);

  return doc.compile({
    title: report.pdfInfoTitle,
    subject: report.pdfInfoSubject,
  });
}
