import type { UnifiedExposure } from "@/utils/study-exposure-adapter";

export const UNATTRIBUTED_BUCKET_KEY = "__unattributed__";
export const UNATTRIBUTED_BUCKET_LABEL = "Unattributed / Manual";
export const MIN_COHORT_VOTERS = 5;
export const RELIABLE_TASTE_GAP_MIN_VOTERS = 10;
export const WILSON_Z_95 = 1.959963984540054;
const TIE_EPSILON = 1e-9;
const MAX_TOP_SAMPLE_CAPTIONS = 3;
const MAX_BOTTOM_SAMPLE_CAPTIONS = 2;
const MAX_STAGED_SAMPLE_CAPTIONS = 4;

export type RawDemographicQuestionRow = {
  id: number;
  question: string;
};

export type RawDemographicAnswerRow = {
  id: number;
  answer: string;
};

export type RawDemographicMappingRow = {
  id: number;
  question_id: number;
  answer_id: number;
  display_order: number | null;
  is_deleted: boolean;
};

export type RawDemographicUserResponseRow = {
  id: number;
  user_id: string;
  answer_question_mapping_id: number;
  created_datetime_utc: string;
  modified_datetime_utc: string | null;
};

export type CanonicalUserAnswer = {
  userId: string;
  questionId: number;
  answerId: number;
  mappingId: number;
};

export type CaptionAttributionSource =
  | "direct_fk"
  | "metadata_flavor_name"
  | "unattributed";

export type WilsonInterval = {
  rate: number | null;
  low: number | null;
  high: number | null;
};

export type AttributionPipelineStep = {
  stepOrder: number;
  modelName: string;
  providerName?: string | null;
};

export type AttributionSampleCaption = {
  captionId: string;
  captionText: string;
  imageId?: string | null;
  imageUrl: string | null;
  imageDescription: string | null;
  exposures: number;
  positive: number;
  rate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  flavorId?: number | null;
  flavorSlug: string;
  modelName: string;
};

export type CaptionRateHistogramBucket = {
  bucketKey: string;
  label: string;
  minPct: number;
  maxPct: number;
  captionCount: number;
};

export type CaptionRateDistribution = {
  buckets: CaptionRateHistogramBucket[];
  scoredCaptionCount: number;
  unratedCaptionCount: number;
};

export type CaptionLineageInfo = {
  captionId: string;
  content: string | null;
  imageId: string | null;
  imageUrl: string | null;
  imageDescription: string | null;
  attributionSource: CaptionAttributionSource;
  flavorId: number | null;
  flavorSlug: string | null;
  flavorDescription: string | null;
  flavorStepCount: number;
  terminalModelId: number | null;
  terminalModelName: string | null;
  terminalProviderModelId: string | null;
  terminalProviderName: string | null;
  pipelineSignature: string | null;
  pipelineSteps: string[];
  pipelineStepDetails?: AttributionPipelineStep[];
  chainLatencySeconds: number | null;
};

export type AttributionLeaderboardRow = {
  key: string;
  kind: "flavor" | "model" | "pipeline" | "unattributed";
  isUnattributed: boolean;
  flavorId: number | null;
  modelId: number | null;
  label: string;
  subtitle: string | null;
  description?: string | null;
  stepCount: number | null;
  dominantModelLabel: string | null;
  pipelineSteps: string[];
  pipelineStepDetails?: AttributionPipelineStep[];
  topCaptions?: AttributionSampleCaption[];
  bottomCaptions?: AttributionSampleCaption[];
  flavorCount: number;
  captionCount: number;
  exposures: number;
  positive: number;
  rate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  sharedImageCount: number;
  imageBaselineMean: number | null;
  meanLift: number | null;
  meanLiftPp: number | null;
  pairWins: number;
  pairLosses: number;
  pairTies: number;
  pairWinRate: number | null;
  medianChainSeconds: number | null;
  medianDwellMs: number | null;
};

export type SameImageCaptionCardMetric = {
  captionId: string;
  captionText: string;
  flavorId: number | null;
  flavorKey: string;
  flavorSlug: string;
  terminalModelLabel: string;
  exposures: number;
  positive: number;
  rate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  liftPp: number | null;
};

export type SameImageComparisonGroup = {
  imageId: string;
  imageUrl: string | null;
  imageDescription: string | null;
  totalExposures: number;
  imageMeanRate: number | null;
  spreadPp: number | null;
  captions: SameImageCaptionCardMetric[];
};

export type CohortFlavorCell =
  | {
      status: "visible";
      flavorKey: string;
      distinctVoters: number;
      exposures: number;
      positive: number;
      rate: number;
      ciLow: number;
      ciHigh: number;
      deltaPp: number;
    }
  | { status: "suppressed"; reason?: "below_k" | "complementary" }
  | { status: "empty" };

export type DemographicCohortRow = {
  rowKey: string;
  rowKind: "answer" | "masked_pool" | "unsurveyed";
  answerId: number | null;
  label: string;
  pooledOptionCount: number;
  distinctVoters: number | null;
  overallCell: CohortFlavorCell;
  cellsByFlavorKey: Record<string, CohortFlavorCell>;
};

export type DemographicFlavorColumn = {
  flavorKey: string;
  flavorId: number | null;
  flavorSlug: string;
  studyRate: number | null;
  studyExposures: number;
};

export type DemographicQuestionMatrix = {
  questionId: number;
  questionText: string;
  surveyedRespondentCount: number;
  unsurveyedVoterCount: number;
  studySurveyedVoterCount?: number;
  coarsenVoterCounts?: boolean;
  hideUnsurveyedCount?: boolean;
  visibleSegmentCount: number;
  maskedSegmentCount: number;
  rows: DemographicCohortRow[];
};

export type CohortTasteGapRow = {
  questionId: number;
  questionText: string;
  questionLabel?: string;
  flavorId: number | null;
  flavorKey: string;
  flavorSlug: string;
  highAnswerLabel: string;
  highRate: number;
  highVoters: number;
  lowAnswerLabel: string;
  lowRate: number;
  lowVoters: number;
  coarsenVoters?: boolean;
  spreadPp: number;
};

export type DemographicMatrixBundle = {
  studyVoterCount: number;
  surveyedVoterCount: number;
  totalVisibleSegments: number;
  totalMaskedSegments: number;
  flavorColumns: DemographicFlavorColumn[];
  questions: DemographicQuestionMatrix[];
  tasteGaps: CohortTasteGapRow[];
};

export type FlavorLiftSummary = {
  sharedImageCount: number;
  imageBaselineMean: number | null;
  meanLift: number | null;
  meanLiftPp: number | null;
  pairWins: number;
  pairLosses: number;
  pairTies: number;
  pairWinRate: number | null;
};

export type SameImageComputationResult = {
  structuralSharedImageCount: number;
  evaluatedSharedImageCount: number;
  crossFlavorSharedImageCount: number;
  comparableCaptionCount: number;
  maxImageSpreadPp: number | null;
  groups: SameImageComparisonGroup[];
  liftByFlavorKey: Map<string, FlavorLiftSummary>;
};

const clampUnitInterval = (value: number): number =>
  Math.min(1, Math.max(0, value));

