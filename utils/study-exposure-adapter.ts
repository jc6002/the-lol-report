import type { Json } from "@/src/types/supabase";
import {
  getStudyVoteSign,
  isPositiveStudyVote,
  type StudyVoteValue,
} from "@/utils/study-vote-events";

export const NEW_STYLE_MIN_STUDY_ID = 7;
export const MIN_RATER_QUALITY_EXPOSURES = 10;
export const SWIPE_FAST_MEDIAN_MS = 600;
export const SWIPE_FAST_SKIP_ALL_MEDIAN_MS = 1200;
export const LIKERT_FAST_MEDIAN_MS = 600;
export const LIKERT_FAST_INTER_VOTE_GAP_MS = 1000;
export const LIKERT_DELIBERATE_MEDIAN_MS = 1500;

const MS_PER_MINUTE = 60_000;

export type StudyExposureMode = "likert_votes" | "swipe_navigation";

export type ResolvedExposureMode = {
  mode: StudyExposureMode;
  isTransitionalLikert: boolean;
  detailHref: string;
  exposureUnitLabel: "seen cards" | "votes";
};

export type RawStudyMappingRow = {
  id: number;
  study_id: number;
  caption_id: string;
};

export type RawStudyVoteRow = {
  id: number;
  profile_id: string;
  caption_id: string;
  study_caption_mapping_id: number | null;
  vote_value: StudyVoteValue;
  time_to_vote_ms: number | null;
  session_id: string | null;
  created_datetime_utc: string;
};

export type RawStudyNavigationRow = {
  id: number;
  profile_id: string;
  caption_id: string;
  study_caption_mapping_id: number | null;
  time_to_next_caption_ms: number | null;
  session_id: string | null;
  created_datetime_utc: string;
};

export type RawStudyParticipationRow = {
  profile_id: string;
  study_id: number;
  started_at: string;
  ended_at: string | null;
  completion_stats: Json | null;
};

export type UnifiedExposure = {
  profileId: string;
  mappingId: number;
  captionId: string;
  isPositive: boolean;
  dwellMs: number | null;
  firstSeenUtc: string;
  firstEventId: number;
};

export type RaterQualityDiagnostic = {
  profileId: string;
  exposureCount: number;
  positiveCount: number;
  medianDwellMs: number | null;
  medianInterVoteGapMs: number | null;
  switchRate: number | null;
  isHighRisk: boolean;
  reasons: string[];
};

export type RetentionStepPoint = {
  captionPosition: number;
  activeUsers: number;
  activeSharePct: number;
  droppedUsers: number;
};

export type StudyParticipationFunnel = {
  participationsStarted: number;
  participationsEnded: number;
  completionRate: number | null;
  medianRunMinutes: number | null;
  distinctVoters: number;
  judgedAtLeastOneCount: number;
  retentionCurve: RetentionStepPoint[];
};

export type AdaptedStudyExposures = {
  studyId: number;
  mode: StudyExposureMode;
  isTransitionalLikert: boolean;
  detailHref: string;
  exposureUnitLabel: "seen cards" | "votes";
  exposures: UnifiedExposure[];
  allExposureCount: number;
  allPositiveCount: number;
  totalExposures: number;
  totalPositive: number;
  distinctVoters: number;
  medianStudyDwellMs: number | null;
  highRiskProfileIds: Set<string>;
  highRiskVoterCount: number;
  excludedVoterCount: number;
  excludedExposureCount: number;
  userDiagnostics: Map<string, RaterQualityDiagnostic>;
  reconciliation: {
    rawNavigationEventCount: number;
    rawVoteEventCount: number;
    timedVoteCount: number;
    untimedVoteCount: number;
  };
};