export function computeMedian(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function computeWilsonConfidenceInterval(
  positive: number,
  exposures: number,
  z = WILSON_Z_95,
): WilsonInterval {
  if (exposures <= 0) {
    return { rate: null, low: null, high: null };
  }
  const clampedPositive = Math.min(Math.max(0, positive), exposures);
  const p = clampedPositive / exposures;
  const z2 = z * z;
  const denominator = 1 + z2 / exposures;
  const center = p + z2 / (2 * exposures);
  const variance = (p * (1 - p)) / exposures + z2 / (4 * exposures * exposures);
  const margin = z * Math.sqrt(Math.max(0, variance));

  return {
    rate: clampUnitInterval(p),
    low:
      clampedPositive === 0
        ? 0
        : clampUnitInterval((center - margin) / denominator),
    high:
      clampedPositive === exposures
        ? 1
        : clampUnitInterval((center + margin) / denominator),
  };
}

export const getFlavorBucketKey = (flavorId: number | null): string =>
  flavorId !== null ? `flavor:${flavorId}` : UNATTRIBUTED_BUCKET_KEY;

export const getModelBucketKey = (modelId: number | null): string =>
  modelId !== null ? `model:${modelId}` : UNATTRIBUTED_BUCKET_KEY;

export const getPipelineBucketKey = (signature: string | null): string =>
  signature !== null && signature.length > 0
    ? `pipeline:${signature}`
    : UNATTRIBUTED_BUCKET_KEY;

const parseTimestampOrFallback = (iso: string | null): number | null => {
  if (!iso) {
    return null;
  }
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
};

const isNewerDemographicResponse = (
  candidate: RawDemographicUserResponseRow,
  incumbent: RawDemographicUserResponseRow,
): boolean => {
  const candModStr =
    candidate.modified_datetime_utc ?? candidate.created_datetime_utc;
  const incModStr =
    incumbent.modified_datetime_utc ?? incumbent.created_datetime_utc;

  const candModMs = parseTimestampOrFallback(candModStr);
  const incModMs = parseTimestampOrFallback(incModStr);
  if (candModMs !== null && incModMs !== null && candModMs !== incModMs) {
    return candModMs > incModMs;
  }
  if (candModStr !== incModStr) {
    return candModStr > incModStr;
  }

  const candCreatedMs = parseTimestampOrFallback(candidate.created_datetime_utc);
  const incCreatedMs = parseTimestampOrFallback(incumbent.created_datetime_utc);
  if (
    candCreatedMs !== null &&
    incCreatedMs !== null &&
    candCreatedMs !== incCreatedMs
  ) {
    return candCreatedMs > incCreatedMs;
  }
  if (candidate.created_datetime_utc !== incumbent.created_datetime_utc) {
    return candidate.created_datetime_utc > incumbent.created_datetime_utc;
  }

  return candidate.id > incumbent.id;
};

export function canonicalizeDemographicResponses({
  responses,
  mappingsById,
}: {
  responses: readonly RawDemographicUserResponseRow[];
  mappingsById: ReadonlyMap<number, RawDemographicMappingRow>;
}): Map<string, Map<number, CanonicalUserAnswer>> {
  const winnersByUserQuestion = new Map<
    string,
    { row: RawDemographicUserResponseRow; mapping: RawDemographicMappingRow }
  >();

  for (const row of responses) {
    const mapping = mappingsById.get(row.answer_question_mapping_id);
    if (!mapping || mapping.is_deleted) {
      continue;
    }

    const pairKey = `${row.user_id}|${mapping.question_id}`;
    const existing = winnersByUserQuestion.get(pairKey);
    if (!existing || isNewerDemographicResponse(row, existing.row)) {
      winnersByUserQuestion.set(pairKey, { row, mapping });
    }
  }

  const byUser = new Map<string, Map<number, CanonicalUserAnswer>>();
  for (const { row, mapping } of winnersByUserQuestion.values()) {
    let userMap = byUser.get(row.user_id);
    if (!userMap) {
      userMap = new Map<number, CanonicalUserAnswer>();
      byUser.set(row.user_id, userMap);
    }
    userMap.set(mapping.question_id, {
      userId: row.user_id,
      questionId: mapping.question_id,
      answerId: mapping.answer_id,
      mappingId: mapping.id,
    });
  }

  return byUser;
}

type CaptionExposureTallies = {
  exposures: number;
  positive: number;
  dwells: number[];
};

const tallyExposuresByCaption = (
  mappedCaptionIds: readonly string[],
  exposures: readonly UnifiedExposure[],
): Map<string, CaptionExposureTallies> => {
  const tallies = new Map<string, CaptionExposureTallies>();
  for (const captionId of mappedCaptionIds) {
    if (!tallies.has(captionId)) {
      tallies.set(captionId, { exposures: 0, positive: 0, dwells: [] });
    }
  }
  for (const exposure of exposures) {
    let bucket = tallies.get(exposure.captionId);
    if (!bucket) {
      bucket = { exposures: 0, positive: 0, dwells: [] };
      tallies.set(exposure.captionId, bucket);
    }
    bucket.exposures += 1;
    if (exposure.isPositive) {
      bucket.positive += 1;
    }
    if (exposure.dwellMs !== null) {
      bucket.dwells.push(exposure.dwellMs);
    }
  }
  return tallies;
};

export function computeSameImageMetrics({
  mappedCaptionIds,
  captionsById,
  exposures,
}: {
  mappedCaptionIds: readonly string[];
  captionsById: ReadonlyMap<string, CaptionLineageInfo>;
  exposures: readonly UnifiedExposure[];
}): SameImageComputationResult {
  const uniqueCaptionIds = Array.from(new Set(mappedCaptionIds));
  const talliesByCaption = tallyExposuresByCaption(uniqueCaptionIds, exposures);

  const captionIdsByImage = new Map<string, string[]>();
  for (const captionId of uniqueCaptionIds) {
    const info = captionsById.get(captionId);
    if (!info?.imageId) {
      continue;
    }
    let list = captionIdsByImage.get(info.imageId);
    if (!list) {
      list = [];
      captionIdsByImage.set(info.imageId, list);
    }
    list.push(captionId);
  }

  type MutableFlavorLift = {
    sharedImages: Set<string>;
    lifts: number[];
    imageMeans: number[];
    wins: number;
    losses: number;
    ties: number;
  };
  const liftAccByFlavorKey = new Map<string, MutableFlavorLift>();
  const getLiftAcc = (flavorKey: string): MutableFlavorLift => {
    let acc = liftAccByFlavorKey.get(flavorKey);
    if (!acc) {
      acc = {
        sharedImages: new Set<string>(),
        lifts: [],
        imageMeans: [],
        wins: 0,
        losses: 0,
        ties: 0,
      };
      liftAccByFlavorKey.set(flavorKey, acc);
    }
    return acc;
  };

  let structuralSharedImageCount = 0;
  let evaluatedSharedImageCount = 0;
  let crossFlavorSharedImageCount = 0;
  let comparableCaptionCount = 0;
  let maxImageSpreadPp: number | null = null;
  const groups: SameImageComparisonGroup[] = [];

  for (const [imageId, imageCaptionIds] of captionIdsByImage.entries()) {
    if (imageCaptionIds.length < 2) {
      continue;
    }
    structuralSharedImageCount += 1;
    comparableCaptionCount += imageCaptionIds.length;

    const firstInfo = captionsById.get(imageCaptionIds[0]);
    const exposedRates: number[] = [];
    let totalImageExposures = 0;

    const rawCards = imageCaptionIds.map((captionId) => {
      const info = captionsById.get(captionId);
      const tally = talliesByCaption.get(captionId) ?? {
        exposures: 0,
        positive: 0,
        dwells: [],
      };
      totalImageExposures += tally.exposures;
      const ci = computeWilsonConfidenceInterval(tally.positive, tally.exposures);
      if (ci.rate !== null) {
        exposedRates.push(ci.rate);
      }
      return {
        captionId,
        captionText: info?.content?.trim() || "(Empty caption)",
        flavorId: info?.flavorId ?? null,
        flavorKey: getFlavorBucketKey(info?.flavorId ?? null),
        flavorSlug: info?.flavorSlug ?? UNATTRIBUTED_BUCKET_LABEL,
        terminalModelLabel:
          info?.terminalModelName ??
          info?.terminalProviderModelId ??
          "Unattributed",
        exposures: tally.exposures,
        positive: tally.positive,
        rate: ci.rate,
        ciLow: ci.low,
        ciHigh: ci.high,
      };
    });

    const isEvaluatedShared = exposedRates.length >= 2;
    const evaluatedCards = rawCards.filter(
      (card): card is typeof card & { rate: number } => card.rate !== null,
    );
    const distinctEvaluatedFlavorKeys = new Set(
      evaluatedCards.map((card) => card.flavorKey),
    );
    let imageMeanRate: number | null = null;
    if (isEvaluatedShared) {
      if (distinctEvaluatedFlavorKeys.size >= 2) {
        const flavorSums = new Map<string, { sum: number; count: number }>();
        for (const card of evaluatedCards) {
          const entry = flavorSums.get(card.flavorKey) ?? { sum: 0, count: 0 };
          entry.sum += card.rate;
          entry.count += 1;
          flavorSums.set(card.flavorKey, entry);
        }
        let sumOfFlavorMeans = 0;
        for (const entry of flavorSums.values()) {
          sumOfFlavorMeans += entry.sum / entry.count;
        }
        imageMeanRate = sumOfFlavorMeans / flavorSums.size;
      } else {
        imageMeanRate =
          exposedRates.reduce((sum, val) => sum + val, 0) / exposedRates.length;
      }
    }

    let spreadPp: number | null = null;
    if (isEvaluatedShared && imageMeanRate !== null) {
      evaluatedSharedImageCount += 1;
      const maxRate = Math.max(...exposedRates);
      const minRate = Math.min(...exposedRates);
      spreadPp = Number(((maxRate - minRate) * 100).toFixed(4));
      if (maxImageSpreadPp === null || spreadPp > maxImageSpreadPp) {
        maxImageSpreadPp = spreadPp;
      }

      // Accumulate per-flavor same-image lift and pairwise W/L/T records strictly
      // when >= 2 distinct flavor buckets compete on the image; single-flavor
      // multi-caption images sum to zero residual identically and would yield
      // tautological 0.0 pp lift or dilute cross-flavor lift on mixed studies.
      if (distinctEvaluatedFlavorKeys.size >= 2) {
        crossFlavorSharedImageCount += 1;
        for (const card of evaluatedCards) {
          const acc = getLiftAcc(card.flavorKey);
          acc.sharedImages.add(imageId);
          acc.lifts.push(card.rate - imageMeanRate);
          acc.imageMeans.push(imageMeanRate);
        }

        for (let i = 0; i < evaluatedCards.length; i += 1) {
          for (let j = i + 1; j < evaluatedCards.length; j += 1) {
            const left = evaluatedCards[i];
            const right = evaluatedCards[j];
            if (left.flavorKey === right.flavorKey) {
              continue;
            }
            const leftAcc = getLiftAcc(left.flavorKey);
            const rightAcc = getLiftAcc(right.flavorKey);
            const diff = left.rate - right.rate;
            if (Math.abs(diff) <= TIE_EPSILON) {
              leftAcc.ties += 1;
              rightAcc.ties += 1;
            } else if (diff > 0) {
              leftAcc.wins += 1;
              rightAcc.losses += 1;
            } else {
              leftAcc.losses += 1;
              rightAcc.wins += 1;
            }
          }
        }
      }
    }

    const cardsWithLift: SameImageCaptionCardMetric[] = rawCards
      .map((card) => ({
        ...card,
        liftPp:
          card.rate !== null && imageMeanRate !== null
            ? Number(((card.rate - imageMeanRate) * 100).toFixed(4))
            : null,
      }))
      .sort((a, b) => {
        if (a.rate === null && b.rate !== null) return 1;
        if (a.rate !== null && b.rate === null) return -1;
        if (a.rate !== null && b.rate !== null && a.rate !== b.rate) {
          return b.rate - a.rate;
        }
        const aLow = a.ciLow ?? -1;
        const bLow = b.ciLow ?? -1;
        if (aLow !== bLow) {
          return bLow - aLow;
        }
        if (a.exposures !== b.exposures) {
          return b.exposures - a.exposures;
        }
        return a.captionId.localeCompare(b.captionId);
      });

    groups.push({
      imageId,
      imageUrl: firstInfo?.imageUrl ?? null,
      imageDescription: firstInfo?.imageDescription ?? null,
      totalExposures: totalImageExposures,
      imageMeanRate,
      spreadPp,
      captions: cardsWithLift,
    });
  }

  const hasReliableShowdownPair = (group: SameImageComparisonGroup): number => {
    const solidCount = group.captions.filter(
      (card) => card.rate !== null && card.exposures >= MIN_COHORT_VOTERS,
    ).length;
    return solidCount >= 2 ? 1 : 0;
  };

  groups.sort((a, b) => {
    const aReliable = hasReliableShowdownPair(a);
    const bReliable = hasReliableShowdownPair(b);
    if (aReliable !== bReliable) {
      return bReliable - aReliable;
    }
    const aSpread = a.spreadPp ?? -1;
    const bSpread = b.spreadPp ?? -1;
    if (aSpread !== bSpread) {
      return bSpread - aSpread;
    }
    if (a.totalExposures !== b.totalExposures) {
      return b.totalExposures - a.totalExposures;
    }
    return a.imageId.localeCompare(b.imageId);
  });

  const liftByFlavorKey = new Map<string, FlavorLiftSummary>();
  for (const [flavorKey, acc] of liftAccByFlavorKey.entries()) {
    const meanLift =
      acc.lifts.length > 0
        ? acc.lifts.reduce((sum, val) => sum + val, 0) / acc.lifts.length
        : null;
    const imageBaselineMean =
      acc.imageMeans.length > 0
        ? acc.imageMeans.reduce((sum, val) => sum + val, 0) /
          acc.imageMeans.length
        : null;
    const totalPairs = acc.wins + acc.losses + acc.ties;
    liftByFlavorKey.set(flavorKey, {
      sharedImageCount: acc.sharedImages.size,
      imageBaselineMean,
      meanLift,
      meanLiftPp:
        meanLift !== null ? Number((meanLift * 100).toFixed(4)) : null,
      pairWins: acc.wins,
      pairLosses: acc.losses,
      pairTies: acc.ties,
      pairWinRate:
        totalPairs > 0 ? (acc.wins + 0.5 * acc.ties) / totalPairs : null,
    });
  }

  return {
    structuralSharedImageCount,
    evaluatedSharedImageCount,
    crossFlavorSharedImageCount,
    comparableCaptionCount,
    maxImageSpreadPp,
    groups,
    liftByFlavorKey,
  };
}

const KNOWN_SURVEY_QUESTION_LABELS: Readonly<Record<string, string>> = {
  "what is your graduation year": "Graduation year",
  "are you currently living on campus": "Living on campus",
  "are you a transfer student": "Transfer student",
  "which school are you associated with": "School",
  "what is your major": "Major",
  "are you or have you ever been an undergraduate student at columbia":
    "Columbia undergrad",
};

/**
 * Converts a full survey prompt into a concise label suitable for headline
 * badges and summary rows without stripping discriminating context.
 */
export function abbreviateSurveyQuestion(questionText: string): string {
  const collapsed = questionText.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return "Survey question";
  }

  const strippedPunctuation = collapsed.replace(/[?.!]+$/g, "").trim();
  const known = KNOWN_SURVEY_QUESTION_LABELS[strippedPunctuation.toLowerCase()];
  if (known) {
    return known;
  }

  const associatedMatch = /^which\s+(.+?)\s+are you associated with$/i.exec(
    strippedPunctuation,
  );
  const candidate = (
    associatedMatch
      ? associatedMatch[1]
      : strippedPunctuation
          .replace(/^what\s+(?:is|are)\s+your\s+/i, "")
          .replace(/^which\s+/i, "")
          .replace(/^are you currently\s+/i, "")
          .replace(/^are you (?:a|an)\s+/i, "")
          .replace(/^are you\s+/i, "")
          .replace(/^do you\s+/i, "")
  ).trim();

  if (candidate.length === 0) {
    return collapsed;
  }
  return `${candidate[0].toUpperCase()}${candidate.slice(1)}`;
}

/**
 * Selects the headline demographic taste gap, preferring pairs where both
 * segments have at least `minReliableVoters` respondents before falling back
 * to the widest valid `k >= 5` gap.
 */
export function selectHeadlineTasteGap(
  tasteGaps: readonly CohortTasteGapRow[],
  minReliableVoters = RELIABLE_TASTE_GAP_MIN_VOTERS,
): CohortTasteGapRow | null {
  if (tasteGaps.length === 0) {
    return null;
  }
  const reliable = tasteGaps.find(
    (gap) => Math.min(gap.highVoters, gap.lowVoters) >= minReliableVoters,
  );
  return reliable ?? tasteGaps[0];
}

const buildSampleCaptionRecord = ({
  captionId,
  info,
  tally,
}: {
  captionId: string;
  info: CaptionLineageInfo | undefined;
  tally: CaptionExposureTallies;
}): AttributionSampleCaption => {
  const ci = computeWilsonConfidenceInterval(tally.positive, tally.exposures);
  return {
    captionId,
    captionText: info?.content?.trim() || "(Empty caption)",
    imageId: info?.imageId ?? null,
    imageUrl: info?.imageUrl ?? null,
    imageDescription: info?.imageDescription ?? null,
    exposures: tally.exposures,
    positive: tally.positive,
    rate: ci.rate,
    ciLow: ci.low,
    ciHigh: ci.high,
    flavorId: info?.flavorId ?? null,
    flavorSlug: info?.flavorSlug ?? UNATTRIBUTED_BUCKET_LABEL,
    modelName:
      info?.terminalModelName ??
      info?.terminalProviderModelId ??
      "Unattributed",
  };
};