const computeMedianValue = (values: readonly number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const parseEpochMs = (isoUtc: string): number | null => {
  const parsed = Date.parse(isoUtc);
  return Number.isFinite(parsed) ? parsed : null;
};

const compareEventsChronologically = <
  TEvent extends { id: number; created_datetime_utc: string },
>(
  left: TEvent,
  right: TEvent,
): number => {
  const leftMs = parseEpochMs(left.created_datetime_utc);
  const rightMs = parseEpochMs(right.created_datetime_utc);
  if (leftMs !== null && rightMs !== null && leftMs !== rightMs) {
    return leftMs - rightMs;
  }
  if (left.created_datetime_utc !== right.created_datetime_utc) {
    return left.created_datetime_utc < right.created_datetime_utc ? -1 : 1;
  }
  return left.id - right.id;
};

export function resolveStudyExposureMode({
  studyId,
  hasNavigationEvents,
  hasVoteEvents,
}: {
  studyId: number;
  hasNavigationEvents: boolean;
  hasVoteEvents: boolean;
}): ResolvedExposureMode {
  if (studyId < NEW_STYLE_MIN_STUDY_ID) {
    return {
      mode: "likert_votes",
      isTransitionalLikert: false,
      detailHref: `/study/${studyId}/study-detail`,
      exposureUnitLabel: "votes",
    };
  }

  // Studies 7..21 collected 163,927 6-point Likert votes before navigation
  // event tracking launched at Study 22. Routing them through Likert vote
  // exposures preserves their full empirical dataset and reconciles cleanly
  // with study-detail and user-upvote-rate.
  if (!hasNavigationEvents && hasVoteEvents) {
    return {
      mode: "likert_votes",
      isTransitionalLikert: true,
      detailHref: `/study/${studyId}/study-detail`,
      exposureUnitLabel: "votes",
    };
  }

  return {
    mode: "swipe_navigation",
    isTransitionalLikert: false,
    detailHref: `/study/${studyId}/new-style-report`,
    exposureUnitLabel: "seen cards",
  };
}

export function getSwipeEventMatchKey(event: {
  profile_id: string;
  study_caption_mapping_id: number;
  session_id: string | null;
}): string {
  return `${event.profile_id}|${event.study_caption_mapping_id}|${event.session_id ?? "no-session"}`;
}

export function adaptStudyExposures({
  studyId,
  voteRows,
  navigationRows,
  excludeHighRisk = false,
}: {
  studyId: number;
  voteRows: readonly RawStudyVoteRow[];
  navigationRows: readonly RawStudyNavigationRow[];
  excludeHighRisk?: boolean;
}): AdaptedStudyExposures {
  const validVotes = voteRows.filter(
    (
      row,
    ): row is RawStudyVoteRow & { study_caption_mapping_id: number } =>
      row.study_caption_mapping_id !== null,
  );
  const validNavs = navigationRows.filter(
    (
      row,
    ): row is RawStudyNavigationRow & { study_caption_mapping_id: number } =>
      row.study_caption_mapping_id !== null,
  );

  const resolved = resolveStudyExposureMode({
    studyId,
    hasNavigationEvents: validNavs.length > 0,
    hasVoteEvents: validVotes.length > 0,
  });

  if (resolved.mode === "swipe_navigation") {
    return adaptSwipeExposures({
      studyId,
      resolved,
      validVotes,
      validNavs,
      rawVoteCount: voteRows.length,
      rawNavCount: navigationRows.length,
      excludeHighRisk,
    });
  }

  return adaptLikertExposures({
    studyId,
    resolved,
    validVotes,
    rawVoteCount: voteRows.length,
    rawNavCount: navigationRows.length,
    excludeHighRisk,
  });
}

function adaptSwipeExposures({
  studyId,
  resolved,
  validVotes,
  validNavs,
  rawVoteCount,
  rawNavCount,
  excludeHighRisk,
}: {
  studyId: number;
  resolved: ResolvedExposureMode;
  validVotes: Array<RawStudyVoteRow & { study_caption_mapping_id: number }>;
  validNavs: Array<RawStudyNavigationRow & { study_caption_mapping_id: number }>;
  rawVoteCount: number;
  rawNavCount: number;
  excludeHighRisk: boolean;
}): AdaptedStudyExposures {
  const sortedNavs = [...validNavs].sort(compareEventsChronologically);
  const sortedVotes = [...validVotes].sort(compareEventsChronologically);
  const likeKeys = new Set<string>();
  const likePairKeys = new Set<string>();
  const positiveVoteByPairKey = new Map<
    string,
    RawStudyVoteRow & { study_caption_mapping_id: number }
  >();
  for (const vote of sortedVotes) {
    if (!isPositiveStudyVote(vote.vote_value)) {
      continue;
    }
    likeKeys.add(getSwipeEventMatchKey(vote));
    const pairKey = `${vote.profile_id}|${vote.study_caption_mapping_id}`;
    likePairKeys.add(pairKey);
    if (!positiveVoteByPairKey.has(pairKey)) {
      positiveVoteByPairKey.set(pairKey, vote);
    }
  }

  type MutableExposure = UnifiedExposure & { dwellSamples: number[] };
  const exposureByPairKey = new Map<string, MutableExposure>();
  const userNavDwells = new Map<string, number[]>();

  for (const nav of sortedNavs) {
    const pairKey = `${nav.profile_id}|${nav.study_caption_mapping_id}`;
    const matchedLike =
      likeKeys.has(getSwipeEventMatchKey(nav)) || likePairKeys.has(pairKey);
    const validDwell =
      nav.time_to_next_caption_ms !== null && nav.time_to_next_caption_ms >= 0
        ? nav.time_to_next_caption_ms
        : null;

    if (validDwell !== null) {
      let arr = userNavDwells.get(nav.profile_id);
      if (!arr) {
        arr = [];
        userNavDwells.set(nav.profile_id, arr);
      }
      arr.push(validDwell);
    }

    const existing = exposureByPairKey.get(pairKey);
    if (!existing) {
      exposureByPairKey.set(pairKey, {
        profileId: nav.profile_id,
        mappingId: nav.study_caption_mapping_id,
        captionId: nav.caption_id,
        isPositive: matchedLike,
        dwellMs: validDwell,
        firstSeenUtc: nav.created_datetime_utc,
        firstEventId: nav.id,
        dwellSamples: validDwell !== null ? [validDwell] : [],
      });
    } else {
      if (matchedLike) {
        existing.isPositive = true;
      }
      if (validDwell !== null) {
        existing.dwellSamples.push(validDwell);
      }
    }
  }

  // Synthesize seen+liked exposures for positive votes whose mapping lacks a navigation row.
  for (const [pairKey, vote] of positiveVoteByPairKey.entries()) {
    if (exposureByPairKey.has(pairKey)) {
      continue;
    }
    const validVoteDwell =
      vote.time_to_vote_ms !== null && vote.time_to_vote_ms >= 0
        ? vote.time_to_vote_ms
        : null;
    exposureByPairKey.set(pairKey, {
      profileId: vote.profile_id,
      mappingId: vote.study_caption_mapping_id,
      captionId: vote.caption_id,
      isPositive: true,
      dwellMs: validVoteDwell,
      firstSeenUtc: vote.created_datetime_utc,
      firstEventId: vote.id,
      dwellSamples: validVoteDwell !== null ? [validVoteDwell] : [],
    });
  }

  const allExposures: UnifiedExposure[] = [];
  const exposuresByUser = new Map<string, UnifiedExposure[]>();
  let allPositiveCount = 0;

  for (const mutable of exposureByPairKey.values()) {
    const finalized: UnifiedExposure = {
      profileId: mutable.profileId,
      mappingId: mutable.mappingId,
      captionId: mutable.captionId,
      isPositive: mutable.isPositive,
      dwellMs: computeMedianValue(mutable.dwellSamples),
      firstSeenUtc: mutable.firstSeenUtc,
      firstEventId: mutable.firstEventId,
    };
    allExposures.push(finalized);
    if (finalized.isPositive) {
      allPositiveCount += 1;
    }
    let list = exposuresByUser.get(finalized.profileId);
    if (!list) {
      list = [];
      exposuresByUser.set(finalized.profileId, list);
    }
    list.push(finalized);
  }

  const userDiagnostics = new Map<string, RaterQualityDiagnostic>();
  const highRiskProfileIds = new Set<string>();

  for (const [profileId, userExposures] of exposuresByUser.entries()) {
    const exposureCount = userExposures.length;
    const positiveCount = userExposures.reduce(
      (sum, item) => sum + (item.isPositive ? 1 : 0),
      0,
    );
    const medianDwellMs = computeMedianValue(userNavDwells.get(profileId) ?? []);
    const reasons: string[] = [];

    if (exposureCount >= MIN_RATER_QUALITY_EXPOSURES) {
      if (medianDwellMs !== null && medianDwellMs < SWIPE_FAST_MEDIAN_MS) {
        reasons.push("fast_swipe_cadence");
      }
      if (positiveCount === exposureCount) {
        reasons.push("all_liked_monotone");
      }
      if (
        positiveCount === 0 &&
        medianDwellMs !== null &&
        medianDwellMs < SWIPE_FAST_SKIP_ALL_MEDIAN_MS
      ) {
        reasons.push("rapid_skip_all");
      }
    }

    const isHighRisk = reasons.length > 0;
    if (isHighRisk) {
      highRiskProfileIds.add(profileId);
    }
    userDiagnostics.set(profileId, {
      profileId,
      exposureCount,
      positiveCount,
      medianDwellMs,
      medianInterVoteGapMs: null,
      switchRate: null,
      isHighRisk,
      reasons,
    });
  }

  const activeExposures = excludeHighRisk
    ? allExposures.filter((item) => !highRiskProfileIds.has(item.profileId))
    : allExposures;
  const totalPositive = activeExposures.reduce(
    (sum, item) => sum + (item.isPositive ? 1 : 0),
    0,
  );
  const activeVoters = new Set(activeExposures.map((item) => item.profileId));

  // Match new-style-report study dwell median across active users' valid nav events.
  const activeNavDwells: number[] = [];
  for (const nav of sortedNavs) {
    if (excludeHighRisk && highRiskProfileIds.has(nav.profile_id)) {
      continue;
    }
    if (
      nav.time_to_next_caption_ms !== null &&
      nav.time_to_next_caption_ms >= 0
    ) {
      activeNavDwells.push(nav.time_to_next_caption_ms);
    }
  }

  return {
    studyId,
    mode: resolved.mode,
    isTransitionalLikert: resolved.isTransitionalLikert,
    detailHref: resolved.detailHref,
    exposureUnitLabel: resolved.exposureUnitLabel,
    exposures: activeExposures,
    allExposureCount: allExposures.length,
    allPositiveCount,
    totalExposures: activeExposures.length,
    totalPositive,
    distinctVoters: activeVoters.size,
    medianStudyDwellMs: computeMedianValue(activeNavDwells),
    highRiskProfileIds,
    highRiskVoterCount: highRiskProfileIds.size,
    excludedVoterCount: excludeHighRisk ? highRiskProfileIds.size : 0,
    excludedExposureCount: allExposures.length - activeExposures.length,
    userDiagnostics,
    reconciliation: {
      rawNavigationEventCount: rawNavCount,
      rawVoteEventCount: rawVoteCount,
      timedVoteCount: 0,
      untimedVoteCount: 0,
    },
  };
}

function adaptLikertExposures({
  studyId,
  resolved,
  validVotes,
  rawVoteCount,
  rawNavCount,
  excludeHighRisk,
}: {
  studyId: number;
  resolved: ResolvedExposureMode;
  validVotes: Array<RawStudyVoteRow & { study_caption_mapping_id: number }>;
  rawVoteCount: number;
  rawNavCount: number;
  excludeHighRisk: boolean;
}): AdaptedStudyExposures {
  const chronologicallySorted = [...validVotes].sort(
    compareEventsChronologically,
  );
  const latestByPairKey = new Map<
    string,
    RawStudyVoteRow & { study_caption_mapping_id: number }
  >();
  for (const vote of chronologicallySorted) {
    latestByPairKey.set(
      `${vote.profile_id}|${vote.study_caption_mapping_id}`,
      vote,
    );
  }
  const sortedVotes = [...latestByPairKey.values()].sort(
    compareEventsChronologically,
  );
  const allExposures: UnifiedExposure[] = [];
  const votesByUser = new Map<
    string,
    Array<RawStudyVoteRow & { study_caption_mapping_id: number }>
  >();

  let allPositiveCount = 0;
  let timedVoteCount = 0;
  let untimedVoteCount = 0;

  for (const vote of sortedVotes) {
    const isPositive = isPositiveStudyVote(vote.vote_value);
    const validTimed =
      vote.time_to_vote_ms !== null && vote.time_to_vote_ms >= 0
        ? vote.time_to_vote_ms
        : null;
    if (validTimed !== null) {
      timedVoteCount += 1;
    } else {
      untimedVoteCount += 1;
    }
    if (isPositive) {
      allPositiveCount += 1;
    }

    allExposures.push({
      profileId: vote.profile_id,
      mappingId: vote.study_caption_mapping_id,
      captionId: vote.caption_id,
      isPositive,
      dwellMs: validTimed,
      firstSeenUtc: vote.created_datetime_utc,
      firstEventId: vote.id,
    });

    let list = votesByUser.get(vote.profile_id);
    if (!list) {
      list = [];
      votesByUser.set(vote.profile_id, list);
    }
    list.push(vote);
  }

  const userDiagnostics = new Map<string, RaterQualityDiagnostic>();
  const highRiskProfileIds = new Set<string>();

  for (const [profileId, userVotes] of votesByUser.entries()) {
    const exposureCount = userVotes.length;
    const timedValues: number[] = [];
    const timestamps: number[] = [];
    const distinctRawVoteValues = new Set<string>();
    let positiveCount = 0;
    let switches = 0;
    let prevSign: 1 | -1 | null = null;

    for (const vote of userVotes) {
      distinctRawVoteValues.add(vote.vote_value);
      const sign = getStudyVoteSign(vote.vote_value);
      if (sign === 1) {
        positiveCount += 1;
      }
      if (prevSign !== null && sign !== prevSign) {
        switches += 1;
      }
      prevSign = sign;

      if (vote.time_to_vote_ms !== null && vote.time_to_vote_ms >= 0) {
        timedValues.push(vote.time_to_vote_ms);
      }
      const ts = parseEpochMs(vote.created_datetime_utc);
      if (ts !== null) {
        timestamps.push(ts);
      }
    }

    const gapsMs: number[] = [];
    for (let i = 1; i < timestamps.length; i += 1) {
      gapsMs.push(Math.max(0, timestamps[i] - timestamps[i - 1]));
    }

    const medianVoteMs = computeMedianValue(timedValues);
    const medianInterVoteGapMs = computeMedianValue(gapsMs);
    const switchRate =
      exposureCount >= 2 ? switches / (exposureCount - 1) : null;

    const reasons: string[] = [];
    if (exposureCount >= MIN_RATER_QUALITY_EXPOSURES) {
      if (medianVoteMs !== null && medianVoteMs < LIKERT_FAST_MEDIAN_MS) {
        reasons.push("fast_vote_time");
      }
      if (
        medianVoteMs === null &&
        medianInterVoteGapMs !== null &&
        medianInterVoteGapMs <= LIKERT_FAST_INTER_VOTE_GAP_MS
      ) {
        reasons.push("fast_inter_vote_gap");
      }
      const isDeliberateMultiLabel =
        distinctRawVoteValues.size >= 2 &&
        ((medianVoteMs !== null &&
          medianVoteMs >= LIKERT_DELIBERATE_MEDIAN_MS) ||
          (medianVoteMs === null &&
            medianInterVoteGapMs !== null &&
            medianInterVoteGapMs >= LIKERT_DELIBERATE_MEDIAN_MS));
      if (switchRate === 0 && !isDeliberateMultiLabel) {
        reasons.push("monotone_polarity");
      }
    }

    const isHighRisk = reasons.length > 0;
    if (isHighRisk) {
      highRiskProfileIds.add(profileId);
    }
    userDiagnostics.set(profileId, {
      profileId,
      exposureCount,
      positiveCount,
      medianDwellMs: medianVoteMs,
      medianInterVoteGapMs,
      switchRate,
      isHighRisk,
      reasons,
    });
  }

  const activeExposures = excludeHighRisk
    ? allExposures.filter((item) => !highRiskProfileIds.has(item.profileId))
    : allExposures;
  const totalPositive = activeExposures.reduce(
    (sum, item) => sum + (item.isPositive ? 1 : 0),
    0,
  );
  const activeVoters = new Set(activeExposures.map((item) => item.profileId));
  const activeDwells = activeExposures
    .map((item) => item.dwellMs)
    .filter((value): value is number => value !== null);

  return {
    studyId,
    mode: resolved.mode,
    isTransitionalLikert: resolved.isTransitionalLikert,
    detailHref: resolved.detailHref,
    exposureUnitLabel: resolved.exposureUnitLabel,
    exposures: activeExposures,
    allExposureCount: allExposures.length,
    allPositiveCount,
    totalExposures: activeExposures.length,
    totalPositive,
    distinctVoters: activeVoters.size,
    medianStudyDwellMs: computeMedianValue(activeDwells),
    highRiskProfileIds,
    highRiskVoterCount: highRiskProfileIds.size,
    excludedVoterCount: excludeHighRisk ? highRiskProfileIds.size : 0,
    excludedExposureCount: allExposures.length - activeExposures.length,
    userDiagnostics,
    reconciliation: {
      rawNavigationEventCount: rawNavCount,
      rawVoteEventCount: rawVoteCount,
      timedVoteCount,
      untimedVoteCount,
    },
  };
}

export function buildStudyParticipationFunnel({
  participationRows,
  exposures,
  mappedCaptionCount,
}: {
  participationRows: readonly RawStudyParticipationRow[];
  exposures: readonly UnifiedExposure[];
  mappedCaptionCount?: number;
}): StudyParticipationFunnel {
  const participationsStarted = participationRows.length;
  let participationsEnded = 0;
  const runMinutes: number[] = [];

  for (const row of participationRows) {
    if (row.ended_at !== null) {
      participationsEnded += 1;
      const startMs = parseEpochMs(row.started_at);
      const endMs = parseEpochMs(row.ended_at);
      if (startMs !== null && endMs !== null && endMs >= startMs) {
        runMinutes.push((endMs - startMs) / MS_PER_MINUTE);
      }
    }
  }

  // Track distinct study deck mappings per voter so duplicate Likert votes on
  // the same card (e.g. Study #20's single 204-vote outlier on a 203-card deck)
  // never fabricate a bogus cliff past the final card in the deck.
  const seenMappingsByUser = new Map<string, Set<number>>();
  for (const exposure of exposures) {
    let seen = seenMappingsByUser.get(exposure.profileId);
    if (!seen) {
      seen = new Set<number>();
      seenMappingsByUser.set(exposure.profileId, seen);
    }
    seen.add(exposure.mappingId);
  }

  const deckCap =
    mappedCaptionCount !== undefined &&
    Number.isInteger(mappedCaptionCount) &&
    mappedCaptionCount > 0
      ? mappedCaptionCount
      : null;

  const userDepths = Array.from(seenMappingsByUser.values(), (seen) =>
    deckCap !== null ? Math.min(seen.size, deckCap) : seen.size,
  );
  const distinctVoters = userDepths.length;
  const maxDepth =
    userDepths.length > 0
      ? userDepths.reduce((max, depth) => Math.max(max, depth), 0)
      : 0;

  const retentionCurve: RetentionStepPoint[] = [];
  if (distinctVoters > 0 && maxDepth >= 1) {
    // Prefix-difference bucket count gives O(U + D) survival curve computation.
    const exactDepthCounts = new Array<number>(maxDepth + 2).fill(0);
    for (const depth of userDepths) {
      exactDepthCounts[depth] += 1;
    }

    let activeUsers = distinctVoters;
    for (let position = 1; position <= maxDepth; position += 1) {
      const nextActive = activeUsers - exactDepthCounts[position];
      const droppedUsers = exactDepthCounts[position];
      retentionCurve.push({
        captionPosition: position,
        activeUsers,
        activeSharePct: Number(((activeUsers / distinctVoters) * 100).toFixed(2)),
        droppedUsers,
      });
      activeUsers = nextActive;
    }
  }

  return {
    participationsStarted,
    participationsEnded,
    completionRate:
      participationsStarted > 0
        ? participationsEnded / participationsStarted
        : null,
    medianRunMinutes: computeMedianValue(runMinutes),
    distinctVoters,
    judgedAtLeastOneCount: distinctVoters,
    retentionCurve,
  };
}