const compareSampleCaptionsTopFirst = (
  left: AttributionSampleCaption,
  right: AttributionSampleCaption,
): number => {
  const leftScored = left.exposures > 0 && left.rate !== null ? 1 : 0;
  const rightScored = right.exposures > 0 && right.rate !== null ? 1 : 0;
  if (leftScored !== rightScored) {
    return rightScored - leftScored;
  }
  const leftLow = left.ciLow ?? -1;
  const rightLow = right.ciLow ?? -1;
  if (leftLow !== rightLow) {
    return rightLow - leftLow;
  }
  const leftRate = left.rate ?? -1;
  const rightRate = right.rate ?? -1;
  if (leftRate !== rightRate) {
    return rightRate - leftRate;
  }
  if (left.exposures !== right.exposures) {
    return right.exposures - left.exposures;
  }
  return left.captionId.localeCompare(right.captionId);
};

const compareSampleCaptionsBottomFirst = (
  left: AttributionSampleCaption,
  right: AttributionSampleCaption,
): number => {
  const leftRate = left.rate ?? Number.POSITIVE_INFINITY;
  const rightRate = right.rate ?? Number.POSITIVE_INFINITY;
  if (leftRate !== rightRate) {
    return leftRate - rightRate;
  }
  const leftHigh = left.ciHigh ?? Number.POSITIVE_INFINITY;
  const rightHigh = right.ciHigh ?? Number.POSITIVE_INFINITY;
  if (leftHigh !== rightHigh) {
    return leftHigh - rightHigh;
  }
  if (left.exposures !== right.exposures) {
    return right.exposures - left.exposures;
  }
  return left.captionId.localeCompare(right.captionId);
};

const selectDrilldownSampleCaptions = (
  candidates: readonly AttributionSampleCaption[],
): {
  topCaptions: AttributionSampleCaption[];
  bottomCaptions: AttributionSampleCaption[];
} => {
  const scored = candidates.filter(
    (item) => item.exposures > 0 && item.rate !== null,
  );
  if (scored.length === 0) {
    const staged = [...candidates]
      .sort((a, b) => a.captionId.localeCompare(b.captionId))
      .slice(0, MAX_STAGED_SAMPLE_CAPTIONS);
    return { topCaptions: staged, bottomCaptions: [] };
  }

  const orderedTop = [...scored].sort(compareSampleCaptionsTopFirst);
  const topLimit = Math.min(
    MAX_TOP_SAMPLE_CAPTIONS,
    Math.ceil(scored.length / 2),
  );
  const topCaptions = orderedTop.slice(0, topLimit);
  if (scored.length < 2) {
    return { topCaptions, bottomCaptions: [] };
  }

  const topIds = new Set(topCaptions.map((item) => item.captionId));
  const bottomCaptions = scored
    .filter((item) => !topIds.has(item.captionId))
    .sort(compareSampleCaptionsBottomFirst)
    .slice(0, MAX_BOTTOM_SAMPLE_CAPTIONS);

  return { topCaptions, bottomCaptions };
};

/**
 * Computes caption-level scored metrics alongside an exact 5-bucket
 * positive-rate distribution (`[0,0.2)`, `[0.2,0.4)`, `[0.4,0.6)`,
 * `[0.6,0.8)`, `[0.8,1.0]`) plus the unrated caption count.
 */
export function buildCaptionMetricsAndHistogram({
  mappedCaptionIds,
  captionsById,
  exposures,
}: {
  mappedCaptionIds: readonly string[];
  captionsById: ReadonlyMap<string, CaptionLineageInfo>;
  exposures: readonly UnifiedExposure[];
}): {
  captionMetrics: AttributionSampleCaption[];
  captionRateHistogram: CaptionRateDistribution;
} {
  const uniqueCaptionIds = Array.from(new Set(mappedCaptionIds));
  const uniqueCaptionIdSet = new Set(uniqueCaptionIds);
  const talliesByCaption = tallyExposuresByCaption(uniqueCaptionIds, exposures);

  const buckets: CaptionRateHistogramBucket[] = [
    { bucketKey: "0-20", label: "0–20%", minPct: 0, maxPct: 20, captionCount: 0 },
    {
      bucketKey: "20-40",
      label: "20–40%",
      minPct: 20,
      maxPct: 40,
      captionCount: 0,
    },
    {
      bucketKey: "40-60",
      label: "40–60%",
      minPct: 40,
      maxPct: 60,
      captionCount: 0,
    },
    {
      bucketKey: "60-80",
      label: "60–80%",
      minPct: 60,
      maxPct: 80,
      captionCount: 0,
    },
    {
      bucketKey: "80-100",
      label: "80–100%",
      minPct: 80,
      maxPct: 100,
      captionCount: 0,
    },
  ];

  let scoredCaptionCount = 0;
  let unratedCaptionCount = 0;
  const captionMetrics: AttributionSampleCaption[] = [];

  for (const [captionId, tally] of talliesByCaption.entries()) {
    if (!uniqueCaptionIdSet.has(captionId)) {
      continue;
    }
    const info = captionsById.get(captionId);
    const record = buildSampleCaptionRecord({ captionId, info, tally });
    captionMetrics.push(record);

    if (
      record.exposures <= 0 ||
      record.rate === null ||
      !Number.isFinite(record.rate)
    ) {
      unratedCaptionCount += 1;
      continue;
    }

    const r = clampUnitInterval(record.rate);
    scoredCaptionCount += 1;
    if (r < 0.2) {
      buckets[0].captionCount += 1;
    } else if (r < 0.4) {
      buckets[1].captionCount += 1;
    } else if (r < 0.6) {
      buckets[2].captionCount += 1;
    } else if (r < 0.8) {
      buckets[3].captionCount += 1;
    } else {
      buckets[4].captionCount += 1;
    }
  }

  captionMetrics.sort(compareSampleCaptionsTopFirst);

  return {
    captionMetrics,
    captionRateHistogram: {
      buckets,
      scoredCaptionCount,
      unratedCaptionCount,
    },
  };
}

const resolveStepDetailsFromInfo = (
  info: CaptionLineageInfo | undefined,
): AttributionPipelineStep[] => {
  if (!info) {
    return [];
  }
  if (info.pipelineStepDetails && info.pipelineStepDetails.length > 0) {
    return info.pipelineStepDetails;
  }
  return info.pipelineSteps.map((modelName, index) => ({
    stepOrder: index + 1,
    modelName,
    providerName:
      index === info.pipelineSteps.length - 1
        ? (info.terminalProviderName ?? null)
        : null,
  }));
};

const compareLeaderboardRowsDefault = (
  left: AttributionLeaderboardRow,
  right: AttributionLeaderboardRow,
): number => {
  // Always pin Unattributed / Manual as the final reconciliation row.
  if (left.isUnattributed !== right.isUnattributed) {
    return left.isUnattributed ? 1 : -1;
  }
  const leftCiLow = left.ciLow ?? -1;
  const rightCiLow = right.ciLow ?? -1;
  if (leftCiLow !== rightCiLow) {
    return rightCiLow - leftCiLow;
  }
  const leftRate = left.rate ?? -1;
  const rightRate = right.rate ?? -1;
  if (leftRate !== rightRate) {
    return rightRate - leftRate;
  }
  if (left.exposures !== right.exposures) {
    return right.exposures - left.exposures;
  }
  return left.label.localeCompare(right.label);
};

export function buildAttributionLeaderboards({
  mappedCaptionIds,
  captionsById,
  exposures,
  sameImage,
}: {
  mappedCaptionIds: readonly string[];
  captionsById: ReadonlyMap<string, CaptionLineageInfo>;
  exposures: readonly UnifiedExposure[];
  sameImage?: SameImageComputationResult;
}): {
  flavors: AttributionLeaderboardRow[];
  models: AttributionLeaderboardRow[];
  pipelines: AttributionLeaderboardRow[];
} {
  const uniqueCaptionIds = Array.from(new Set(mappedCaptionIds));
  const resolvedSameImage =
    sameImage ??
    computeSameImageMetrics({
      mappedCaptionIds: uniqueCaptionIds,
      captionsById,
      exposures,
    });
  const uniqueCaptionIdSet = new Set(uniqueCaptionIds);
  const talliesByCaption = tallyExposuresByCaption(uniqueCaptionIds, exposures);
  const sampleCaptionById = new Map<string, AttributionSampleCaption>();
  const orderedMappedTallies: Array<[string, CaptionExposureTallies]> = [];
  for (const [captionId, tally] of talliesByCaption.entries()) {
    if (!uniqueCaptionIdSet.has(captionId)) {
      continue;
    }
    orderedMappedTallies.push([captionId, tally]);
    const info = captionsById.get(captionId);
    sampleCaptionById.set(
      captionId,
      buildSampleCaptionRecord({ captionId, info, tally }),
    );
  }

  const buildGrouping = (
    mode: "flavor" | "model" | "pipeline",
  ): AttributionLeaderboardRow[] => {
    type MutableGroup = {
      key: string;
      kind: AttributionLeaderboardRow["kind"];
      isUnattributed: boolean;
      flavorId: number | null;
      modelId: number | null;
      label: string;
      subtitle: string | null;
      description: string | null;
      stepCount: number | null;
      pipelineSteps: string[];
      pipelineStepDetails: AttributionPipelineStep[];
      flavorIds: Set<number>;
      flavorSlugs: Set<string>;
      modelCaptionCounts: Map<string, number>;
      captionIds: Set<string>;
      exposures: number;
      positive: number;
      chainLatencies: number[];
      dwells: number[];
    };

    const groups = new Map<string, MutableGroup>();

    for (const [captionId, tally] of orderedMappedTallies) {
      const info = captionsById.get(captionId);

      let key = UNATTRIBUTED_BUCKET_KEY;
      let kind: AttributionLeaderboardRow["kind"] = "unattributed";
      let isUnattributed = true;
      let flavorId: number | null = null;
      let modelId: number | null = null;
      let label = UNATTRIBUTED_BUCKET_LABEL;
      let subtitle: string | null = "Captions without prompt chain lineage";
      let description: string | null = "Captions without prompt chain lineage";
      let stepCount: number | null = null;
      let pipelineSteps: string[] = [];
      let pipelineStepDetails: AttributionPipelineStep[] = [];

      if (
        mode === "flavor" &&
        info?.flavorId !== null &&
        info?.flavorId !== undefined
      ) {
        key = getFlavorBucketKey(info.flavorId);
        kind = "flavor";
        isUnattributed = false;
        flavorId = info.flavorId;
        label = info.flavorSlug ?? `flavor-${info.flavorId}`;
        subtitle = info.flavorDescription;
        description = info.flavorDescription;
        stepCount = info.flavorStepCount;
        pipelineSteps = info.pipelineSteps;
        pipelineStepDetails = resolveStepDetailsFromInfo(info);
      } else if (
        mode === "model" &&
        info?.terminalModelId !== null &&
        info?.terminalModelId !== undefined
      ) {
        key = getModelBucketKey(info.terminalModelId);
        kind = "model";
        isUnattributed = false;
        modelId = info.terminalModelId;
        label =
          info.terminalModelName ??
          info.terminalProviderModelId ??
          `Model #${info.terminalModelId}`;
        subtitle = [info.terminalProviderName, info.terminalProviderModelId]
          .filter(Boolean)
          .join(" · ") || null;
        description = subtitle;
        stepCount = 1;
        pipelineSteps = [label];
        pipelineStepDetails = [
          {
            stepOrder: 1,
            modelName: label,
            providerName: info.terminalProviderName ?? null,
          },
        ];
      } else if (
        mode === "pipeline" &&
        info?.pipelineSignature !== null &&
        info?.pipelineSignature !== undefined
      ) {
        key = getPipelineBucketKey(info.pipelineSignature);
        kind = "pipeline";
        isUnattributed = false;
        label = info.pipelineSignature;
        subtitle = null;
        description = null;
        stepCount = info.pipelineSteps.length;
        pipelineSteps = info.pipelineSteps;
        pipelineStepDetails = resolveStepDetailsFromInfo(info);
      }

      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          kind,
          isUnattributed,
          flavorId,
          modelId,
          label,
          subtitle,
          description,
          stepCount,
          pipelineSteps,
          pipelineStepDetails,
          flavorIds: new Set<number>(),
          flavorSlugs: new Set<string>(),
          modelCaptionCounts: new Map<string, number>(),
          captionIds: new Set<string>(),
          exposures: 0,
          positive: 0,
          chainLatencies: [],
          dwells: [],
        };
        groups.set(key, group);
      } else if (
        group.pipelineStepDetails.length === 0 &&
        pipelineStepDetails.length > 0
      ) {
        group.pipelineStepDetails = pipelineStepDetails;
        group.pipelineSteps = pipelineSteps;
        if (group.stepCount === null || group.stepCount === 0) {
          group.stepCount = stepCount;
        }
      }

      group.captionIds.add(captionId);
      group.exposures += tally.exposures;
      group.positive += tally.positive;
      for (const d of tally.dwells) {
        group.dwells.push(d);
      }
      if (info?.flavorId !== null && info?.flavorId !== undefined) {
        group.flavorIds.add(info.flavorId);
      }
      if (info?.flavorSlug) {
        group.flavorSlugs.add(info.flavorSlug);
      }
      if (info?.terminalModelName) {
        group.modelCaptionCounts.set(
          info.terminalModelName,
          (group.modelCaptionCounts.get(info.terminalModelName) ?? 0) + 1,
        );
      }
      if (
        info?.chainLatencySeconds !== null &&
        info?.chainLatencySeconds !== undefined
      ) {
        group.chainLatencies.push(info.chainLatencySeconds);
      }
    }

    const rows: AttributionLeaderboardRow[] = [];
    for (const group of groups.values()) {
      const ci = computeWilsonConfidenceInterval(
        group.positive,
        group.exposures,
      );
      const lift =
        mode === "flavor"
          ? resolvedSameImage.liftByFlavorKey.get(group.key)
          : undefined;

      let dominantModelLabel: string | null = null;
      if (group.modelCaptionCounts.size === 1) {
        dominantModelLabel = Array.from(group.modelCaptionCounts.keys())[0];
      } else if (group.modelCaptionCounts.size > 1) {
        const sortedModels = Array.from(group.modelCaptionCounts.entries()).sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        );
        dominantModelLabel = `${sortedModels[0][0]} (+${sortedModels.length - 1})`;
      }

      const subtitle =
        mode === "pipeline" && !group.isUnattributed
          ? `${group.flavorIds.size} ${group.flavorIds.size === 1 ? "flavor" : "flavors"}`
          : group.subtitle;
      const orderedFlavorSlugs = Array.from(group.flavorSlugs).sort((a, b) =>
        a.localeCompare(b),
      );
      const description =
        mode === "pipeline" && !group.isUnattributed
          ? orderedFlavorSlugs.length > 0
            ? `Prompt flavors running this pipeline: ${orderedFlavorSlugs.join(", ")}`
            : subtitle
          : mode === "model" && !group.isUnattributed && orderedFlavorSlugs.length > 0
            ? [
                group.description,
                `Prompt flavors: ${orderedFlavorSlugs.join(", ")}`,
              ]
                .filter(Boolean)
                .join(" · ")
            : group.description;

      const groupCaptions: AttributionSampleCaption[] = [];
      for (const captionId of group.captionIds) {
        const sample = sampleCaptionById.get(captionId);
        if (sample) {
          groupCaptions.push(sample);
        }
      }
      const { topCaptions, bottomCaptions } =
        selectDrilldownSampleCaptions(groupCaptions);

      rows.push({
        key: group.key,
        kind: group.kind,
        isUnattributed: group.isUnattributed,
        flavorId: group.flavorId,
        modelId: group.modelId,
        label: group.label,
        subtitle,
        description,
        stepCount: group.stepCount,
        dominantModelLabel,
        pipelineSteps: group.pipelineSteps,
        pipelineStepDetails: group.pipelineStepDetails,
        topCaptions,
        bottomCaptions,
        flavorCount: group.flavorIds.size,
        captionCount: group.captionIds.size,
        exposures: group.exposures,
        positive: group.positive,
        rate: ci.rate,
        ciLow: ci.low,
        ciHigh: ci.high,
        sharedImageCount: lift?.sharedImageCount ?? 0,
        imageBaselineMean: lift?.imageBaselineMean ?? null,
        meanLift: lift?.meanLift ?? null,
        meanLiftPp: lift?.meanLiftPp ?? null,
        pairWins: lift?.pairWins ?? 0,
        pairLosses: lift?.pairLosses ?? 0,
        pairTies: lift?.pairTies ?? 0,
        pairWinRate: lift?.pairWinRate ?? null,
        medianChainSeconds: computeMedian(group.chainLatencies),
        medianDwellMs: computeMedian(group.dwells),
      });
    }

    rows.sort(compareLeaderboardRowsDefault);
    return rows;
  };

  return {
    flavors: buildGrouping("flavor"),
    models: buildGrouping("model"),
    pipelines: buildGrouping("pipeline"),
  };
}

type RawCellAccumulator = {
  voters: Set<string>;
  exposures: number;
  positive: number;
};

const makeEmptyAccumulator = (): RawCellAccumulator => ({
  voters: new Set<string>(),
  exposures: 0,
  positive: 0,
});

const finalizeCohortCell = ({
  flavorKey,
  accumulator,
  baselineRate,
}: {
  flavorKey: string;
  accumulator: RawCellAccumulator | undefined;
  baselineRate: number | null;
}): CohortFlavorCell => {
  if (!accumulator || accumulator.voters.size === 0 || accumulator.exposures === 0) {
    return { status: "empty" };
  }
  if (accumulator.voters.size < MIN_COHORT_VOTERS) {
    return { status: "suppressed" };
  }
  const ci = computeWilsonConfidenceInterval(
    accumulator.positive,
    accumulator.exposures,
  );
  const rate = ci.rate ?? 0;
  const deltaPp =
    baselineRate !== null
      ? Number(((rate - baselineRate) * 100).toFixed(4))
      : 0;
  return {
    status: "visible",
    flavorKey,
    distinctVoters: accumulator.voters.size,
    exposures: accumulator.exposures,
    positive: accumulator.positive,
    rate,
    ciLow: ci.low ?? 0,
    ciHigh: ci.high ?? 1,
    deltaPp,
  };
};

export function buildDemographicCohortMatrices({
  exposures,
  captionsById,
  flavorRows,
  questions,
  answers,
  mappings,
  responses,
}: {
  exposures: readonly UnifiedExposure[];
  captionsById: ReadonlyMap<string, CaptionLineageInfo>;
  flavorRows: readonly AttributionLeaderboardRow[];
  questions: readonly RawDemographicQuestionRow[];
  answers: readonly RawDemographicAnswerRow[];
  mappings: readonly RawDemographicMappingRow[];
  responses: readonly RawDemographicUserResponseRow[];
}): DemographicMatrixBundle {
  const activeMappings = mappings.filter((m) => !m.is_deleted);
  const mappingsById = new Map(activeMappings.map((m) => [m.id, m]));
  const answersById = new Map(answers.map((a) => [a.id, a]));
  const canonicalByUser = canonicalizeDemographicResponses({
    responses,
    mappingsById,
  });

  const studyVoters = new Set<string>();
  const studyPositiveTotal = exposures.reduce((sum, exp) => {
    studyVoters.add(exp.profileId);
    return sum + (exp.isPositive ? 1 : 0);
  }, 0);
  const studyOverallRate =
    exposures.length > 0 ? studyPositiveTotal / exposures.length : null;

  let surveyedVoterCount = 0;
  for (const voterId of studyVoters) {
    const answered = canonicalByUser.get(voterId);
    if (answered && answered.size > 0) {
      surveyedVoterCount += 1;
    }
  }

  // Order flavor columns consistently with the empirical leaderboard (excluding empty unattributed).
  const flavorColumns: DemographicFlavorColumn[] = flavorRows
    .filter((row) => row.exposures > 0 && !row.isUnattributed)
    .map((row) => ({
      flavorKey: row.key,
      flavorId: row.flavorId,
      flavorSlug: row.label,
      studyRate: row.rate,
      studyExposures: row.exposures,
    }));

  const flavorRateByKey = new Map(
    flavorColumns.map((col) => [col.flavorKey, col.studyRate]),
  );

  // Pre-group each voter's study exposures once so building all 6 question
  // matrices runs in O(Q * E) with a single pass over participants per question.
  const exposuresByVoter = new Map<string, UnifiedExposure[]>();
  for (const exposure of exposures) {
    let list = exposuresByVoter.get(exposure.profileId);
    if (!list) {
      list = [];
      exposuresByVoter.set(exposure.profileId, list);
    }
    list.push(exposure);
  }

  const mappingsByQuestion = new Map<number, RawDemographicMappingRow[]>();
  for (const mapping of activeMappings) {
    let list = mappingsByQuestion.get(mapping.question_id);
    if (!list) {
      list = [];
      mappingsByQuestion.set(mapping.question_id, list);
    }
    list.push(mapping);
  }
  for (const list of mappingsByQuestion.values()) {
    list.sort((a, b) => {
      const aOrd = a.display_order ?? Number.MAX_SAFE_INTEGER;
      const bOrd = b.display_order ?? Number.MAX_SAFE_INTEGER;
      if (aOrd !== bOrd) {
        return aOrd - bOrd;
      }
      return a.id - b.id;
    });
  }

  const orderedQuestions = [...questions].sort((a, b) => a.id - b.id);
  const questionMatrices: DemographicQuestionMatrix[] = [];
  const tasteGaps: CohortTasteGapRow[] = [];
  let totalVisibleSegments = 0;
  let totalMaskedSegments = 0;

  for (const question of orderedQuestions) {
    const qMappings = mappingsByQuestion.get(question.id) ?? [];

    type CohortBucket = {
      overall: RawCellAccumulator;
      byFlavor: Map<string, RawCellAccumulator>;
    };
    const answerBuckets = new Map<number, CohortBucket>();
    const unsurveyedBucket: CohortBucket = {
      overall: makeEmptyAccumulator(),
      byFlavor: new Map(),
    };

    const addVoterToBucket = (bucket: CohortBucket, voterId: string) => {
      const voterExposures = exposuresByVoter.get(voterId) ?? [];
      for (const exp of voterExposures) {
        bucket.overall.voters.add(voterId);
        bucket.overall.exposures += 1;
        if (exp.isPositive) {
          bucket.overall.positive += 1;
        }

        const capInfo = captionsById.get(exp.captionId);
        const fKey = getFlavorBucketKey(capInfo?.flavorId ?? null);
        if (!flavorRateByKey.has(fKey)) {
          continue;
        }
        let cell = bucket.byFlavor.get(fKey);
        if (!cell) {
          cell = makeEmptyAccumulator();
          bucket.byFlavor.set(fKey, cell);
        }
        cell.voters.add(voterId);
        cell.exposures += 1;
        if (exp.isPositive) {
          cell.positive += 1;
        }
      }
    };

    let surveyedRespondentCount = 0;
    let unsurveyedVoterCount = 0;

    for (const voterId of studyVoters) {
      const canonical = canonicalByUser.get(voterId)?.get(question.id);
      if (!canonical) {
        unsurveyedVoterCount += 1;
        addVoterToBucket(unsurveyedBucket, voterId);
        continue;
      }
      surveyedRespondentCount += 1;
      let bucket = answerBuckets.get(canonical.answerId);
      if (!bucket) {
        bucket = { overall: makeEmptyAccumulator(), byFlavor: new Map() };
        answerBuckets.set(canonical.answerId, bucket);
      }
      addVoterToBucket(bucket, voterId);
    }

    // Preserve mapped display order while ensuring any observed answer is represented once.
    const seenAnswerIds = new Set<number>();
    const orderedAnswerIds: number[] = [];
    for (const m of qMappings) {
      if (!seenAnswerIds.has(m.answer_id)) {
        seenAnswerIds.add(m.answer_id);
        orderedAnswerIds.push(m.answer_id);
      }
    }
    for (const answerId of answerBuckets.keys()) {
      if (!seenAnswerIds.has(answerId)) {
        seenAnswerIds.add(answerId);
        orderedAnswerIds.push(answerId);
      }
    }

    const visibleRows: DemographicCohortRow[] = [];
    const maskedPoolBucket: CohortBucket = {
      overall: makeEmptyAccumulator(),
      byFlavor: new Map(),
    };
    let maskedOptionCount = 0;

    const mergeIntoMaskedPool = (src: CohortBucket) => {
      for (const voterId of src.overall.voters) {
        maskedPoolBucket.overall.voters.add(voterId);
      }
      maskedPoolBucket.overall.exposures += src.overall.exposures;
      maskedPoolBucket.overall.positive += src.overall.positive;

      for (const [fKey, srcCell] of src.byFlavor.entries()) {
        let dst = maskedPoolBucket.byFlavor.get(fKey);
        if (!dst) {
          dst = makeEmptyAccumulator();
          maskedPoolBucket.byFlavor.set(fKey, dst);
        }
        for (const voterId of srcCell.voters) {
          dst.voters.add(voterId);
        }
        dst.exposures += srcCell.exposures;
        dst.positive += srcCell.positive;
      }
    };

    const buildRowCells = (
      bucket: CohortBucket,
    ): Record<string, CohortFlavorCell> => {
      const cells: Record<string, CohortFlavorCell> = {};
      for (const col of flavorColumns) {
        cells[col.flavorKey] = finalizeCohortCell({
          flavorKey: col.flavorKey,
          accumulator: bucket.byFlavor.get(col.flavorKey),
          baselineRate: col.studyRate,
        });
      }
      return cells;
    };

    for (const answerId of orderedAnswerIds) {
      const bucket = answerBuckets.get(answerId);
      const voterCount = bucket?.overall.voters.size ?? 0;
      if (!bucket || voterCount === 0) {
        continue;
      }
      if (voterCount < MIN_COHORT_VOTERS) {
        maskedOptionCount += 1;
        mergeIntoMaskedPool(bucket);
        continue;
      }

      const answerText =
        answersById.get(answerId)?.answer ?? `Option #${answerId}`;
      visibleRows.push({
        rowKey: `q${question.id}-a${answerId}`,
        rowKind: "answer",
        answerId,
        label: answerText,
        pooledOptionCount: 0,
        distinctVoters: voterCount,
        overallCell: finalizeCohortCell({
          flavorKey: "__overall__",
          accumulator: bucket.overall,
          baselineRate: studyOverallRate,
        }),
        cellsByFlavorKey: buildRowCells(bucket),
      });
    }

    const disclosedAnswerVoterSum = visibleRows.reduce(
      (sum, row) => sum + (row.distinctVoters ?? 0),
      0,
    );
    const pooledVoters = maskedPoolBucket.overall.voters.size;
    const totalStudyVoters = studyVoters.size;
    const skippedSurveyedVoters = Math.max(
      0,
      surveyedVoterCount - surveyedRespondentCount,
    );
    const showPooledVoters =
      pooledVoters >= MIN_COHORT_VOTERS &&
      !(
        totalStudyVoters - (disclosedAnswerVoterSum + pooledVoters) > 0 &&
        totalStudyVoters - (disclosedAnswerVoterSum + pooledVoters) <
          MIN_COHORT_VOTERS
      ) &&
      !(
        surveyedVoterCount >= MIN_COHORT_VOTERS &&
        surveyedVoterCount - (disclosedAnswerVoterSum + pooledVoters) > 0 &&
        surveyedVoterCount - (disclosedAnswerVoterSum + pooledVoters) <
          MIN_COHORT_VOTERS
      );
    const disclosedSurveyedRowVoters =
      disclosedAnswerVoterSum + (showPooledVoters ? pooledVoters : 0);
    const coarsenVoterCounts =
      (totalStudyVoters - disclosedSurveyedRowVoters > 0 &&
        totalStudyVoters - disclosedSurveyedRowVoters < MIN_COHORT_VOTERS) ||
      (surveyedVoterCount >= MIN_COHORT_VOTERS &&
        surveyedVoterCount - disclosedSurveyedRowVoters > 0 &&
        surveyedVoterCount - disclosedSurveyedRowVoters < MIN_COHORT_VOTERS);
    const hideUnsurveyedCount =
      (pooledVoters > 0 && pooledVoters < MIN_COHORT_VOTERS) ||
      (skippedSurveyedVoters > 0 && skippedSurveyedVoters < MIN_COHORT_VOTERS) ||
      (unsurveyedVoterCount > 0 && unsurveyedVoterCount < MIN_COHORT_VOTERS) ||
      (totalStudyVoters - surveyedVoterCount > 0 &&
        totalStudyVoters - surveyedVoterCount < MIN_COHORT_VOTERS) ||
      coarsenVoterCounts ||
      (pooledVoters >= MIN_COHORT_VOTERS && !showPooledVoters);

    const finalRows: DemographicCohortRow[] = [...visibleRows];
    if (maskedOptionCount > 0) {
      finalRows.push({
        rowKey: `q${question.id}-masked`,
        rowKind: "masked_pool",
        answerId: null,
        label: "Small cohorts (n < 5)",
        pooledOptionCount: maskedOptionCount,
        // Omit pooled voter count when < 5 or when row-sum subtraction isolates 1..4 voters.
        distinctVoters: showPooledVoters ? pooledVoters : null,
        overallCell: finalizeCohortCell({
          flavorKey: "__overall__",
          accumulator: maskedPoolBucket.overall,
          baselineRate: studyOverallRate,
        }),
        cellsByFlavorKey: buildRowCells(maskedPoolBucket),
      });
    }

    if (unsurveyedVoterCount >= MIN_COHORT_VOTERS) {
      finalRows.push({
        rowKey: `q${question.id}-unsurveyed`,
        rowKind: "unsurveyed",
        answerId: null,
        label: "No survey response on file",
        pooledOptionCount: 0,
        distinctVoters: unsurveyedVoterCount,
        overallCell: finalizeCohortCell({
          flavorKey: "__overall__",
          accumulator: unsurveyedBucket.overall,
          baselineRate: studyOverallRate,
        }),
        cellsByFlavorKey: buildRowCells(unsurveyedBucket),
      });
    }

    // Apply secondary column suppression (preferring unsurveyed, then masked_pool, then smallest answer).
    const rowMaskPriority = (kind: DemographicCohortRow["rowKind"]): number => {
      if (kind === "unsurveyed") return 0;
      if (kind === "masked_pool") return 1;
      return 2;
    };

    const totalColumnVotersByKey = new Map<string, number>();
    totalColumnVotersByKey.set("__overall__", studyVoters.size);
    for (const col of flavorColumns) {
      let colVoters =
        (maskedPoolBucket.byFlavor.get(col.flavorKey)?.voters.size ?? 0) +
        (unsurveyedBucket.byFlavor.get(col.flavorKey)?.voters.size ?? 0);
      for (const row of visibleRows) {
        if (row.answerId !== null) {
          colVoters +=
            answerBuckets.get(row.answerId)?.byFlavor.get(col.flavorKey)?.voters
              .size ?? 0;
        }
      }
      totalColumnVotersByKey.set(col.flavorKey, colVoters);
    }

    for (const [colKey, totalColVoters] of totalColumnVotersByKey.entries()) {
      while (true) {
        let disclosedColVoters = 0;
        let victimIdx = -1;
        let victimVoters = Number.POSITIVE_INFINITY;
        let victimPriority = Number.POSITIVE_INFINITY;
        let victimExposures = Number.POSITIVE_INFINITY;

        for (let idx = 0; idx < finalRows.length; idx += 1) {
          const row = finalRows[idx];
          const cell =
            colKey === "__overall__"
              ? row.overallCell
              : row.cellsByFlavorKey[colKey];
          if (cell?.status !== "visible") {
            continue;
          }
          disclosedColVoters += cell.distinctVoters;
          const prio = rowMaskPriority(row.rowKind);
          if (
            prio < victimPriority ||
            (prio === victimPriority && cell.distinctVoters < victimVoters) ||
            (prio === victimPriority &&
              cell.distinctVoters === victimVoters &&
              cell.exposures < victimExposures)
          ) {
            victimIdx = idx;
            victimVoters = cell.distinctVoters;
            victimPriority = prio;
            victimExposures = cell.exposures;
          }
        }

        const hiddenColVoters = totalColVoters - disclosedColVoters;
        if (
          hiddenColVoters <= 0 ||
          hiddenColVoters >= MIN_COHORT_VOTERS ||
          victimIdx < 0
        ) {
          break;
        }

        const targetRow = finalRows[victimIdx];
        if (colKey === "__overall__") {
          finalRows[victimIdx] = {
            ...targetRow,
            overallCell: { status: "suppressed", reason: "complementary" },
          };
        } else {
          finalRows[victimIdx] = {
            ...targetRow,
            cellsByFlavorKey: {
              ...targetRow.cellsByFlavorKey,
              [colKey]: { status: "suppressed", reason: "complementary" },
            },
          };
        }
      }
    }

    // Compute largest segment taste gaps strictly across visible named answer rows after complementary suppression.
    const postSuppressionAnswerRows = finalRows.filter(
      (row) => row.rowKind === "answer",
    );
    for (const col of flavorColumns) {
      const eligible = postSuppressionAnswerRows
        .map((row) => ({
          label: row.label,
          cell: row.cellsByFlavorKey[col.flavorKey],
        }))
        .filter(
          (
            item,
          ): item is {
            label: string;
            cell: Extract<CohortFlavorCell, { status: "visible" }>;
          } => item.cell?.status === "visible",
        );

      if (eligible.length < 2) {
        continue;
      }

      eligible.sort(
        (a, b) => b.cell.rate - a.cell.rate || a.label.localeCompare(b.label),
      );
      const highest = eligible[0];
      const lowest = eligible[eligible.length - 1];
      const spreadPp = Number(
        ((highest.cell.rate - lowest.cell.rate) * 100).toFixed(4),
      );
      if (spreadPp > 0) {
        tasteGaps.push({
          questionId: question.id,
          questionText: question.question,
          questionLabel: abbreviateSurveyQuestion(question.question),
          flavorId: col.flavorId,
          flavorKey: col.flavorKey,
          flavorSlug: col.flavorSlug,
          highAnswerLabel: highest.label,
          highRate: highest.cell.rate,
          highVoters: highest.cell.distinctVoters,
          lowAnswerLabel: lowest.label,
          lowRate: lowest.cell.rate,
          lowVoters: lowest.cell.distinctVoters,
          coarsenVoters: coarsenVoterCounts,
          spreadPp,
        });
      }
    }

    const postSuppressionVisibleCount = postSuppressionAnswerRows.filter(
      (row) =>
        row.overallCell.status === "visible" ||
        Object.values(row.cellsByFlavorKey).some((c) => c.status === "visible"),
    ).length;
    totalVisibleSegments += postSuppressionVisibleCount;
    totalMaskedSegments +=
      maskedOptionCount + (visibleRows.length - postSuppressionVisibleCount);

    questionMatrices.push({
      questionId: question.id,
      questionText: question.question,
      surveyedRespondentCount,
      unsurveyedVoterCount,
      studySurveyedVoterCount: surveyedVoterCount,
      coarsenVoterCounts,
      hideUnsurveyedCount,
      visibleSegmentCount: postSuppressionVisibleCount,
      maskedSegmentCount:
        maskedOptionCount + (visibleRows.length - postSuppressionVisibleCount),
      rows: finalRows,
    });
  }

  tasteGaps.sort((a, b) => {
    if (a.spreadPp !== b.spreadPp) {
      return b.spreadPp - a.spreadPp;
    }
    if (a.questionId !== b.questionId) {
      return a.questionId - b.questionId;
    }
    return a.flavorSlug.localeCompare(b.flavorSlug);
  });

  return {
    studyVoterCount: studyVoters.size,
    surveyedVoterCount,
    totalVisibleSegments,
    totalMaskedSegments,
    flavorColumns,
    questions: questionMatrices,
    tasteGaps,
  };
}
