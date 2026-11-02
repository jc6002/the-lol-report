import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/src/types/supabase";
import {
  computeMedian,
  computeWilsonConfidenceInterval,
  UNATTRIBUTED_BUCKET_KEY,
} from "@/utils/attribution-stats";
import {
  extractCustomStudyDescription,
  formatFriendlyStudyTitle,
  type RichStudySearchResponse,
} from "@/utils/attribution-ui-helpers";
import {
  getSwipeEventMatchKey,
  NEW_STYLE_MIN_STUDY_ID,
  type RawStudyMappingRow,
  type RawStudyParticipationRow,
  resolveStudyExposureMode,
  type StudyExposureMode,
} from "@/utils/study-exposure-adapter";
import {
  buildFlavorLookupMaps,
  getStudyLifecycleStatus,
  getStudyTitle,
  type RawFlavorRow,
  type RawFlavorStepRow,
  type RawModelRow,
  type RawProviderRow,
  resolveEffectiveCaptionFlavor,
  type StudyLifecycleStatus,
  type StudySummaryRow,
} from "@/utils/study-lineage-loader";
import {
  isPositiveStudyVote,
  type StudyVoteValue,
} from "@/utils/study-vote-events";
import { getSupabasePublicEnv } from "@/utils/supabase/env";
import { createClient } from "@/utils/supabase/server";
import { isSuperadminProfile } from "@/utils/supabase/superadmin";
import {
  DEFAULT_QUERY_PAGE_SIZE,
  fetchAllRows,
  fetchExactCount,
  fetchRowsByIdChunks,
  isLikelyTransientFetchError,
  mapWithConcurrency,
  sumExactCountsByIdChunks,
  type SupabaseListResult,
} from "@/utils/supabase-pagination";

export const GLOBAL_CACHE_TTL_MS = 15 * 60_000;
export const GLOBAL_CACHE_MAX_STALE_MS = 12 * 60 * 60_000;
export const MAX_GLOBAL_CACHE_ENTRIES = 4;
export const GLOBAL_RANGE_CONCURRENCY = 4;

const MS_PER_MINUTE = 60_000;
const TIE_EPSILON = 1e-9;
const UUID_ID_CHUNK_SIZE = 150;
const SWIPE_VOTE_MAPPING_CHUNK_SIZE = 60;
const SHARED_LIKERT_MAPPING_CHUNK_SIZE = 6;
const INTEGER_CHAIN_CHUNK_SIZE = 200;
const INTEGER_HEAD_CHUNK_SIZE = 400;
const MAX_SEARCH_STUDIES = 6;
const MAX_SEARCH_EVALUATED_ENTITIES = 6;
const MAX_SEARCH_UNTESTED_ENTITIES = 3;

export type StudyFormatDisplayLabel = "Swipe" | "Rating scale";

export type EnrichedStudyCatalogEntry = {
  id: number;
  slug: string | null;
  rawTitle: string;
  title: string;
  description: string | null;
  customDescription: string | null;
  start_datetime_utc: string | null;
  end_datetime_utc: string | null;
  created_datetime_utc: string;
  is_hidden: boolean;
  is_private: boolean;
  status: StudyLifecycleStatus;
  exposureMode: StudyExposureMode;
  isTransitionalLikert: boolean;
  formatLabel: "Swipe" | "Likert";
  formatDisplayLabel: StudyFormatDisplayLabel;
  detailHref: string;
  captionCount: number;
  flavorCount: number;
  modelCount: number;
  flavorSlugs: string[];
  modelNames: string[];
  voterCount: number;
  exposureCount: number;
  positiveCount: number;
  positiveRate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  participationsStarted: number;
  participationsEnded: number;
  completionRate: number | null;
  medianRunMinutes: number | null;
  sharedImagePairCount: number;
};

export type GlobalFlavorStudyBreakdown = {
  studyId: number;
  studyTitle: string;
  studySlug: string | null;
  exposureMode: StudyExposureMode;
  formatDisplayLabel: StudyFormatDisplayLabel;
  studyFlavorCount: number;
  sharedImagePairCount: number;
  captionCount: number;
  exposures: number;
  positive: number;
  rate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  meanLiftPp: number | null;
  attributionHref: string;
  headToHeadHref: string | null;
};

export type GlobalFlavorLeaderboardRow = {
  flavorId: number;
  slug: string;
  description: string | null;
  stepCount: number;
  primarySynthesisModel: string | null;
  pipelineSteps: string[];
  studyCount: number;
  scoredStudyCount: number;
  swipeStudyCount: number;
  ratingScaleStudyCount: number;
  captionCount: number;
  exposures: number;
  positive: number;
  swipeExposures: number;
  swipePositive: number;
  ratingScaleExposures: number;
  ratingScalePositive: number;
  rate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  sharedImageCount: number;
  meanLiftPp: number | null;
  pairWins: number;
  pairLosses: number;
  pairTies: number;
  studies: GlobalFlavorStudyBreakdown[];
};

export type UnevaluatedFlavorCatalogItem = {
  flavorId: number;
  slug: string;
  description: string | null;
};

export type GlobalModelStudyBreakdown = {
  studyId: number;
  studyTitle: string;
  studySlug: string | null;
  formatDisplayLabel: StudyFormatDisplayLabel;
  role: "synthesis" | "pipeline_step";
  captionCount: number;
  exposures: number;
  positive: number;
  rate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  href: string;
};

export type GlobalModelLeaderboardRow = {
  modelId: number;
  name: string;
  providerModelId: string;
  providerName: string;
  primaryRole: "synthesis" | "pipeline_step";
  synthesisStudyCount: number;
  synthesisFlavorCount: number;
  synthesisCaptionCount: number;
  synthesisExposures: number;
  synthesisPositive: number;
  synthesisRate: number | null;
  synthesisCiLow: number | null;
  synthesisCiHigh: number | null;
  pipelineStudyCount: number;
  pipelineFlavorCount: number;
  pipelineCaptionCount: number;
  pipelineExposures: number;
  pipelinePositive: number;
  pipelineRate: number | null;
  pipelineCiLow: number | null;
  pipelineCiHigh: number | null;
  medianChainSeconds: number | null;
  studies: GlobalModelStudyBreakdown[];
};

export type UnevaluatedModelCatalogItem = {
  modelId: number;
  name: string;
  providerModelId: string;
  providerName: string;
};

export type StudySwitcherCatalogItem = {
  id: number;
  title: string;
  slug: string | null;
  description: string | null;
  formatDisplayLabel: StudyFormatDisplayLabel;
  exposureMode: StudyExposureMode;
  flavorCount: number;
  modelCount: number;
  voterCount: number;
  exposureCount: number;
  positiveRate: number | null;
  flavorSlugs: string[];
  modelNames: string[];
};

export type GlobalHubKpis = {
  totalStudies: number;
  scoredStudies: number;
  multiFlavorStudies: number;
  activeStudies: number;
  scheduledStudies: number;
  closedStudies: number;
  swipeStudies: number;
  likertStudies: number;
  totalParticipations: number;
  completedParticipations: number;
  overallCompletionRate: number | null;
  totalFlavorCount: number;
  testedFlavorCount: number;
  scoredFlavorCount: number;
  totalModelCount: number;
  testedModelCount: number;
  synthesisModelCount: number;
  mappedCaptionCount: number;
  totalVoteEvents: number;
  totalNavigationEvents: number;
  totalUnifiedExposures: number;
  totalUnifiedPositive: number;
  surveyedProfileCount: number;
};

export type GlobalAttributionDataset = {
  studies: EnrichedStudyCatalogEntry[];
  latestScoredStudy: EnrichedStudyCatalogEntry | null;
  featuredBenchmarkStudy: EnrichedStudyCatalogEntry | null;
  flavors: GlobalFlavorLeaderboardRow[];
  unevaluatedFlavors: UnevaluatedFlavorCatalogItem[];
  unusedFlavorCount: number;
  models: GlobalModelLeaderboardRow[];
  unevaluatedModels: UnevaluatedModelCatalogItem[];
  kpis: GlobalHubKpis;
};

export type FastCatalogFlavorSummary = {
  flavorId: number;
  slug: string;
  description: string | null;
  primarySynthesisModel: string | null;
  studyCount: number;
  latestStudyId: number | null;
};

export type FastCatalogModelSummary = {
  modelId: number;
  name: string;
  providerModelId: string;
  providerName: string;
  primaryRole: "synthesis" | "pipeline_step";
  studyCount: number;
  latestStudyId: number | null;
};

export type FastStudyHubCatalog = {
  studies: EnrichedStudyCatalogEntry[];
  latestScoredStudy: EnrichedStudyCatalogEntry | null;
  featuredBenchmarkStudy: EnrichedStudyCatalogEntry | null;
  evaluatedFlavors: FastCatalogFlavorSummary[];
  unevaluatedFlavors: UnevaluatedFlavorCatalogItem[];
  unusedFlavorCount: number;
  evaluatedModels: FastCatalogModelSummary[];
  unevaluatedModels: UnevaluatedModelCatalogItem[];
  kpis: GlobalHubKpis;
};

type SwipeVoteRow = {
  id: number;
  profile_id: string;
  study_caption_mapping_id: number | null;
  session_id: string | null;
};

type SharedLikertVoteRow = {
  id: number;
  study_caption_mapping_id: number | null;
  vote_value: StudyVoteValue;
};

type CompactNavRow = {
  id: number;
  profile_id: string;
  study_caption_mapping_id: number | null;
  session_id: string | null;
};

type CompactCaptionRow = Pick<
  Tables<"captions">,
  | "id"
  | "image_id"
  | "humor_flavor_id"
  | "llm_prompt_chain_id"
  | "caption_request_id"
  | "metadata"
>;

type CompactLlmResponseRow = Pick<
  Tables<"llm_model_responses">,
  | "id"
  | "llm_prompt_chain_id"
  | "caption_request_id"
  | "humor_flavor_step_id"
  | "llm_model_id"
  | "processing_time_seconds"
  | "created_datetime_utc"
>;

type ResolvedCaptionLineage = {
  captionId: string;
  imageId: string | null;
  flavorId: number | null;
  flavorSlug: string | null;
  terminalModelId: number | null;
  pipelineModelIds: number[];
  pipelineStepNames: string[];
  chainLatencySeconds: number | null;
  lineageGroupKey: string;
};

type SwrCacheRecord<TValue> = {
  visibilitySig: string;
  freshUntilMs: number;
  staleUntilMs: number;
  value?: TValue;
  inFlight?: Promise<TValue>;
};

const FAST_HUB_CACHE_SYMBOL = Symbol.for(
  "the-lol-report.fastStudyHubCatalogCache",
);
const GLOBAL_DATASET_CACHE_SYMBOL = Symbol.for(
  "the-lol-report.globalAttributionDatasetCache",
);

function getSharedCacheMap<TValue>(
  sym: symbol,
): Map<string, SwrCacheRecord<TValue>> {
  const host = globalThis as Record<
    symbol,
    Map<string, SwrCacheRecord<TValue>> | undefined
  >;
  let map = host[sym];
  if (!map) {
    map = new Map<string, SwrCacheRecord<TValue>>();
    host[sym] = map;
  }
  return map;
}

const fastHubCatalogCache = getSharedCacheMap<FastStudyHubCatalog>(
  FAST_HUB_CACHE_SYMBOL,
);
const globalDatasetCache = getSharedCacheMap<GlobalAttributionDataset>(
  GLOBAL_DATASET_CACHE_SYMBOL,
);

export function clearGlobalAttributionCacheForTests(): void {
  fastHubCatalogCache.clear();
  globalDatasetCache.clear();
}

const sleep = (ms: number): Promise<void> => {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const parseEpochMs = (isoUtc: string | null): number | null => {
  if (!isoUtc) {
    return null;
  }
  const parsed = Date.parse(isoUtc);
  return Number.isFinite(parsed) ? parsed : null;
};

type ConcurrencyLimiter = <TResult>(
  task: () => PromiseLike<TResult>,
) => Promise<TResult>;

/**
 * Caps total simultaneous in-flight PostgREST requests across overlapping Promise.all
 * branches so cold socket initialization never bursts past upstream TCP SYN backlogs
 * or connection-pool ceilings. Reserves each slot continuously across FIFO waiter handoff
 * so synchronous microtask continuations cannot barge past queued callers.
 * Must wrap only leaf HTTP queries, never parent tasks.
 */
export function createConcurrencyLimiter(
  concurrency: number,
): ConcurrencyLimiter {
  const maxActive = Math.max(1, Math.floor(concurrency));
  let activeCount = 0;
  const waiters: Array<() => void> = [];

  return async <TResult>(
    task: () => PromiseLike<TResult>,
  ): Promise<TResult> => {
    if (activeCount < maxActive) {
      activeCount += 1;
    } else {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
    try {
      return await task();
    } finally {
      const next = waiters.shift();
      if (next) {
        next();
      } else {
        activeCount -= 1;
      }
    }
  };
}

async function runListQueryWithRetry<TRow>({
  contextLabel,
  retryAttempts = 3,
  retryBaseDelayMs = 150,
  runQuery,
}: {
  contextLabel: string;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  runQuery: () => PromiseLike<SupabaseListResult<TRow>>;
}): Promise<TRow[]> {
  const maxAttempts = Math.max(1, Math.floor(retryAttempts));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { data, error } = await runQuery();
      if (error) {
        throw new Error(error.message);
      }
      return data ?? [];
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown query error";
      if (isLikelyTransientFetchError(message) && attempt < maxAttempts) {
        await sleep(retryBaseDelayMs * attempt);
        continue;
      }
      throw new Error(`Unable to load ${contextLabel}: ${message}`);
    }
  }
  throw new Error(`Unable to load ${contextLabel}: exhausted retries`);
}

/**
 * Drains a numeric-PK table via parallel disjoint keyset range shards
 * (`id > cursor AND id <= shardHi`), avoiding O(N^2) OFFSET scans on large tables.
 */
export async function fetchAllRowsConcurrent<TRow extends { id: number }>({
  contextLabel,
  pageSize = DEFAULT_QUERY_PAGE_SIZE,
  concurrency = GLOBAL_RANGE_CONCURRENCY,
  retryAttempts = 3,
  retryBaseDelayMs = 150,
  boundsQuery,
  shardQuery,
}: {
  contextLabel: string;
  pageSize?: number;
  concurrency?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  boundsQuery: (
    ascending: boolean,
  ) => PromiseLike<SupabaseListResult<{ id: number }>>;
  shardQuery: (
    afterIdExclusive: number,
    maxIdInclusive: number | null,
    limit: number,
  ) => PromiseLike<SupabaseListResult<TRow>>;
}): Promise<TRow[]> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const [minRows, maxRows] = await Promise.all([
    runListQueryWithRetry({
      contextLabel: `${contextLabel} min bound`,
      retryAttempts,
      retryBaseDelayMs,
      runQuery: () => boundsQuery(true),
    }),
    runListQueryWithRetry({
      contextLabel: `${contextLabel} max bound`,
      retryAttempts,
      retryBaseDelayMs,
      runQuery: () => boundsQuery(false),
    }),
  ]);

  if (minRows.length === 0 || maxRows.length === 0) {
    return [];
  }

  const minId = minRows[0].id;
  const maxId = maxRows[0].id;
  const span = Math.max(1, maxId - minId + 1);
  const shardCount = Math.max(
    1,
    Math.min(Math.floor(concurrency), Math.ceil(span / safePageSize)),
  );

  const shards: Array<{ lo: number; hi: number }> = [];
  for (let i = 0; i < shardCount; i += 1) {
    const lo = minId + Math.floor((span * i) / shardCount);
    const hi =
      i === shardCount - 1
        ? maxId
        : minId + Math.floor((span * (i + 1)) / shardCount) - 1;
    if (lo <= hi) {
      shards.push({ lo, hi });
    }
  }

  const shardBatches = await mapWithConcurrency(
    shards,
    concurrency,
    async ({ lo, hi }) => {
      const out: TRow[] = [];
      let cursor = lo - 1;
      while (cursor < hi) {
        const page = await runListQueryWithRetry({
          contextLabel,
          retryAttempts,
          retryBaseDelayMs,
          runQuery: () => shardQuery(cursor, hi, safePageSize),
        });
        out.push(...page);
        if (page.length < safePageSize) {
          break;
        }
        cursor = page[page.length - 1].id;
      }
      return out;
    },
  );

  const combined = shardBatches.flat();

  // Safety tail pass for any rows inserted with id > maxId after bounds probe.
  let tailCursor = maxId;
  while (true) {
    const tailPage = await runListQueryWithRetry({
      contextLabel: `${contextLabel} tail`,
      retryAttempts,
      retryBaseDelayMs,
      runQuery: () => shardQuery(tailCursor, null, safePageSize),
    });
    if (tailPage.length === 0) {
      break;
    }
    combined.push(...tailPage);
    if (tailPage.length < safePageSize) {
      break;
    }
    tailCursor = tailPage[tailPage.length - 1].id;
  }

  return combined;
}

const fetchLiveStudiesList = (
  supabase: SupabaseClient<Database>,
): Promise<StudySummaryRow[]> =>
  fetchAllRows<StudySummaryRow>({
    contextLabel: "studies",
    runQuery: (from, to) =>
      supabase
        .from("studies")
        .select(
          "id, slug, description, start_datetime_utc, end_datetime_utc, created_datetime_utc, is_hidden, is_private",
        )
        .order("id", { ascending: false })
        .range(from, to) as PromiseLike<SupabaseListResult<StudySummaryRow>>,
  });

async function verifyLiveSuperadminForSharedCache(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const maybeAuth = (
    supabase as unknown as {
      auth?: {
        getUser?: () => Promise<{
          data?: { user?: { id?: string | null } | null } | null;
          error?: unknown;
        }>;
      };
    }
  ).auth;

  if (typeof maybeAuth?.getUser !== "function") {
    return false;
  }

  try {
    const { data, error } = await maybeAuth.getUser();
    const userId = error ? null : (data?.user?.id ?? null);
    if (!userId) {
      return false;
    }
    return await isSuperadminProfile(supabase, userId);
  } catch {
    return false;
  }
}

function touchCacheEntry<TValue>(
  cacheMap: Map<string, SwrCacheRecord<TValue>>,
  key: string,
  entry: SwrCacheRecord<TValue>,
): void {
  cacheMap.delete(key);
  cacheMap.set(key, entry);
}

function evictOldestCacheEntriesIfNeeded<TValue>(
  cacheMap: Map<string, SwrCacheRecord<TValue>>,
): void {
  while (cacheMap.size >= MAX_GLOBAL_CACHE_ENTRIES) {
    const oldestKey = cacheMap.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cacheMap.delete(oldestKey);
  }
}

export function selectLatestScoredStudy(
  studies: readonly EnrichedStudyCatalogEntry[],
): EnrichedStudyCatalogEntry | null {
  let latestPublicScored: EnrichedStudyCatalogEntry | null = null;
  let latestAnyScored: EnrichedStudyCatalogEntry | null = null;

  for (const study of studies) {
    if (study.exposureCount <= 0) {
      continue;
    }
    if (latestAnyScored === null || study.id > latestAnyScored.id) {
      latestAnyScored = study;
    }
    if (
      !study.is_private &&
      (latestPublicScored === null || study.id > latestPublicScored.id)
    ) {
      latestPublicScored = study;
    }
  }

  return latestPublicScored ?? latestAnyScored;
}

const computeBenchmarkScore = (study: EnrichedStudyCatalogEntry): number =>
  study.flavorCount * Math.max(1, study.sharedImagePairCount);

export function selectFeaturedBenchmarkStudy(
  studies: readonly EnrichedStudyCatalogEntry[],
): EnrichedStudyCatalogEntry | null {
  const candidates = studies.filter(
    (study) => study.exposureCount > 0 && study.flavorCount >= 2,
  );
  if (candidates.length === 0) {
    return null;
  }

  const publicCandidates = candidates.filter((study) => !study.is_private);
  const pool = publicCandidates.length > 0 ? publicCandidates : candidates;

  return [...pool].sort((left, right) => {
    const leftScore = computeBenchmarkScore(left);
    const rightScore = computeBenchmarkScore(right);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    if (left.flavorCount !== right.flavorCount) {
      return right.flavorCount - left.flavorCount;
    }
    if (left.exposureCount !== right.exposureCount) {
      return right.exposureCount - left.exposureCount;
    }
    return right.id - left.id;
  })[0];
}

const buildStepsByFlavorId = (
  steps: readonly RawFlavorStepRow[],
): Map<number, RawFlavorStepRow[]> => {
  const byFlavor = new Map<number, RawFlavorStepRow[]>();
  for (const step of steps) {
    let list = byFlavor.get(step.humor_flavor_id);
    if (!list) {
      list = [];
      byFlavor.set(step.humor_flavor_id, list);
    }
    list.push(step);
  }
  for (const list of byFlavor.values()) {
    list.sort((a, b) => a.order_by - b.order_by || a.id - b.id);
  }
  return byFlavor;
};

type SharedGlobalFoundation = {
  mappings: RawStudyMappingRow[];
  distinctMappedCaptionIds: string[];
  participations: RawStudyParticipationRow[];
  participationsByStudy: Map<number, RawStudyParticipationRow[]>;
  flavors: RawFlavorRow[];
  flavorsById: Map<number, RawFlavorRow>;
  stepsByFlavorId: Map<number, RawFlavorStepRow[]>;
  models: RawModelRow[];
  modelsById: Map<number, RawModelRow>;
  providersById: Map<number, RawProviderRow>;
  totalVoteEvents: number;
  surveyedProfileCount: number;
  navigationRows: CompactNavRow[];
  lineageByCaptionId: Map<string, ResolvedCaptionLineage>;
  mappingById: Map<number, RawStudyMappingRow>;
  mappingsByStudy: Map<number, RawStudyMappingRow[]>;
  captionIdsByStudy: Map<number, Set<string>>;
  navsByStudy: Map<
    number,
    Array<CompactNavRow & { study_caption_mapping_id: number; caption_id: string }>
  >;
  swipeMappingIds: number[];
  crossFlavorImagesByStudy: Map<number, Set<string>>;
};

async function loadSharedGlobalFoundationUncached(
  supabase: SupabaseClient<Database>,
  liveStudies: readonly StudySummaryRow[],
  options?: {
    pageSize?: number;
    concurrency?: number;
    limitQuery?: ConcurrencyLimiter;
  },
): Promise<SharedGlobalFoundation> {
  const pageSize = options?.pageSize ?? DEFAULT_QUERY_PAGE_SIZE;
  const concurrency = options?.concurrency ?? GLOBAL_RANGE_CONCURRENCY;
  const limitQuery =
    options?.limitQuery ?? createConcurrencyLimiter(concurrency);

  // Launch concurrent keyset drains for navigation events (51.5k rows) and mappings
  // (4,857 rows) alongside Wave 1 dictionary tables so network work overlaps maximally
  // while limitQuery caps total simultaneous cold/warm HTTP requests to `concurrency`.
  const navDrainPromise = fetchAllRowsConcurrent<CompactNavRow>({
    contextLabel: "study caption navigation events",
    pageSize,
    concurrency,
    boundsQuery: (ascending) =>
      limitQuery(
        () =>
          supabase
            .from("study_caption_navigation_events")
            .select("id")
            .order("id", { ascending })
            .limit(1) as PromiseLike<SupabaseListResult<{ id: number }>>,
      ),
    shardQuery: (afterId, maxId, limit) =>
      limitQuery(() => {
        let query = supabase
          .from("study_caption_navigation_events")
          .select("id, profile_id, study_caption_mapping_id, session_id")
          .gt("id", afterId);
        if (maxId !== null) {
          query = query.lte("id", maxId);
        }
        return query
          .order("id", { ascending: true })
          .limit(limit) as PromiseLike<SupabaseListResult<CompactNavRow>>;
      }),
  });

  const mappingsPromise = fetchAllRowsConcurrent<RawStudyMappingRow>({
    contextLabel: "study caption mappings",
    pageSize,
    concurrency,
    boundsQuery: (ascending) =>
      limitQuery(
        () =>
          supabase
            .from("study_caption_mappings")
            .select("id")
            .order("id", { ascending })
            .limit(1) as PromiseLike<SupabaseListResult<{ id: number }>>,
      ),
    shardQuery: (afterId, maxId, limit) =>
      limitQuery(() => {
        let query = supabase
          .from("study_caption_mappings")
          .select("id, study_id, caption_id")
          .gt("id", afterId);
        if (maxId !== null) {
          query = query.lte("id", maxId);
        }
        return query
          .order("id", { ascending: true })
          .limit(limit) as PromiseLike<SupabaseListResult<RawStudyMappingRow>>;
      }),
  });

  // Overlap mapped captions + compact chain lineage fetches directly behind mappingsPromise
  // while navDrainPromise continues draining navigation rows in parallel.
  const captionsAndLineagePromise = mappingsPromise.then(async (mappings) => {
    const distinctMappedCaptionIds = Array.from(
      new Set(mappings.map((row) => row.caption_id)),
    );

    const mappedCaptions = await fetchRowsByIdChunks<string, CompactCaptionRow>({
      ids: distinctMappedCaptionIds,
      contextLabel: "study-mapped captions",
      chunkSize: UUID_ID_CHUNK_SIZE,
      pageSize,
      concurrency,
      runQuery: (chunk, from, to) =>
        limitQuery(
          () =>
            supabase
              .from("captions")
              .select(
                "id, image_id, humor_flavor_id, llm_prompt_chain_id, caption_request_id, metadata",
              )
              .in("id", chunk)
              .order("id", { ascending: true })
              .range(from, to) as PromiseLike<
              SupabaseListResult<CompactCaptionRow>
            >,
        ),
    });

    const chainIds = mappedCaptions
      .map((cap) => cap.llm_prompt_chain_id)
      .filter((id): id is number => id !== null);
    const fallbackRequestIds = mappedCaptions
      .filter(
        (cap) =>
          cap.llm_prompt_chain_id === null && cap.caption_request_id !== null,
      )
      .map((cap) => cap.caption_request_id as number);

    const [chainResponses, fallbackReqResponses] = await Promise.all([
      fetchRowsByIdChunks<number, CompactLlmResponseRow>({
        ids: chainIds,
        contextLabel: "study chain model responses",
        chunkSize: INTEGER_CHAIN_CHUNK_SIZE,
        pageSize,
        concurrency,
        runQuery: (chunk, from, to) =>
          limitQuery(
            () =>
              supabase
                .from("llm_model_responses")
                .select(
                  "id, llm_prompt_chain_id, caption_request_id, humor_flavor_step_id, llm_model_id, processing_time_seconds, created_datetime_utc",
                )
                .in("llm_prompt_chain_id", chunk)
                .order("id", { ascending: true })
                .range(from, to) as PromiseLike<
                SupabaseListResult<CompactLlmResponseRow>
              >,
          ),
      }),
      fetchRowsByIdChunks<number, CompactLlmResponseRow>({
        ids: fallbackRequestIds,
        contextLabel: "study request model responses",
        chunkSize: INTEGER_CHAIN_CHUNK_SIZE,
        pageSize,
        concurrency,
        runQuery: (chunk, from, to) =>
          limitQuery(
            () =>
              supabase
                .from("llm_model_responses")
                .select(
                  "id, llm_prompt_chain_id, caption_request_id, humor_flavor_step_id, llm_model_id, processing_time_seconds, created_datetime_utc",
                )
                .in("caption_request_id", chunk)
                .order("id", { ascending: true })
                .range(from, to) as PromiseLike<
                SupabaseListResult<CompactLlmResponseRow>
              >,
          ),
      }),
    ]);

    return {
      mappings,
      distinctMappedCaptionIds,
      mappedCaptions,
      chainResponses,
      fallbackReqResponses,
    };
  });

  const [
    {
      mappings,
      distinctMappedCaptionIds,
      mappedCaptions,
      chainResponses,
      fallbackReqResponses,
    },
    navigationRows,
    participations,
    flavors,
    flavorSteps,
    models,
    providers,
    demographicMappings,
    demographicResponses,
    totalVoteEvents,
  ] = await Promise.all([
    captionsAndLineagePromise,
    navDrainPromise,
    fetchAllRows<RawStudyParticipationRow>({
      contextLabel: "study participations",
      pageSize,
      runQuery: (from, to) =>
        limitQuery(
          () =>
            supabase
              .from("study_participations")
              .select(
                "profile_id, study_id, started_at, ended_at, completion_stats",
              )
              .order("study_id", { ascending: true })
              .order("started_at", { ascending: true })
              .order("profile_id", { ascending: true })
              .range(from, to) as PromiseLike<
              SupabaseListResult<RawStudyParticipationRow>
            >,
        ),
    }),
    fetchAllRows<RawFlavorRow>({
      contextLabel: "humor flavors",
      pageSize,
      runQuery: (from, to) =>
        limitQuery(
          () =>
            supabase
              .from("humor_flavors")
              .select("id, slug, description")
              .order("id", { ascending: true })
              .range(from, to) as PromiseLike<SupabaseListResult<RawFlavorRow>>,
        ),
    }),
    fetchAllRows<RawFlavorStepRow>({
      contextLabel: "humor flavor steps",
      pageSize,
      runQuery: (from, to) =>
        limitQuery(
          () =>
            supabase
              .from("humor_flavor_steps")
              .select("id, humor_flavor_id, order_by, llm_model_id")
              .order("id", { ascending: true })
              .range(from, to) as PromiseLike<
              SupabaseListResult<RawFlavorStepRow>
            >,
        ),
    }),
    fetchAllRows<RawModelRow>({
      contextLabel: "llm models",
      pageSize,
      runQuery: (from, to) =>
        limitQuery(
          () =>
            supabase
              .from("llm_models")
              .select("id, name, provider_model_id, llm_provider_id")
              .order("id", { ascending: true })
              .range(from, to) as PromiseLike<SupabaseListResult<RawModelRow>>,
        ),
    }),
    fetchAllRows<RawProviderRow>({
      contextLabel: "llm providers",
      pageSize,
      runQuery: (from, to) =>
        limitQuery(
          () =>
            supabase
              .from("llm_providers")
              .select("id, name")
              .order("id", { ascending: true })
              .range(from, to) as PromiseLike<
              SupabaseListResult<RawProviderRow>
            >,
        ),
    }),
    fetchAllRows<
      Pick<Tables<"demographic_answer_question_mapping">, "id" | "is_deleted">
    >({
      contextLabel: "demographic mappings",
      pageSize,
      runQuery: (from, to) =>
        limitQuery(() =>
          supabase
            .from("demographic_answer_question_mapping")
            .select("id, is_deleted")
            .order("id", { ascending: true })
            .range(from, to),
        ),
    }),
    fetchAllRows<
      Pick<
        Tables<"demographic_user_responses">,
        "user_id" | "answer_question_mapping_id"
      >
    >({
      contextLabel: "demographic user responses",
      pageSize,
      runQuery: (from, to) =>
        limitQuery(() =>
          supabase
            .from("demographic_user_responses")
            .select("user_id, answer_question_mapping_id")
            .order("id", { ascending: true })
            .range(from, to),
        ),
    }),
    fetchExactCount({
      contextLabel: "study vote events",
      runQuery: () =>
        limitQuery(() =>
          supabase
            .from("study_caption_vote_events")
            .select("id", { count: "exact", head: true }),
        ),
    }),
  ]);

  const { flavorsById, flavorsBySlugLower } = buildFlavorLookupMaps(flavors);
  const stepsByFlavorId = buildStepsByFlavorId(flavorSteps);
  const stepById = new Map(flavorSteps.map((step) => [step.id, step]));
  const modelsById = new Map(models.map((model) => [model.id, model]));
  const providersById = new Map(
    providers.map((provider) => [provider.id, provider]),
  );

  const responsesByChainId = new Map<number, CompactLlmResponseRow[]>();
  const responsesByRequestId = new Map<number, CompactLlmResponseRow[]>();
  const seenResponseIds = new Set<string>();
  for (const resp of [...chainResponses, ...fallbackReqResponses]) {
    if (seenResponseIds.has(resp.id)) {
      continue;
    }
    seenResponseIds.add(resp.id);
    if (resp.llm_prompt_chain_id !== null) {
      let list = responsesByChainId.get(resp.llm_prompt_chain_id);
      if (!list) {
        list = [];
        responsesByChainId.set(resp.llm_prompt_chain_id, list);
      }
      list.push(resp);
    }
    if (resp.caption_request_id !== null) {
      let list = responsesByRequestId.get(resp.caption_request_id);
      if (!list) {
        list = [];
        responsesByRequestId.set(resp.caption_request_id, list);
      }
      list.push(resp);
    }
  }

  const sortChainResponses = (
    rows: readonly CompactLlmResponseRow[],
  ): CompactLlmResponseRow[] =>
    [...rows].sort((left, right) => {
      const leftOrder =
        left.humor_flavor_step_id !== null
          ? (stepById.get(left.humor_flavor_step_id)?.order_by ??
            Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      const rightOrder =
        right.humor_flavor_step_id !== null
          ? (stepById.get(right.humor_flavor_step_id)?.order_by ??
            Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (left.created_datetime_utc !== right.created_datetime_utc) {
        return left.created_datetime_utc < right.created_datetime_utc ? -1 : 1;
      }
      return left.id.localeCompare(right.id);
    });

  const lineageByCaptionId = new Map<string, ResolvedCaptionLineage>();
  for (const caption of mappedCaptions) {
    const { flavor } = resolveEffectiveCaptionFlavor(
      caption,
      flavorsById,
      flavorsBySlugLower,
    );
    const configuredSteps = flavor
      ? (stepsByFlavorId.get(flavor.id) ?? [])
      : [];
    const rawChainRows =
      caption.llm_prompt_chain_id !== null
        ? (responsesByChainId.get(caption.llm_prompt_chain_id) ?? [])
        : caption.caption_request_id !== null
          ? (responsesByRequestId.get(caption.caption_request_id) ?? [])
          : [];

    let terminalModelId: number | null = null;
    const pipelineModelIdSet = new Set<number>();
    let pipelineStepNames: string[] = [];
    let chainLatencySeconds: number | null = null;

    if (rawChainRows.length > 0) {
      const ordered = sortChainResponses(rawChainRows);
      const last = ordered[ordered.length - 1];
      if (modelsById.has(last.llm_model_id)) {
        terminalModelId = last.llm_model_id;
      }
      pipelineStepNames = ordered.map((resp) => {
        const model = modelsById.get(resp.llm_model_id);
        if (model) {
          pipelineModelIdSet.add(model.id);
        }
        return (
          model?.name ?? model?.provider_model_id ?? `Model #${resp.llm_model_id}`
        );
      });

      let latencySum = 0;
      let hasTiming = false;
      for (const resp of ordered) {
        if (
          Number.isFinite(resp.processing_time_seconds) &&
          resp.processing_time_seconds >= 0
        ) {
          latencySum += resp.processing_time_seconds;
          hasTiming = true;
        }
      }
      if (hasTiming) {
        chainLatencySeconds = Number(latencySum.toFixed(3));
      }
    } else if (configuredSteps.length > 0) {
      const last = configuredSteps[configuredSteps.length - 1];
      if (modelsById.has(last.llm_model_id)) {
        terminalModelId = last.llm_model_id;
      }
      pipelineStepNames = configuredSteps.map((step) => {
        const model = modelsById.get(step.llm_model_id);
        if (model) {
          pipelineModelIdSet.add(model.id);
        }
        return (
          model?.name ?? model?.provider_model_id ?? `Model #${step.llm_model_id}`
        );
      });
    }

    const sortedPipeIds = Array.from(pipelineModelIdSet).sort((a, b) => a - b);
    lineageByCaptionId.set(caption.id, {
      captionId: caption.id,
      imageId: caption.image_id,
      flavorId: flavor?.id ?? null,
      flavorSlug: flavor?.slug ?? null,
      terminalModelId,
      pipelineModelIds: sortedPipeIds,
      pipelineStepNames,
      chainLatencySeconds,
      lineageGroupKey: `${flavor?.id ?? "u"}|${terminalModelId ?? "u"}|${sortedPipeIds.join(",")}`,
    });
  }

  const mappingById = new Map<number, RawStudyMappingRow>();
  const mappingsByStudy = new Map<number, RawStudyMappingRow[]>();
  const captionIdsByStudy = new Map<number, Set<string>>();
  for (const mapping of mappings) {
    mappingById.set(mapping.id, mapping);
    let studyList = mappingsByStudy.get(mapping.study_id);
    if (!studyList) {
      studyList = [];
      mappingsByStudy.set(mapping.study_id, studyList);
    }
    studyList.push(mapping);

    let capSet = captionIdsByStudy.get(mapping.study_id);
    if (!capSet) {
      capSet = new Set<string>();
      captionIdsByStudy.set(mapping.study_id, capSet);
    }
    capSet.add(mapping.caption_id);
  }

  const navsByStudy = new Map<
    number,
    Array<CompactNavRow & { study_caption_mapping_id: number; caption_id: string }>
  >();
  for (const nav of navigationRows) {
    if (nav.study_caption_mapping_id === null) {
      continue;
    }
    const mapping = mappingById.get(nav.study_caption_mapping_id);
    if (!mapping) {
      continue;
    }
    let list = navsByStudy.get(mapping.study_id);
    if (!list) {
      list = [];
      navsByStudy.set(mapping.study_id, list);
    }
    list.push({
      ...nav,
      study_caption_mapping_id: nav.study_caption_mapping_id,
      caption_id: mapping.caption_id,
    });
  }

  const participationsByStudy = new Map<number, RawStudyParticipationRow[]>();
  for (const part of participations) {
    let list = participationsByStudy.get(part.study_id);
    if (!list) {
      list = [];
      participationsByStudy.set(part.study_id, list);
    }
    list.push(part);
  }

  const swipeMappingIds: number[] = [];
  const crossFlavorImagesByStudy = new Map<number, Set<string>>();

  for (const study of liveStudies) {
    const studyMaps = mappingsByStudy.get(study.id) ?? [];
    if (studyMaps.length === 0) {
      continue;
    }
    const hasNavs = (navsByStudy.get(study.id)?.length ?? 0) > 0;
    if (study.id >= NEW_STYLE_MIN_STUDY_ID && hasNavs) {
      for (const m of studyMaps) {
        swipeMappingIds.push(m.id);
      }
      continue;
    }

    const flavorKeysByImage = new Map<string, Set<string>>();
    const captionCountByImage = new Map<string, number>();
    const studyCaps = Array.from(captionIdsByStudy.get(study.id) ?? []);
    for (const capId of studyCaps) {
      const lin = lineageByCaptionId.get(capId);
      if (!lin?.imageId) continue;
      captionCountByImage.set(
        lin.imageId,
        (captionCountByImage.get(lin.imageId) ?? 0) + 1,
      );
      let fSet = flavorKeysByImage.get(lin.imageId);
      if (!fSet) {
        fSet = new Set<string>();
        flavorKeysByImage.set(lin.imageId, fSet);
      }
      fSet.add(
        lin.flavorId !== null ? `f:${lin.flavorId}` : UNATTRIBUTED_BUCKET_KEY,
      );
    }

    const crossFlavorImageIds = new Set<string>();
    for (const [imgId, fSet] of flavorKeysByImage.entries()) {
      if ((captionCountByImage.get(imgId) ?? 0) >= 2 && fSet.size >= 2) {
        crossFlavorImageIds.add(imgId);
      }
    }
    crossFlavorImagesByStudy.set(study.id, crossFlavorImageIds);
  }

  const activeMappingIds = new Set(
    demographicMappings.filter((m) => !m.is_deleted).map((m) => m.id),
  );
  const surveyedProfiles = new Set<string>();
  for (const resp of demographicResponses) {
    if (activeMappingIds.has(resp.answer_question_mapping_id)) {
      surveyedProfiles.add(resp.user_id);
    }
  }

  return {
    mappings,
    distinctMappedCaptionIds,
    participations,
    participationsByStudy,
    flavors,
    flavorsById,
    stepsByFlavorId,
    models,
    modelsById,
    providersById,
    totalVoteEvents,
    surveyedProfileCount: surveyedProfiles.size,
    navigationRows,
    lineageByCaptionId,
    mappingById,
    mappingsByStudy,
    captionIdsByStudy,
    navsByStudy,
    swipeMappingIds,
    crossFlavorImagesByStudy,
  };
}

const groupSwipeVotesByStudy = (
  swipeVoteRows: readonly SwipeVoteRow[],
  mappingById: ReadonlyMap<number, RawStudyMappingRow>,
): Map<number, Array<SwipeVoteRow & { study_caption_mapping_id: number }>> => {
  const swipeVotesByStudy = new Map<
    number,
    Array<SwipeVoteRow & { study_caption_mapping_id: number }>
  >();
  for (const vote of swipeVoteRows) {
    if (vote.study_caption_mapping_id === null) continue;
    const m = mappingById.get(vote.study_caption_mapping_id);
    if (!m) continue;
    let list = swipeVotesByStudy.get(m.study_id);
    if (!list) {
      list = [];
      swipeVotesByStudy.set(m.study_id, list);
    }
    list.push({ ...vote, study_caption_mapping_id: vote.study_caption_mapping_id });
  }
  return swipeVotesByStudy;
};

const evaluateSwipeStudyExposures = ({
  studyNavs,
  studyVotes,
}: {
  studyNavs: ReadonlyArray<
    CompactNavRow & { study_caption_mapping_id: number; caption_id: string }
  >;
  studyVotes: ReadonlyArray<
    SwipeVoteRow & { study_caption_mapping_id: number }
  >;
}): {
  voterCount: number;
  studyExposures: number;
  studyPositive: number;
  captionTallies: Map<string, { exposures: number; positive: number }>;
} => {
  const likeKeys = new Set<string>();
  for (const vote of studyVotes) {
    likeKeys.add(
      getSwipeEventMatchKey({
        profile_id: vote.profile_id,
        study_caption_mapping_id: vote.study_caption_mapping_id,
        session_id: vote.session_id,
      }),
    );
  }

  const seenPairs = new Map<
    string,
    { profileId: string; captionId: string; liked: boolean }
  >();
  for (const nav of studyNavs) {
    const pairKey = `${nav.profile_id}|${nav.study_caption_mapping_id}`;
    const matchedLike = likeKeys.has(
      getSwipeEventMatchKey({
        profile_id: nav.profile_id,
        study_caption_mapping_id: nav.study_caption_mapping_id,
        session_id: nav.session_id,
      }),
    );
    const existing = seenPairs.get(pairKey);
    if (!existing) {
      seenPairs.set(pairKey, {
        profileId: nav.profile_id,
        captionId: nav.caption_id,
        liked: matchedLike,
      });
    } else if (matchedLike) {
      existing.liked = true;
    }
  }

  const swipeVoters = new Set<string>();
  const captionTallies = new Map<
    string,
    { exposures: number; positive: number }
  >();
  let studyExposures = 0;
  let studyPositive = 0;

  for (const item of seenPairs.values()) {
    swipeVoters.add(item.profileId);
    studyExposures += 1;
    if (item.liked) {
      studyPositive += 1;
    }
    let tally = captionTallies.get(item.captionId);
    if (!tally) {
      tally = { exposures: 0, positive: 0 };
      captionTallies.set(item.captionId, tally);
    }
    tally.exposures += 1;
    if (item.liked) {
      tally.positive += 1;
    }
  }

  return {
    voterCount: swipeVoters.size,
    studyExposures,
    studyPositive,
    captionTallies,
  };
};

const summarizeStudyParticipations = (
  studyParts: readonly RawStudyParticipationRow[],
): {
  started: number;
  ended: number;
  distinctParticipants: number;
  medianRunMinutes: number | null;
} => {
  const started = studyParts.length;
  let ended = 0;
  const runMinutes: number[] = [];
  const profileIds = new Set<string>();
  for (const part of studyParts) {
    profileIds.add(part.profile_id);
    if (part.ended_at !== null) {
      ended += 1;
      const sMs = parseEpochMs(part.started_at);
      const eMs = parseEpochMs(part.ended_at);
      if (sMs !== null && eMs !== null && eMs >= sMs) {
        runMinutes.push((eMs - sMs) / MS_PER_MINUTE);
      }
    }
  }
  return {
    started,
    ended,
    distinctParticipants: profileIds.size,
    medianRunMinutes: computeMedian(runMinutes),
  };
};

const buildGlobalHubKpis = ({
  enrichedStudies,
  participations,
  totalFlavorCount,
  testedFlavorCount,
  scoredFlavorCount,
  totalModelCount,
  testedModelCount,
  synthesisModelCount,
  mappedCaptionCount,
  totalVoteEvents,
  totalNavigationEvents,
  totalUnifiedExposures,
  totalUnifiedPositive,
  surveyedProfileCount,
}: {
  enrichedStudies: readonly EnrichedStudyCatalogEntry[];
  participations: readonly RawStudyParticipationRow[];
  totalFlavorCount: number;
  testedFlavorCount: number;
  scoredFlavorCount: number;
  totalModelCount: number;
  testedModelCount: number;
  synthesisModelCount: number;
  mappedCaptionCount: number;
  totalVoteEvents: number;
  totalNavigationEvents: number;
  totalUnifiedExposures: number;
  totalUnifiedPositive: number;
  surveyedProfileCount: number;
}): GlobalHubKpis => {
  const scoredStudies = enrichedStudies.filter(
    (s) => s.exposureCount > 0,
  ).length;
  const multiFlavorStudies = enrichedStudies.filter(
    (s) => s.exposureCount > 0 && s.flavorCount >= 2,
  ).length;
  const activeStudies = enrichedStudies.filter(
    (s) => s.status === "active",
  ).length;
  const scheduledStudies = enrichedStudies.filter(
    (s) => s.status === "scheduled",
  ).length;
  const closedStudies =
    enrichedStudies.length - activeStudies - scheduledStudies;
  const swipeStudies = enrichedStudies.filter(
    (s) => s.exposureMode === "swipe_navigation",
  ).length;
  const likertStudies = enrichedStudies.length - swipeStudies;
  const totalParticipations = participations.length;
  const completedParticipations = participations.filter(
    (p) => p.ended_at !== null,
  ).length;

  return {
    totalStudies: enrichedStudies.length,
    scoredStudies,
    multiFlavorStudies,
    activeStudies,
    scheduledStudies,
    closedStudies,
    swipeStudies,
    likertStudies,
    totalParticipations,
    completedParticipations,
    overallCompletionRate:
      totalParticipations > 0
        ? completedParticipations / totalParticipations
        : null,
    totalFlavorCount,
    testedFlavorCount,
    scoredFlavorCount,
    totalModelCount,
    testedModelCount,
    synthesisModelCount,
    mappedCaptionCount,
    totalVoteEvents,
    totalNavigationEvents,
    totalUnifiedExposures,
    totalUnifiedPositive,
    surveyedProfileCount,
  };
};

async function loadFastStudyHubCatalogUncached(
  supabase: SupabaseClient<Database>,
  liveStudies: readonly StudySummaryRow[],
  nowMs: number,
  options?: { pageSize?: number; concurrency?: number },
): Promise<FastStudyHubCatalog> {
  const pageSize = options?.pageSize ?? DEFAULT_QUERY_PAGE_SIZE;
  const concurrency = options?.concurrency ?? GLOBAL_RANGE_CONCURRENCY;
  const limitQuery = createConcurrencyLimiter(concurrency);

  const base = await loadSharedGlobalFoundationUncached(supabase, liveStudies, {
    ...options,
    limitQuery,
  });

  const likertCandidateStudies = liveStudies.filter((study) => {
    const studyMaps = base.mappingsByStudy.get(study.id) ?? [];
    if (studyMaps.length === 0) return false;
    const hasNavs = (base.navsByStudy.get(study.id)?.length ?? 0) > 0;
    return !(study.id >= NEW_STYLE_MIN_STUDY_ID && hasNavs);
  });

  // Tier-1 Wave 2: drain Swipe votes (~13.5k rows) via composite (study_caption_mapping_id, id)
  // index scans and execute at most 2 indexed zero-payload HEAD counts per Likert-candidate
  // study (transferring 0 of 353k Likert rows).
  const [swipeVoteRows, likertStudyCounts] = await Promise.all([
    fetchRowsByIdChunks<number, SwipeVoteRow>({
      ids: base.swipeMappingIds,
      contextLabel: "swipe study vote events",
      chunkSize: SWIPE_VOTE_MAPPING_CHUNK_SIZE,
      pageSize,
      concurrency,
      runQuery: (chunk, from, to) =>
        limitQuery(
          () =>
            supabase
              .from("study_caption_vote_events")
              .select("id, profile_id, study_caption_mapping_id, session_id")
              .in("study_caption_mapping_id", chunk)
              .order("study_caption_mapping_id", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to) as PromiseLike<SupabaseListResult<SwipeVoteRow>>,
        ),
    }),
    mapWithConcurrency(
      likertCandidateStudies,
      concurrency,
      async (study) => {
        const mappingIds = (base.mappingsByStudy.get(study.id) ?? []).map(
          (m) => m.id,
        );
        const exposures = await sumExactCountsByIdChunks({
          ids: mappingIds,
          contextLabel: `likert exposures study ${study.id}`,
          chunkSize: INTEGER_HEAD_CHUNK_SIZE,
          concurrency,
          runQuery: (chunk) =>
            limitQuery(() =>
              supabase
                .from("study_caption_vote_events")
                .select("id", { count: "exact", head: true })
                .in("study_caption_mapping_id", chunk),
            ),
        });
        const positive =
          exposures > 0
            ? await sumExactCountsByIdChunks({
                ids: mappingIds,
                contextLabel: `likert positive study ${study.id}`,
                chunkSize: INTEGER_HEAD_CHUNK_SIZE,
                concurrency,
                runQuery: (chunk) =>
                  limitQuery(() =>
                    supabase
                      .from("study_caption_vote_events")
                      .select("id", { count: "exact", head: true })
                      .in("study_caption_mapping_id", chunk)
                      .in("vote_value", ["funny", "very funny"]),
                  ),
              })
            : 0;
        return { studyId: study.id, exposures, positive };
      },
    ),
  ]);

  const swipeVotesByStudy = groupSwipeVotesByStudy(
    swipeVoteRows,
    base.mappingById,
  );
  const likertTotalsByStudy = new Map(
    likertStudyCounts.map((item) => [item.studyId, item]),
  );

  type FastFlavorAcc = {
    flavor: RawFlavorRow;
    studyIds: Set<number>;
    latestStudyId: number;
    latestScoredStudyId: number | null;
    modelCounts: Map<string, number>;
    hasScoredExposure: boolean;
  };
  const flavorAccById = new Map<number, FastFlavorAcc>();

  type FastModelAcc = {
    model: RawModelRow;
    pipeStudyIds: Set<number>;
    hasSynthesis: boolean;
    latestStudyId: number;
    latestScoredStudyId: number | null;
  };
  const modelAccById = new Map<number, FastModelAcc>();

  let totalUnifiedExposures = 0;
  let totalUnifiedPositive = 0;
  const enrichedStudies: EnrichedStudyCatalogEntry[] = [];

  for (const study of liveStudies) {
    const studyNavs = base.navsByStudy.get(study.id) ?? [];
    const studyCaptionIds = Array.from(
      base.captionIdsByStudy.get(study.id) ?? [],
    );
    const likertTot = likertTotalsByStudy.get(study.id) ?? {
      exposures: 0,
      positive: 0,
    };

    const resolvedEra = resolveStudyExposureMode({
      studyId: study.id,
      hasNavigationEvents: studyNavs.length > 0,
      hasVoteEvents: likertTot.exposures > 0,
    });

    const studyParts = base.participationsByStudy.get(study.id) ?? [];
    const partSummary = summarizeStudyParticipations(studyParts);

    let voterCount = 0;
    let studyExposures = 0;
    let studyPositive = 0;
    let swipeCaptionTallies: Map<
      string,
      { exposures: number; positive: number }
    > | null = null;

    if (resolvedEra.mode === "swipe_navigation" && studyNavs.length > 0) {
      const evaluated = evaluateSwipeStudyExposures({
        studyNavs,
        studyVotes: swipeVotesByStudy.get(study.id) ?? [],
      });
      voterCount = evaluated.voterCount;
      studyExposures = evaluated.studyExposures;
      studyPositive = evaluated.studyPositive;
      swipeCaptionTallies = evaluated.captionTallies;
    } else if (likertTot.exposures > 0) {
      voterCount = partSummary.distinctParticipants;
      studyExposures = likertTot.exposures;
      studyPositive = likertTot.positive;
    }

    totalUnifiedExposures += studyExposures;
    totalUnifiedPositive += studyPositive;

    const studyFlavorSlugs = new Set<string>();
    const studyModelNames = new Set<string>();
    const captionsByImage = new Map<string, string[]>();

    for (const captionId of studyCaptionIds) {
      const lineage = base.lineageByCaptionId.get(captionId);
      const captionHasScoredExposure = swipeCaptionTallies
        ? (swipeCaptionTallies.get(captionId)?.exposures ?? 0) > 0
        : studyExposures > 0;
      if (lineage?.imageId) {
        let list = captionsByImage.get(lineage.imageId);
        if (!list) {
          list = [];
          captionsByImage.set(lineage.imageId, list);
        }
        list.push(captionId);
      }

      const flavor =
        lineage?.flavorId !== null && lineage?.flavorId !== undefined
          ? base.flavorsById.get(lineage.flavorId)
          : undefined;
      if (flavor) {
        studyFlavorSlugs.add(flavor.slug);
        let fAcc = flavorAccById.get(flavor.id);
        if (!fAcc) {
          fAcc = {
            flavor,
            studyIds: new Set<number>(),
            latestStudyId: study.id,
            latestScoredStudyId: null,
            modelCounts: new Map<string, number>(),
            hasScoredExposure: false,
          };
          flavorAccById.set(flavor.id, fAcc);
        }
        fAcc.studyIds.add(study.id);
        if (study.id > fAcc.latestStudyId) {
          fAcc.latestStudyId = study.id;
        }
        if (captionHasScoredExposure) {
          fAcc.hasScoredExposure = true;
          if (
            fAcc.latestScoredStudyId === null ||
            study.id > fAcc.latestScoredStudyId
          ) {
            fAcc.latestScoredStudyId = study.id;
          }
        }
        if (
          lineage?.terminalModelId !== null &&
          lineage?.terminalModelId !== undefined
        ) {
          const tModel = base.modelsById.get(lineage.terminalModelId);
          if (tModel) {
            fAcc.modelCounts.set(
              tModel.name,
              (fAcc.modelCounts.get(tModel.name) ?? 0) + 1,
            );
          }
        }
      }

      if (lineage) {
        for (const modelId of lineage.pipelineModelIds) {
          const model = base.modelsById.get(modelId);
          if (!model) continue;
          studyModelNames.add(model.name);
          let mAcc = modelAccById.get(modelId);
          if (!mAcc) {
            mAcc = {
              model,
              pipeStudyIds: new Set<number>(),
              hasSynthesis: false,
              latestStudyId: study.id,
              latestScoredStudyId: null,
            };
            modelAccById.set(modelId, mAcc);
          }
          mAcc.pipeStudyIds.add(study.id);
          if (study.id > mAcc.latestStudyId) {
            mAcc.latestStudyId = study.id;
          }
          if (
            captionHasScoredExposure &&
            (mAcc.latestScoredStudyId === null ||
              study.id > mAcc.latestScoredStudyId)
          ) {
            mAcc.latestScoredStudyId = study.id;
          }
        }
        if (lineage.terminalModelId !== null) {
          const mAcc = modelAccById.get(lineage.terminalModelId);
          if (mAcc) {
            mAcc.hasSynthesis = true;
          }
        }
      }
    }

    // Preserve exact sharedImagePairCount across both eras:
    // - Swipe: evaluated same-image pairs from swipeCaptionTallies.
    // - Scored Likert: crossFlavorImagesByStudy size (keeping Study #20 = 41 so
    //   Featured Benchmark selection matches identically across Tier 1 and Tier 2).
    let sharedImagePairCount = 0;
    if (swipeCaptionTallies) {
      for (const imageCaptionIds of captionsByImage.values()) {
        if (imageCaptionIds.length < 2) continue;
        const distinctFlavorKeys = new Set<string>();
        let evaluatedCount = 0;
        for (const capId of imageCaptionIds) {
          const tally = swipeCaptionTallies.get(capId);
          if (!tally || tally.exposures <= 0) continue;
          evaluatedCount += 1;
          const lin = base.lineageByCaptionId.get(capId);
          distinctFlavorKeys.add(
            lin?.flavorId !== null && lin?.flavorId !== undefined
              ? `flavor:${lin.flavorId}`
              : UNATTRIBUTED_BUCKET_KEY,
          );
        }
        if (evaluatedCount >= 2 && distinctFlavorKeys.size >= 2) {
          sharedImagePairCount += 1;
        }
      }
    } else if (studyExposures > 0) {
      sharedImagePairCount =
        base.crossFlavorImagesByStudy.get(study.id)?.size ?? 0;
    }

    const studyCi = computeWilsonConfidenceInterval(
      studyPositive,
      studyExposures,
    );
    const friendlyTitle = formatFriendlyStudyTitle(study);
    const formatDisplayLabel: StudyFormatDisplayLabel =
      resolvedEra.mode === "swipe_navigation" ? "Swipe" : "Rating scale";

    enrichedStudies.push({
      id: study.id,
      slug: study.slug,
      rawTitle: getStudyTitle(study),
      title: friendlyTitle,
      description: study.description,
      customDescription: extractCustomStudyDescription(
        study.description,
        friendlyTitle,
      ),
      start_datetime_utc: study.start_datetime_utc,
      end_datetime_utc: study.end_datetime_utc,
      created_datetime_utc: study.created_datetime_utc,
      is_hidden: study.is_hidden,
      is_private: study.is_private,
      status: getStudyLifecycleStatus(study, nowMs),
      exposureMode: resolvedEra.mode,
      isTransitionalLikert: resolvedEra.isTransitionalLikert,
      formatLabel: resolvedEra.mode === "swipe_navigation" ? "Swipe" : "Likert",
      formatDisplayLabel,
      detailHref: resolvedEra.detailHref,
      captionCount: studyCaptionIds.length,
      flavorCount: studyFlavorSlugs.size,
      modelCount: studyModelNames.size,
      flavorSlugs: Array.from(studyFlavorSlugs).sort((a, b) =>
        a.localeCompare(b),
      ),
      modelNames: Array.from(studyModelNames).sort((a, b) =>
        a.localeCompare(b),
      ),
      voterCount,
      exposureCount: studyExposures,
      positiveCount: studyPositive,
      positiveRate: studyCi.rate,
      ciLow: studyCi.low,
      ciHigh: studyCi.high,
      participationsStarted: partSummary.started,
      participationsEnded: partSummary.ended,
      completionRate:
        partSummary.started > 0 ? partSummary.ended / partSummary.started : null,
      medianRunMinutes: partSummary.medianRunMinutes,
      sharedImagePairCount,
    });
  }

  const evaluatedFlavors: FastCatalogFlavorSummary[] = [];
  let scoredFlavorCount = 0;
  for (const acc of flavorAccById.values()) {
    if (acc.hasScoredExposure) {
      scoredFlavorCount += 1;
    }
    let primarySynthesisModel: string | null = null;
    let maxModelCount = -1;
    for (const [modelName, count] of acc.modelCounts.entries()) {
      if (
        count > maxModelCount ||
        (count === maxModelCount &&
          primarySynthesisModel !== null &&
          modelName.localeCompare(primarySynthesisModel) < 0)
      ) {
        maxModelCount = count;
        primarySynthesisModel = modelName;
      }
    }
    if (primarySynthesisModel === null) {
      const configuredSteps = base.stepsByFlavorId.get(acc.flavor.id) ?? [];
      if (configuredSteps.length > 0) {
        const last = configuredSteps[configuredSteps.length - 1];
        const m = base.modelsById.get(last.llm_model_id);
        primarySynthesisModel =
          m?.name ?? m?.provider_model_id ?? `Model #${last.llm_model_id}`;
      }
    }
    evaluatedFlavors.push({
      flavorId: acc.flavor.id,
      slug: acc.flavor.slug,
      description: acc.flavor.description,
      primarySynthesisModel,
      studyCount: acc.studyIds.size,
      latestStudyId: acc.latestScoredStudyId ?? acc.latestStudyId,
    });
  }
  evaluatedFlavors.sort(
    (a, b) => b.studyCount - a.studyCount || a.slug.localeCompare(b.slug),
  );

  const unevaluatedFlavors: UnevaluatedFlavorCatalogItem[] = base.flavors
    .filter((flavor) => !flavorAccById.has(flavor.id))
    .map((flavor) => ({
      flavorId: flavor.id,
      slug: flavor.slug,
      description: flavor.description,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const evaluatedModels: FastCatalogModelSummary[] = [];
  let synthesisModelCount = 0;
  for (const acc of modelAccById.values()) {
    const primaryRole: "synthesis" | "pipeline_step" = acc.hasSynthesis
      ? "synthesis"
      : "pipeline_step";
    if (acc.hasSynthesis) {
      synthesisModelCount += 1;
    }
    evaluatedModels.push({
      modelId: acc.model.id,
      name: acc.model.name,
      providerModelId: acc.model.provider_model_id,
      providerName:
        base.providersById.get(acc.model.llm_provider_id)?.name ?? "Unknown",
      primaryRole,
      studyCount: acc.pipeStudyIds.size,
      latestStudyId: acc.latestScoredStudyId ?? acc.latestStudyId,
    });
  }
  evaluatedModels.sort((a, b) => {
    const aSynth = a.primaryRole === "synthesis" ? 1 : 0;
    const bSynth = b.primaryRole === "synthesis" ? 1 : 0;
    if (aSynth !== bSynth) return bSynth - aSynth;
    if (b.studyCount !== a.studyCount) return b.studyCount - a.studyCount;
    return a.name.localeCompare(b.name);
  });

  const unevaluatedModels: UnevaluatedModelCatalogItem[] = base.models
    .filter((model) => !modelAccById.has(model.id))
    .map((model) => ({
      modelId: model.id,
      name: model.name,
      providerModelId: model.provider_model_id,
      providerName:
        base.providersById.get(model.llm_provider_id)?.name ?? "Unknown",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    studies: enrichedStudies,
    latestScoredStudy: selectLatestScoredStudy(enrichedStudies),
    featuredBenchmarkStudy: selectFeaturedBenchmarkStudy(enrichedStudies),
    evaluatedFlavors,
    unevaluatedFlavors,
    unusedFlavorCount: unevaluatedFlavors.length,
    evaluatedModels,
    unevaluatedModels,
    kpis: buildGlobalHubKpis({
      enrichedStudies,
      participations: base.participations,
      totalFlavorCount: base.flavors.length,
      testedFlavorCount: evaluatedFlavors.length,
      scoredFlavorCount,
      totalModelCount: base.models.length,
      testedModelCount: evaluatedModels.length,
      synthesisModelCount,
      mappedCaptionCount: base.distinctMappedCaptionIds.length,
      totalVoteEvents: base.totalVoteEvents,
      totalNavigationEvents: base.navigationRows.length,
      totalUnifiedExposures,
      totalUnifiedPositive,
      surveyedProfileCount: base.surveyedProfileCount,
    }),
  };
}

async function loadGlobalAttributionDatasetUncached(
  supabase: SupabaseClient<Database>,
  liveStudies: readonly StudySummaryRow[],
  nowMs: number,
  options?: { pageSize?: number; concurrency?: number },
): Promise<GlobalAttributionDataset> {
  const pageSize = options?.pageSize ?? DEFAULT_QUERY_PAGE_SIZE;
  const concurrency = options?.concurrency ?? GLOBAL_RANGE_CONCURRENCY;
  const limitQuery = createConcurrencyLimiter(concurrency);

  const base = await loadSharedGlobalFoundationUncached(supabase, liveStudies, {
    ...options,
    limitQuery,
  });

  // Partition non-Swipe studies into cross-flavor shared-image mappings (requiring
  // per-caption tallies for same-image lift) vs non-shared lineage buckets (exact HEAD counts).
  const sharedLikertMappingIds: number[] = [];
  type NonSharedBucket = {
    studyId: number;
    lineageGroupKey: string;
    representativeCaptionId: string;
    mappingIds: number[];
  };
  const nonSharedLikertBuckets: NonSharedBucket[] = [];

  for (const study of liveStudies) {
    const studyMaps = base.mappingsByStudy.get(study.id) ?? [];
    if (studyMaps.length === 0) {
      continue;
    }
    const hasNavs = (base.navsByStudy.get(study.id)?.length ?? 0) > 0;
    if (study.id >= NEW_STYLE_MIN_STUDY_ID && hasNavs) {
      continue;
    }

    const crossFlavorImageIds =
      base.crossFlavorImagesByStudy.get(study.id) ?? new Set<string>();
    const bucketsForStudy = new Map<string, NonSharedBucket>();

    for (const m of studyMaps) {
      const lin = base.lineageByCaptionId.get(m.caption_id);
      if (lin?.imageId && crossFlavorImageIds.has(lin.imageId)) {
        sharedLikertMappingIds.push(m.id);
      } else {
        const gKey = lin?.lineageGroupKey ?? "unattributed";
        let bucket = bucketsForStudy.get(gKey);
        if (!bucket) {
          bucket = {
            studyId: study.id,
            lineageGroupKey: gKey,
            representativeCaptionId: m.caption_id,
            mappingIds: [],
          };
          bucketsForStudy.set(gKey, bucket);
        }
        bucket.mappingIds.push(m.id);
      }
    }

    for (const bucket of bucketsForStudy.values()) {
      nonSharedLikertBuckets.push(bucket);
    }
  }

  const [swipeVoteRows, sharedLikertVoteRows, bucketTallies] = await Promise.all(
    [
      fetchRowsByIdChunks<number, SwipeVoteRow>({
        ids: base.swipeMappingIds,
        contextLabel: "swipe study vote events",
        chunkSize: SWIPE_VOTE_MAPPING_CHUNK_SIZE,
        pageSize,
        concurrency,
        runQuery: (chunk, from, to) =>
          limitQuery(
            () =>
              supabase
                .from("study_caption_vote_events")
                .select("id, profile_id, study_caption_mapping_id, session_id")
                .in("study_caption_mapping_id", chunk)
                .order("study_caption_mapping_id", { ascending: true })
                .order("id", { ascending: true })
                .range(from, to) as PromiseLike<
                SupabaseListResult<SwipeVoteRow>
              >,
          ),
      }),
      fetchRowsByIdChunks<number, SharedLikertVoteRow>({
        ids: sharedLikertMappingIds,
        contextLabel: "shared-image Likert vote events",
        chunkSize: SHARED_LIKERT_MAPPING_CHUNK_SIZE,
        pageSize,
        concurrency,
        runQuery: (chunk, from, to) =>
          limitQuery(
            () =>
              supabase
                .from("study_caption_vote_events")
                .select("id, study_caption_mapping_id, vote_value")
                .in("study_caption_mapping_id", chunk)
                .order("study_caption_mapping_id", { ascending: true })
                .order("id", { ascending: true })
                .range(from, to) as PromiseLike<
                SupabaseListResult<SharedLikertVoteRow>
              >,
          ),
      }),
      mapWithConcurrency(
        nonSharedLikertBuckets,
        concurrency,
        async (bucket) => {
          const exposures = await sumExactCountsByIdChunks({
            ids: bucket.mappingIds,
            contextLabel: `likert exposures study ${bucket.studyId}`,
            chunkSize: INTEGER_HEAD_CHUNK_SIZE,
            concurrency,
            runQuery: (chunk) =>
              limitQuery(() =>
                supabase
                  .from("study_caption_vote_events")
                  .select("id", { count: "exact", head: true })
                  .in("study_caption_mapping_id", chunk),
              ),
          });
          const positive =
            exposures > 0
              ? await sumExactCountsByIdChunks({
                  ids: bucket.mappingIds,
                  contextLabel: `likert positive study ${bucket.studyId}`,
                  chunkSize: INTEGER_HEAD_CHUNK_SIZE,
                  concurrency,
                  runQuery: (chunk) =>
                    limitQuery(() =>
                      supabase
                        .from("study_caption_vote_events")
                        .select("id", { count: "exact", head: true })
                        .in("study_caption_mapping_id", chunk)
                        .in("vote_value", ["funny", "very funny"]),
                    ),
                })
              : 0;
          return { bucket, exposures, positive };
        },
      ),
    ],
  );

  const swipeVotesByStudy = groupSwipeVotesByStudy(
    swipeVoteRows,
    base.mappingById,
  );

  const sharedTalliesByStudyCaption = new Map<
    string,
    { exposures: number; positive: number }
  >();
  const sharedTotalsByStudy = new Map<
    number,
    { exposures: number; positive: number }
  >();

  for (const vote of sharedLikertVoteRows) {
    if (vote.study_caption_mapping_id === null) continue;
    const m = base.mappingById.get(vote.study_caption_mapping_id);
    if (!m) continue;
    const liked = isPositiveStudyVote(vote.vote_value);

    const scKey = `${m.study_id}|${m.caption_id}`;
    let scTally = sharedTalliesByStudyCaption.get(scKey);
    if (!scTally) {
      scTally = { exposures: 0, positive: 0 };
      sharedTalliesByStudyCaption.set(scKey, scTally);
    }
    scTally.exposures += 1;
    if (liked) scTally.positive += 1;

    let stTally = sharedTotalsByStudy.get(m.study_id);
    if (!stTally) {
      stTally = { exposures: 0, positive: 0 };
      sharedTotalsByStudy.set(m.study_id, stTally);
    }
    stTally.exposures += 1;
    if (liked) stTally.positive += 1;
  }

  const nonSharedTalliesByStudy = new Map<
    number,
    Array<{
      representativeCaptionId: string;
      exposures: number;
      positive: number;
    }>
  >();
  for (const { bucket, exposures, positive } of bucketTallies) {
    let list = nonSharedTalliesByStudy.get(bucket.studyId);
    if (!list) {
      list = [];
      nonSharedTalliesByStudy.set(bucket.studyId, list);
    }
    list.push({
      representativeCaptionId: bucket.representativeCaptionId,
      exposures,
      positive,
    });
  }

  type MutableFlavorStudyPoint = {
    studyId: number;
    captionIds: Set<string>;
    exposures: number;
    positive: number;
    lifts: number[];
  };
  type MutableFlavorAcc = {
    flavor: RawFlavorRow;
    studies: Map<number, MutableFlavorStudyPoint>;
    captionIds: Set<string>;
    modelCounts: Map<string, number>;
    samplePipelineSteps: string[];
    exposures: number;
    positive: number;
    swipeExposures: number;
    swipePositive: number;
    ratingScaleExposures: number;
    ratingScalePositive: number;
    sharedImageKeys: Set<string>;
    lifts: number[];
    wins: number;
    losses: number;
    ties: number;
  };
  const flavorAccById = new Map<number, MutableFlavorAcc>();
  const getFlavorAcc = (flavor: RawFlavorRow): MutableFlavorAcc => {
    let acc = flavorAccById.get(flavor.id);
    if (!acc) {
      acc = {
        flavor,
        studies: new Map<number, MutableFlavorStudyPoint>(),
        captionIds: new Set<string>(),
        modelCounts: new Map<string, number>(),
        samplePipelineSteps: [],
        exposures: 0,
        positive: 0,
        swipeExposures: 0,
        swipePositive: 0,
        ratingScaleExposures: 0,
        ratingScalePositive: 0,
        sharedImageKeys: new Set<string>(),
        lifts: [],
        wins: 0,
        losses: 0,
        ties: 0,
      };
      flavorAccById.set(flavor.id, acc);
    }
    return acc;
  };

  type MutableModelStudyPoint = {
    studyId: number;
    hasSynthesis: boolean;
    synthCaptionIds: Set<string>;
    synthExposures: number;
    synthPositive: number;
    pipeCaptionIds: Set<string>;
    pipeExposures: number;
    pipePositive: number;
  };
  type MutableModelAcc = {
    model: RawModelRow;
    studies: Map<number, MutableModelStudyPoint>;
    synthStudyIds: Set<number>;
    synthFlavorIds: Set<number>;
    synthCaptionIds: Set<string>;
    synthExposures: number;
    synthPositive: number;
    pipeStudyIds: Set<number>;
    pipeFlavorIds: Set<number>;
    pipeCaptionIds: Set<string>;
    pipeExposures: number;
    pipePositive: number;
    chainLatencies: number[];
  };
  const modelAccById = new Map<number, MutableModelAcc>();
  const getModelAcc = (model: RawModelRow): MutableModelAcc => {
    let acc = modelAccById.get(model.id);
    if (!acc) {
      acc = {
        model,
        studies: new Map<number, MutableModelStudyPoint>(),
        synthStudyIds: new Set<number>(),
        synthFlavorIds: new Set<number>(),
        synthCaptionIds: new Set<string>(),
        synthExposures: 0,
        synthPositive: 0,
        pipeStudyIds: new Set<number>(),
        pipeFlavorIds: new Set<number>(),
        pipeCaptionIds: new Set<string>(),
        pipeExposures: 0,
        pipePositive: 0,
        chainLatencies: [],
      };
      modelAccById.set(model.id, acc);
    }
    return acc;
  };

  const addLineageExposureContribution = ({
    studyId,
    lineage,
    exposures,
    positive,
    mode,
  }: {
    studyId: number;
    lineage: ResolvedCaptionLineage | undefined;
    exposures: number;
    positive: number;
    mode: StudyExposureMode;
  }) => {
    if (!lineage || (exposures === 0 && positive === 0)) {
      return;
    }

    if (lineage.flavorId !== null) {
      const flavor = base.flavorsById.get(lineage.flavorId);
      if (flavor) {
        const fAcc = getFlavorAcc(flavor);
        fAcc.exposures += exposures;
        fAcc.positive += positive;
        if (mode === "swipe_navigation") {
          fAcc.swipeExposures += exposures;
          fAcc.swipePositive += positive;
        } else {
          fAcc.ratingScaleExposures += exposures;
          fAcc.ratingScalePositive += positive;
        }
        const sPoint = fAcc.studies.get(studyId);
        if (sPoint) {
          sPoint.exposures += exposures;
          sPoint.positive += positive;
        }
      }
    }

    for (const modelId of lineage.pipelineModelIds) {
      const model = base.modelsById.get(modelId);
      if (!model) continue;
      const mAcc = getModelAcc(model);
      mAcc.pipeExposures += exposures;
      mAcc.pipePositive += positive;
      const mPoint = mAcc.studies.get(studyId);
      if (mPoint) {
        mPoint.pipeExposures += exposures;
        mPoint.pipePositive += positive;
      }
    }

    if (lineage.terminalModelId !== null) {
      const tModel = base.modelsById.get(lineage.terminalModelId);
      if (tModel) {
        const mAcc = getModelAcc(tModel);
        mAcc.synthExposures += exposures;
        mAcc.synthPositive += positive;
        const mPoint = mAcc.studies.get(studyId);
        if (mPoint) {
          mPoint.synthExposures += exposures;
          mPoint.synthPositive += positive;
        }
      }
    }
  };

  const recordedLatencyKeys = new Set<string>();
  let totalUnifiedExposures = 0;
  let totalUnifiedPositive = 0;
  const enrichedStudies: EnrichedStudyCatalogEntry[] = [];

  for (const study of liveStudies) {
    const studyNavs = base.navsByStudy.get(study.id) ?? [];
    const studyCaptionIds = Array.from(
      base.captionIdsByStudy.get(study.id) ?? [],
    );

    const sharedTots = sharedTotalsByStudy.get(study.id) ?? {
      exposures: 0,
      positive: 0,
    };
    const nonSharedList = nonSharedTalliesByStudy.get(study.id) ?? [];
    const likertExpTotal =
      sharedTots.exposures +
      nonSharedList.reduce((sum, item) => sum + item.exposures, 0);
    const likertPosTotal =
      sharedTots.positive +
      nonSharedList.reduce((sum, item) => sum + item.positive, 0);

    const resolvedEra = resolveStudyExposureMode({
      studyId: study.id,
      hasNavigationEvents: studyNavs.length > 0,
      hasVoteEvents: likertExpTotal > 0,
    });

    const studyFlavorSlugs = new Set<string>();
    const studyModelNames = new Set<string>();
    const captionsByImage = new Map<string, string[]>();

    for (const captionId of studyCaptionIds) {
      const lineage = base.lineageByCaptionId.get(captionId);
      if (lineage?.imageId) {
        let list = captionsByImage.get(lineage.imageId);
        if (!list) {
          list = [];
          captionsByImage.set(lineage.imageId, list);
        }
        list.push(captionId);
      }

      const flavor =
        lineage?.flavorId !== null && lineage?.flavorId !== undefined
          ? base.flavorsById.get(lineage.flavorId)
          : undefined;
      if (flavor) {
        studyFlavorSlugs.add(flavor.slug);
        const fAcc = getFlavorAcc(flavor);
        fAcc.captionIds.add(captionId);
        if (
          fAcc.samplePipelineSteps.length === 0 &&
          lineage &&
          lineage.pipelineStepNames.length > 0
        ) {
          fAcc.samplePipelineSteps = lineage.pipelineStepNames;
        }
        if (
          lineage?.terminalModelId !== null &&
          lineage?.terminalModelId !== undefined
        ) {
          const tModel = base.modelsById.get(lineage.terminalModelId);
          if (tModel) {
            fAcc.modelCounts.set(
              tModel.name,
              (fAcc.modelCounts.get(tModel.name) ?? 0) + 1,
            );
          }
        }
        let sPoint = fAcc.studies.get(study.id);
        if (!sPoint) {
          sPoint = {
            studyId: study.id,
            captionIds: new Set<string>(),
            exposures: 0,
            positive: 0,
            lifts: [],
          };
          fAcc.studies.set(study.id, sPoint);
        }
        sPoint.captionIds.add(captionId);
      }

      if (lineage) {
        for (const modelId of lineage.pipelineModelIds) {
          const model = base.modelsById.get(modelId);
          if (!model) continue;
          studyModelNames.add(model.name);
          const mAcc = getModelAcc(model);
          mAcc.pipeStudyIds.add(study.id);
          mAcc.pipeCaptionIds.add(captionId);
          if (lineage.flavorId !== null) {
            mAcc.pipeFlavorIds.add(lineage.flavorId);
          }
          let mPoint = mAcc.studies.get(study.id);
          if (!mPoint) {
            mPoint = {
              studyId: study.id,
              hasSynthesis: false,
              synthCaptionIds: new Set<string>(),
              synthExposures: 0,
              synthPositive: 0,
              pipeCaptionIds: new Set<string>(),
              pipeExposures: 0,
              pipePositive: 0,
            };
            mAcc.studies.set(study.id, mPoint);
          }
          mPoint.pipeCaptionIds.add(captionId);

          const latencyKey = `${modelId}|${captionId}`;
          if (
            lineage.chainLatencySeconds !== null &&
            !recordedLatencyKeys.has(latencyKey)
          ) {
            recordedLatencyKeys.add(latencyKey);
            mAcc.chainLatencies.push(lineage.chainLatencySeconds);
          }
        }

        if (lineage.terminalModelId !== null) {
          const tModel = base.modelsById.get(lineage.terminalModelId);
          if (tModel) {
            const mAcc = getModelAcc(tModel);
            mAcc.synthStudyIds.add(study.id);
            mAcc.synthCaptionIds.add(captionId);
            if (lineage.flavorId !== null) {
              mAcc.synthFlavorIds.add(lineage.flavorId);
            }
            const mPoint = mAcc.studies.get(study.id);
            if (mPoint) {
              mPoint.hasSynthesis = true;
              mPoint.synthCaptionIds.add(captionId);
            }
          }
        }
      }
    }

    const studyParts = base.participationsByStudy.get(study.id) ?? [];
    const partSummary = summarizeStudyParticipations(studyParts);

    const captionTalliesForLift = new Map<
      string,
      { exposures: number; positive: number }
    >();
    let voterCount = 0;
    let studyExposures = 0;
    let studyPositive = 0;

    if (resolvedEra.mode === "swipe_navigation" && studyNavs.length > 0) {
      const evaluated = evaluateSwipeStudyExposures({
        studyNavs,
        studyVotes: swipeVotesByStudy.get(study.id) ?? [],
      });
      voterCount = evaluated.voterCount;
      studyExposures = evaluated.studyExposures;
      studyPositive = evaluated.studyPositive;

      for (const [capId, tally] of evaluated.captionTallies.entries()) {
        captionTalliesForLift.set(capId, tally);
        addLineageExposureContribution({
          studyId: study.id,
          lineage: base.lineageByCaptionId.get(capId),
          exposures: tally.exposures,
          positive: tally.positive,
          mode: resolvedEra.mode,
        });
      }
    } else if (likertExpTotal > 0) {
      voterCount = partSummary.distinctParticipants;
      studyExposures = likertExpTotal;
      studyPositive = likertPosTotal;

      for (const capId of studyCaptionIds) {
        const scTally = sharedTalliesByStudyCaption.get(
          `${study.id}|${capId}`,
        );
        if (scTally) {
          captionTalliesForLift.set(capId, scTally);
          addLineageExposureContribution({
            studyId: study.id,
            lineage: base.lineageByCaptionId.get(capId),
            exposures: scTally.exposures,
            positive: scTally.positive,
            mode: "likert_votes",
          });
        }
      }

      for (const item of nonSharedList) {
        addLineageExposureContribution({
          studyId: study.id,
          lineage: base.lineageByCaptionId.get(item.representativeCaptionId),
          exposures: item.exposures,
          positive: item.positive,
          mode: "likert_votes",
        });
      }
    }

    totalUnifiedExposures += studyExposures;
    totalUnifiedPositive += studyPositive;

    let sharedImagePairCount = 0;
    for (const [imageId, imageCaptionIds] of captionsByImage.entries()) {
      if (imageCaptionIds.length < 2) {
        continue;
      }
      const evaluatedCards: Array<{
        flavorId: number | null;
        flavorKey: string;
        rate: number;
      }> = [];
      for (const capId of imageCaptionIds) {
        const tally = captionTalliesForLift.get(capId);
        if (!tally || tally.exposures <= 0) {
          continue;
        }
        const lineage = base.lineageByCaptionId.get(capId);
        const fId = lineage?.flavorId ?? null;
        evaluatedCards.push({
          flavorId: fId,
          flavorKey: fId !== null ? `flavor:${fId}` : UNATTRIBUTED_BUCKET_KEY,
          rate: tally.positive / tally.exposures,
        });
      }
      if (evaluatedCards.length < 2) {
        continue;
      }
      const distinctFlavorKeys = new Set(
        evaluatedCards.map((card) => card.flavorKey),
      );
      if (distinctFlavorKeys.size < 2) {
        continue;
      }

      sharedImagePairCount += 1;
      const imageMean =
        evaluatedCards.reduce((sum, card) => sum + card.rate, 0) /
        evaluatedCards.length;

      for (const card of evaluatedCards) {
        if (card.flavorId === null) continue;
        const fAcc = flavorAccById.get(card.flavorId);
        if (!fAcc) continue;
        const residual = card.rate - imageMean;
        fAcc.sharedImageKeys.add(`${study.id}|${imageId}`);
        fAcc.lifts.push(residual);
        fAcc.studies.get(study.id)?.lifts.push(residual);
      }

      for (let i = 0; i < evaluatedCards.length; i += 1) {
        for (let j = i + 1; j < evaluatedCards.length; j += 1) {
          const left = evaluatedCards[i];
          const right = evaluatedCards[j];
          if (left.flavorKey === right.flavorKey) continue;
          const leftAcc =
            left.flavorId !== null
              ? flavorAccById.get(left.flavorId)
              : undefined;
          const rightAcc =
            right.flavorId !== null
              ? flavorAccById.get(right.flavorId)
              : undefined;
          const diff = left.rate - right.rate;
          if (Math.abs(diff) <= TIE_EPSILON) {
            if (leftAcc) leftAcc.ties += 1;
            if (rightAcc) rightAcc.ties += 1;
          } else if (diff > 0) {
            if (leftAcc) leftAcc.wins += 1;
            if (rightAcc) rightAcc.losses += 1;
          } else {
            if (leftAcc) leftAcc.losses += 1;
            if (rightAcc) rightAcc.wins += 1;
          }
        }
      }
    }

    const studyCi = computeWilsonConfidenceInterval(
      studyPositive,
      studyExposures,
    );
    const friendlyTitle = formatFriendlyStudyTitle(study);
    const formatDisplayLabel: StudyFormatDisplayLabel =
      resolvedEra.mode === "swipe_navigation" ? "Swipe" : "Rating scale";

    enrichedStudies.push({
      id: study.id,
      slug: study.slug,
      rawTitle: getStudyTitle(study),
      title: friendlyTitle,
      description: study.description,
      customDescription: extractCustomStudyDescription(
        study.description,
        friendlyTitle,
      ),
      start_datetime_utc: study.start_datetime_utc,
      end_datetime_utc: study.end_datetime_utc,
      created_datetime_utc: study.created_datetime_utc,
      is_hidden: study.is_hidden,
      is_private: study.is_private,
      status: getStudyLifecycleStatus(study, nowMs),
      exposureMode: resolvedEra.mode,
      isTransitionalLikert: resolvedEra.isTransitionalLikert,
      formatLabel: resolvedEra.mode === "swipe_navigation" ? "Swipe" : "Likert",
      formatDisplayLabel,
      detailHref: resolvedEra.detailHref,
      captionCount: studyCaptionIds.length,
      flavorCount: studyFlavorSlugs.size,
      modelCount: studyModelNames.size,
      flavorSlugs: Array.from(studyFlavorSlugs).sort((a, b) =>
        a.localeCompare(b),
      ),
      modelNames: Array.from(studyModelNames).sort((a, b) =>
        a.localeCompare(b),
      ),
      voterCount,
      exposureCount: studyExposures,
      positiveCount: studyPositive,
      positiveRate: studyCi.rate,
      ciLow: studyCi.low,
      ciHigh: studyCi.high,
      participationsStarted: partSummary.started,
      participationsEnded: partSummary.ended,
      completionRate:
        partSummary.started > 0 ? partSummary.ended / partSummary.started : null,
      medianRunMinutes: partSummary.medianRunMinutes,
      sharedImagePairCount,
    });
  }

  const enrichedStudyById = new Map(
    enrichedStudies.map((study) => [study.id, study]),
  );

  const flavorRows: GlobalFlavorLeaderboardRow[] = [];
  for (const acc of flavorAccById.values()) {
    const ci = computeWilsonConfidenceInterval(acc.positive, acc.exposures);
    const configuredSteps = base.stepsByFlavorId.get(acc.flavor.id) ?? [];
    const pipelineSteps =
      acc.samplePipelineSteps.length > 0
        ? acc.samplePipelineSteps
        : configuredSteps.map((step) => {
            const m = base.modelsById.get(step.llm_model_id);
            return (
              m?.name ?? m?.provider_model_id ?? `Model #${step.llm_model_id}`
            );
          });

    let primarySynthesisModel: string | null = null;
    let maxModelCount = -1;
    for (const [modelName, count] of acc.modelCounts.entries()) {
      if (
        count > maxModelCount ||
        (count === maxModelCount &&
          primarySynthesisModel !== null &&
          modelName.localeCompare(primarySynthesisModel) < 0)
      ) {
        maxModelCount = count;
        primarySynthesisModel = modelName;
      }
    }
    if (primarySynthesisModel === null && pipelineSteps.length > 0) {
      primarySynthesisModel = pipelineSteps[pipelineSteps.length - 1];
    }

    const meanLiftPp =
      acc.lifts.length > 0
        ? Number(
            (
              (acc.lifts.reduce((sum, val) => sum + val, 0) / acc.lifts.length) *
              100
            ).toFixed(4),
          )
        : null;

    let scoredStudyCount = 0;
    let swipeStudyCount = 0;
    let ratingScaleStudyCount = 0;
    const studyBreakdowns: GlobalFlavorStudyBreakdown[] = [];

    for (const point of acc.studies.values()) {
      const studyMeta = enrichedStudyById.get(point.studyId);
      if (!studyMeta) continue;
      if (point.exposures > 0) scoredStudyCount += 1;
      if (studyMeta.exposureMode === "swipe_navigation") {
        swipeStudyCount += 1;
      } else {
        ratingScaleStudyCount += 1;
      }
      const pointCi = computeWilsonConfidenceInterval(
        point.positive,
        point.exposures,
      );
      const pointLiftPp =
        point.lifts.length > 0
          ? Number(
              (
                (point.lifts.reduce((sum, val) => sum + val, 0) /
                  point.lifts.length) *
                100
              ).toFixed(4),
            )
          : null;
      const encodedSlug = encodeURIComponent(acc.flavor.slug);
      studyBreakdowns.push({
        studyId: studyMeta.id,
        studyTitle: studyMeta.title,
        studySlug: studyMeta.slug,
        exposureMode: studyMeta.exposureMode,
        formatDisplayLabel: studyMeta.formatDisplayLabel,
        studyFlavorCount: studyMeta.flavorCount,
        sharedImagePairCount: studyMeta.sharedImagePairCount,
        captionCount: point.captionIds.size,
        exposures: point.exposures,
        positive: point.positive,
        rate: pointCi.rate,
        ciLow: pointCi.low,
        ciHigh: pointCi.high,
        meanLiftPp: pointLiftPp,
        attributionHref: `/study/${studyMeta.id}/attribution?flavor=${encodedSlug}`,
        headToHeadHref:
          studyMeta.flavorCount >= 2 && studyMeta.sharedImagePairCount > 0
            ? `/study/${studyMeta.id}/head-to-head?flavor=${encodedSlug}`
            : null,
      });
    }

    studyBreakdowns.sort((a, b) => {
      const aScored = a.exposures > 0 ? 1 : 0;
      const bScored = b.exposures > 0 ? 1 : 0;
      if (aScored !== bScored) return bScored - aScored;
      if (b.exposures !== a.exposures) return b.exposures - a.exposures;
      return b.studyId - a.studyId;
    });

    flavorRows.push({
      flavorId: acc.flavor.id,
      slug: acc.flavor.slug,
      description: acc.flavor.description,
      stepCount:
        configuredSteps.length > 0
          ? configuredSteps.length
          : pipelineSteps.length,
      primarySynthesisModel,
      pipelineSteps,
      studyCount: studyBreakdowns.length,
      scoredStudyCount,
      swipeStudyCount,
      ratingScaleStudyCount,
      captionCount: acc.captionIds.size,
      exposures: acc.exposures,
      positive: acc.positive,
      swipeExposures: acc.swipeExposures,
      swipePositive: acc.swipePositive,
      ratingScaleExposures: acc.ratingScaleExposures,
      ratingScalePositive: acc.ratingScalePositive,
      rate: ci.rate,
      ciLow: ci.low,
      ciHigh: ci.high,
      sharedImageCount: acc.sharedImageKeys.size,
      meanLiftPp,
      pairWins: acc.wins,
      pairLosses: acc.losses,
      pairTies: acc.ties,
      studies: studyBreakdowns,
    });
  }

  flavorRows.sort((left, right) => {
    const leftCi = left.ciLow ?? -1;
    const rightCi = right.ciLow ?? -1;
    if (leftCi !== rightCi) return rightCi - leftCi;
    const leftRate = left.rate ?? -1;
    const rightRate = right.rate ?? -1;
    if (leftRate !== rightRate) return rightRate - leftRate;
    if (left.exposures !== right.exposures) {
      return right.exposures - left.exposures;
    }
    return left.slug.localeCompare(right.slug);
  });

  const unevaluatedFlavors: UnevaluatedFlavorCatalogItem[] = base.flavors
    .filter((flavor) => !flavorAccById.has(flavor.id))
    .map((flavor) => ({
      flavorId: flavor.id,
      slug: flavor.slug,
      description: flavor.description,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const modelRows: GlobalModelLeaderboardRow[] = [];
  for (const acc of modelAccById.values()) {
    const synthCi = computeWilsonConfidenceInterval(
      acc.synthPositive,
      acc.synthExposures,
    );
    const pipeCi = computeWilsonConfidenceInterval(
      acc.pipePositive,
      acc.pipeExposures,
    );
    const primaryRole: "synthesis" | "pipeline_step" =
      acc.synthCaptionIds.size > 0 ? "synthesis" : "pipeline_step";

    const studyBreakdowns: GlobalModelStudyBreakdown[] = [];
    for (const point of acc.studies.values()) {
      const studyMeta = enrichedStudyById.get(point.studyId);
      if (!studyMeta) continue;
      const role: "synthesis" | "pipeline_step" = point.hasSynthesis
        ? "synthesis"
        : "pipeline_step";
      const exposures = point.hasSynthesis
        ? point.synthExposures
        : point.pipeExposures;
      const positive = point.hasSynthesis
        ? point.synthPositive
        : point.pipePositive;
      const captionCount = point.hasSynthesis
        ? point.synthCaptionIds.size
        : point.pipeCaptionIds.size;
      const pointCi = computeWilsonConfidenceInterval(positive, exposures);

      studyBreakdowns.push({
        studyId: studyMeta.id,
        studyTitle: studyMeta.title,
        studySlug: studyMeta.slug,
        formatDisplayLabel: studyMeta.formatDisplayLabel,
        role,
        captionCount,
        exposures,
        positive,
        rate: pointCi.rate,
        ciLow: pointCi.low,
        ciHigh: pointCi.high,
        href:
          role === "synthesis"
            ? `/study/${studyMeta.id}/attribution?groupBy=model&model=${acc.model.id}`
            : `/study/${studyMeta.id}/attribution?groupBy=pipeline`,
      });
    }

    studyBreakdowns.sort((a, b) => {
      const aSynth = a.role === "synthesis" ? 1 : 0;
      const bSynth = b.role === "synthesis" ? 1 : 0;
      if (aSynth !== bSynth) return bSynth - aSynth;
      const aScored = a.exposures > 0 ? 1 : 0;
      const bScored = b.exposures > 0 ? 1 : 0;
      if (aScored !== bScored) return bScored - aScored;
      if (b.exposures !== a.exposures) return b.exposures - a.exposures;
      return b.studyId - a.studyId;
    });

    modelRows.push({
      modelId: acc.model.id,
      name: acc.model.name,
      providerModelId: acc.model.provider_model_id,
      providerName:
        base.providersById.get(acc.model.llm_provider_id)?.name ?? "Unknown",
      primaryRole,
      synthesisStudyCount: acc.synthStudyIds.size,
      synthesisFlavorCount: acc.synthFlavorIds.size,
      synthesisCaptionCount: acc.synthCaptionIds.size,
      synthesisExposures: acc.synthExposures,
      synthesisPositive: acc.synthPositive,
      synthesisRate: synthCi.rate,
      synthesisCiLow: synthCi.low,
      synthesisCiHigh: synthCi.high,
      pipelineStudyCount: acc.pipeStudyIds.size,
      pipelineFlavorCount: acc.pipeFlavorIds.size,
      pipelineCaptionCount: acc.pipeCaptionIds.size,
      pipelineExposures: acc.pipeExposures,
      pipelinePositive: acc.pipePositive,
      pipelineRate: pipeCi.rate,
      pipelineCiLow: pipeCi.low,
      pipelineCiHigh: pipeCi.high,
      medianChainSeconds: computeMedian(acc.chainLatencies),
      studies: studyBreakdowns,
    });
  }

  modelRows.sort((left, right) => {
    const leftHasSynth = left.synthesisExposures > 0 ? 1 : 0;
    const rightHasSynth = right.synthesisExposures > 0 ? 1 : 0;
    if (leftHasSynth !== rightHasSynth) {
      return rightHasSynth - leftHasSynth;
    }
    if (leftHasSynth === 1) {
      const lLow = left.synthesisCiLow ?? -1;
      const rLow = right.synthesisCiLow ?? -1;
      if (lLow !== rLow) return rLow - lLow;
      if (left.synthesisExposures !== right.synthesisExposures) {
        return right.synthesisExposures - left.synthesisExposures;
      }
    } else {
      const lLow = left.pipelineCiLow ?? -1;
      const rLow = right.pipelineCiLow ?? -1;
      if (lLow !== rLow) return rLow - lLow;
      if (left.pipelineExposures !== right.pipelineExposures) {
        return right.pipelineExposures - left.pipelineExposures;
      }
    }
    return left.name.localeCompare(right.name);
  });

  const unevaluatedModels: UnevaluatedModelCatalogItem[] = base.models
    .filter((model) => !modelAccById.has(model.id))
    .map((model) => ({
      modelId: model.id,
      name: model.name,
      providerModelId: model.provider_model_id,
      providerName:
        base.providersById.get(model.llm_provider_id)?.name ?? "Unknown",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    studies: enrichedStudies,
    latestScoredStudy: selectLatestScoredStudy(enrichedStudies),
    featuredBenchmarkStudy: selectFeaturedBenchmarkStudy(enrichedStudies),
    flavors: flavorRows,
    unevaluatedFlavors,
    unusedFlavorCount: unevaluatedFlavors.length,
    models: modelRows,
    unevaluatedModels,
    kpis: buildGlobalHubKpis({
      enrichedStudies,
      participations: base.participations,
      totalFlavorCount: base.flavors.length,
      testedFlavorCount: flavorRows.length,
      scoredFlavorCount: flavorRows.filter((row) => row.exposures > 0).length,
      totalModelCount: base.models.length,
      testedModelCount: modelRows.length,
      synthesisModelCount: modelRows.filter(
        (row) => row.synthesisCaptionCount > 0,
      ).length,
      mappedCaptionCount: base.distinctMappedCaptionIds.length,
      totalVoteEvents: base.totalVoteEvents,
      totalNavigationEvents: base.navigationRows.length,
      totalUnifiedExposures,
      totalUnifiedPositive,
      surveyedProfileCount: base.surveyedProfileCount,
    }),
  };
}

const projectFastStudyHubCatalogFromDataset = (
  dataset: GlobalAttributionDataset,
): FastStudyHubCatalog => {
  const pickLatestStudyId = (
    studies: ReadonlyArray<{ studyId: number; exposures: number }>,
  ): number | null => {
    let bestScored: number | null = null;
    let bestAny: number | null = null;
    for (const s of studies) {
      if (bestAny === null || s.studyId > bestAny) bestAny = s.studyId;
      if (s.exposures > 0 && (bestScored === null || s.studyId > bestScored)) {
        bestScored = s.studyId;
      }
    }
    return bestScored ?? bestAny;
  };

  return {
    studies: dataset.studies,
    latestScoredStudy: dataset.latestScoredStudy,
    featuredBenchmarkStudy: dataset.featuredBenchmarkStudy,
    evaluatedFlavors: dataset.flavors
      .map((f) => ({
        flavorId: f.flavorId,
        slug: f.slug,
        description: f.description,
        primarySynthesisModel: f.primarySynthesisModel,
        studyCount: f.studyCount,
        latestStudyId: pickLatestStudyId(f.studies),
      }))
      .sort(
        (a, b) => b.studyCount - a.studyCount || a.slug.localeCompare(b.slug),
      ),
    unevaluatedFlavors: dataset.unevaluatedFlavors,
    unusedFlavorCount: dataset.unusedFlavorCount,
    evaluatedModels: dataset.models
      .map((m) => ({
        modelId: m.modelId,
        name: m.name,
        providerModelId: m.providerModelId,
        providerName: m.providerName,
        primaryRole: m.primaryRole,
        studyCount: m.pipelineStudyCount,
        latestStudyId: pickLatestStudyId(m.studies),
      }))
      .sort((a, b) => {
        const aSynth = a.primaryRole === "synthesis" ? 1 : 0;
        const bSynth = b.primaryRole === "synthesis" ? 1 : 0;
        if (aSynth !== bSynth) return bSynth - aSynth;
        if (b.studyCount !== a.studyCount) return b.studyCount - a.studyCount;
        return a.name.localeCompare(b.name);
      }),
    unevaluatedModels: dataset.unevaluatedModels,
    kpis: dataset.kpis,
  };
};

async function fetchWithSuperadminSwrCache<TValue>({
  supabase,
  cacheMap,
  options,
  loadUncached,
  onSuperadminResolved,
}: {
  supabase: SupabaseClient<Database>;
  cacheMap: Map<string, SwrCacheRecord<TValue>>;
  options?: {
    cacheKey?: string | null;
    nowMs?: number;
    pageSize?: number;
    concurrency?: number;
  };
  loadUncached: (
    liveStudies: readonly StudySummaryRow[],
    nowMs: number,
  ) => Promise<TValue>;
  onSuperadminResolved?: (args: {
    cacheKey: string;
    visibilitySig: string;
    freshUntilMs: number;
    staleUntilMs: number;
    value: TValue;
  }) => void;
}): Promise<TValue> {
  const nowMs = options?.nowMs ?? Date.now();
  const normalizedCacheKey = options?.cacheKey?.trim() ?? "";

  // Verify live superadmin identity via auth.getUser() + isSuperadminProfile BEFORE
  // reading or writing any shared cross-request URL-keyed cache entry. Non-superadmin
  // callers and bare mock clients without auth.getUser bypass the shared cache entirely.
  const [isVerifiedSuperadmin, liveStudies] = await Promise.all([
    normalizedCacheKey.length > 0
      ? verifyLiveSuperadminForSharedCache(supabase)
      : Promise.resolve(false),
    fetchLiveStudiesList(supabase),
  ]);

  const canUseSharedCache =
    isVerifiedSuperadmin &&
    normalizedCacheKey.length > 0 &&
    liveStudies.length > 0;

  if (!canUseSharedCache) {
    return loadUncached(liveStudies, nowMs);
  }

  const visibilitySig = liveStudies.map((study) => study.id).join(",");
  const existing = cacheMap.get(normalizedCacheKey);
  const resolveCompletedAtMs = () => options?.nowMs ?? Date.now();

  const startBlockingRefresh = (): Promise<TValue> => {
    const record: SwrCacheRecord<TValue> = {
      visibilitySig,
      freshUntilMs: 0,
      staleUntilMs: 0,
    };

    const inFlight = loadUncached(liveStudies, nowMs)
      .then((value) => {
        const completedAtMs = resolveCompletedAtMs();
        record.value = value;
        record.freshUntilMs = completedAtMs + GLOBAL_CACHE_TTL_MS;
        record.staleUntilMs = record.freshUntilMs + GLOBAL_CACHE_MAX_STALE_MS;
        onSuperadminResolved?.({
          cacheKey: normalizedCacheKey,
          visibilitySig,
          freshUntilMs: record.freshUntilMs,
          staleUntilMs: record.staleUntilMs,
          value,
        });
        return value;
      })
      .finally(() => {
        const current = cacheMap.get(normalizedCacheKey);
        if (current === record) {
          current.inFlight = undefined;
          if (current.value === undefined) {
            cacheMap.delete(normalizedCacheKey);
          }
        }
      });

    record.inFlight = inFlight;
    if (!cacheMap.has(normalizedCacheKey)) {
      evictOldestCacheEntriesIfNeeded(cacheMap);
    }
    touchCacheEntry(cacheMap, normalizedCacheKey, record);
    return inFlight;
  };

  if (existing && existing.visibilitySig === visibilitySig) {
    if (existing.value !== undefined && nowMs < existing.freshUntilMs) {
      touchCacheEntry(cacheMap, normalizedCacheKey, existing);
      return existing.value;
    }

    if (existing.value !== undefined && nowMs < existing.staleUntilMs) {
      touchCacheEntry(cacheMap, normalizedCacheKey, existing);
      if (!existing.inFlight) {
        const bgRefresh = loadUncached(liveStudies, nowMs)
          .then((freshValue) => {
            const current = cacheMap.get(normalizedCacheKey);
            if (current === existing) {
              const completedAtMs = resolveCompletedAtMs();
              current.value = freshValue;
              current.freshUntilMs = completedAtMs + GLOBAL_CACHE_TTL_MS;
              current.staleUntilMs =
                current.freshUntilMs + GLOBAL_CACHE_MAX_STALE_MS;
              onSuperadminResolved?.({
                cacheKey: normalizedCacheKey,
                visibilitySig,
                freshUntilMs: current.freshUntilMs,
                staleUntilMs: current.staleUntilMs,
                value: freshValue,
              });
            }
            return freshValue;
          })
          .finally(() => {
            const current = cacheMap.get(normalizedCacheKey);
            if (current === existing) {
              current.inFlight = undefined;
            }
          });
        void bgRefresh.catch(() => undefined);
        existing.inFlight = bgRefresh;
      }
      return existing.value;
    }

    if (existing.inFlight) {
      touchCacheEntry(cacheMap, normalizedCacheKey, existing);
      return existing.inFlight.catch(() => startBlockingRefresh());
    }
  }

  return startBlockingRefresh();
}

export async function fetchFastStudyHubCatalogWithClient(
  supabase: SupabaseClient<Database>,
  options?: {
    cacheKey?: string | null;
    nowMs?: number;
    pageSize?: number;
    concurrency?: number;
  },
): Promise<FastStudyHubCatalog> {
  return fetchWithSuperadminSwrCache({
    supabase,
    cacheMap: fastHubCatalogCache,
    options,
    loadUncached: (liveStudies, nowMs) =>
      loadFastStudyHubCatalogUncached(supabase, liveStudies, nowMs, {
        pageSize: options?.pageSize,
        concurrency: options?.concurrency,
      }),
  });
}

export async function fetchGlobalAttributionDatasetWithClient(
  supabase: SupabaseClient<Database>,
  options?: {
    cacheKey?: string | null;
    nowMs?: number;
    pageSize?: number;
    concurrency?: number;
  },
): Promise<GlobalAttributionDataset> {
  return fetchWithSuperadminSwrCache({
    supabase,
    cacheMap: globalDatasetCache,
    options,
    loadUncached: (liveStudies, nowMs) =>
      loadGlobalAttributionDatasetUncached(supabase, liveStudies, nowMs, {
        pageSize: options?.pageSize,
        concurrency: options?.concurrency,
      }),
    onSuperadminResolved: ({
      cacheKey,
      visibilitySig,
      freshUntilMs,
      staleUntilMs,
      value,
    }) => {
      const projected = projectFastStudyHubCatalogFromDataset(value);
      const existingFast = fastHubCatalogCache.get(cacheKey);
      if (!fastHubCatalogCache.has(cacheKey)) {
        evictOldestCacheEntriesIfNeeded(fastHubCatalogCache);
      }
      touchCacheEntry(fastHubCatalogCache, cacheKey, {
        visibilitySig,
        freshUntilMs,
        staleUntilMs,
        value: projected,
        inFlight: existingFast?.inFlight,
      });
    },
  });
}

const DEFAULT_GLOBAL_SEARCH_VIEWS: ReadonlyArray<{
  label: string;
  href: string;
}> = [
  { label: "Global Prompt Flavors Leaderboard", href: "/?tab=flavors" },
  { label: "Global LLM Models Leaderboard", href: "/?tab=models" },
  { label: "Study Hub Directory", href: "/?tab=studies" },
  { label: "Study-to-Study Comparison", href: "/reports/study-comparison" },
  { label: "Weekly Study Summary", href: "/reports/weekly-study-summary" },
];

const toSearchStudyItem = (
  study: EnrichedStudyCatalogEntry,
): RichStudySearchResponse["studies"][number] => ({
  id: study.id,
  title: study.title,
  slug: study.slug,
  status: study.status,
  formatLabel: study.formatLabel,
  formatDisplayLabel: study.formatDisplayLabel,
  flavorCount: study.flavorCount,
  modelCount: study.modelCount,
  voterCount: study.voterCount,
  exposureCount: study.exposureCount,
  positiveRate: study.positiveRate,
  isBenchmark: study.flavorCount >= 2 && study.exposureCount > 0,
  href: `/study/${study.id}/attribution`,
});

export function buildGlobalStudySearchResponse(
  source: GlobalAttributionDataset | FastStudyHubCatalog,
  rawQuery: string,
): RichStudySearchResponse {
  const query = rawQuery.trim().slice(0, 80);
  const queryLower = query.toLowerCase();

  if (query.length === 0) {
    const pickedIds = new Set<number>();
    const defaultStudies: EnrichedStudyCatalogEntry[] = [];
    const pushUnique = (
      candidate: EnrichedStudyCatalogEntry | null | undefined,
    ) => {
      if (!candidate || pickedIds.has(candidate.id)) {
        return;
      }
      pickedIds.add(candidate.id);
      defaultStudies.push(candidate);
    };

    pushUnique(source.featuredBenchmarkStudy);
    pushUnique(source.latestScoredStudy);

    const benchmarkPool = source.studies
      .filter((s) => s.exposureCount > 0 && s.flavorCount >= 2 && !s.is_private)
      .sort(
        (a, b) =>
          computeBenchmarkScore(b) - computeBenchmarkScore(a) || b.id - a.id,
      );
    for (const s of benchmarkPool) {
      if (defaultStudies.length >= 4) break;
      pushUnique(s);
    }
    for (const s of source.studies) {
      if (defaultStudies.length >= MAX_SEARCH_STUDIES) break;
      if (s.exposureCount > 0 && !s.is_private) {
        pushUnique(s);
      }
    }
    for (const s of source.studies) {
      if (defaultStudies.length >= MAX_SEARCH_STUDIES) break;
      if (s.exposureCount > 0) {
        pushUnique(s);
      }
    }

    return {
      query: "",
      studies: defaultStudies.map(toSearchStudyItem),
      flavors: [],
      models: [],
      reports: DEFAULT_GLOBAL_SEARCH_VIEWS.slice(0, 3),
    };
  }

  const hasExplicitHash = query.startsWith("#");
  const numericTerm = hasExplicitHash ? query.slice(1) : query;

  const matchedStudies = source.studies
    .filter((study) => {
      if (hasExplicitHash) {
        return (
          numericTerm.length > 0 &&
          (String(study.id) === numericTerm ||
            String(study.id).startsWith(numericTerm))
        );
      }
      if (
        String(study.id) === numericTerm ||
        String(study.id).startsWith(numericTerm)
      ) {
        return true;
      }
      if (study.title.toLowerCase().includes(queryLower)) {
        return true;
      }
      if (study.slug?.toLowerCase().includes(queryLower)) {
        return true;
      }
      if (study.description?.toLowerCase().includes(queryLower)) {
        return true;
      }
      if (
        study.flavorSlugs.some((slug) =>
          slug.toLowerCase().includes(queryLower),
        )
      ) {
        return true;
      }
      if (
        study.modelNames.some((name) => name.toLowerCase().includes(queryLower))
      ) {
        return true;
      }
      return false;
    })
    .sort((left, right) => {
      const leftExact = String(left.id) === numericTerm ? 1 : 0;
      const rightExact = String(right.id) === numericTerm ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      const leftScored = left.exposureCount > 0 ? 1 : 0;
      const rightScored = right.exposureCount > 0 ? 1 : 0;
      if (leftScored !== rightScored) return rightScored - leftScored;
      if (left.flavorCount !== right.flavorCount) {
        return right.flavorCount - left.flavorCount;
      }
      return right.id - left.id;
    })
    .slice(0, MAX_SEARCH_STUDIES)
    .map(toSearchStudyItem);

  const matchedEvaluatedFlavors: RichStudySearchResponse["flavors"] =
    "flavors" in source
      ? source.flavors
          .filter(
            (flavor) =>
              flavor.slug.toLowerCase().includes(queryLower) ||
              flavor.description?.toLowerCase().includes(queryLower) ||
              flavor.primarySynthesisModel?.toLowerCase().includes(queryLower) ||
              String(flavor.flavorId) === numericTerm,
          )
          .slice(0, MAX_SEARCH_EVALUATED_ENTITIES)
          .map((flavor) => ({
            id: flavor.flavorId,
            slug: flavor.slug,
            description: flavor.description,
            studyCount: flavor.studyCount,
            latestStudyId: flavor.studies[0]?.studyId ?? null,
            exposures: flavor.exposures,
            positiveRate: flavor.rate,
            href: `/?tab=flavors&flavor=${encodeURIComponent(flavor.slug)}`,
          }))
      : source.evaluatedFlavors
          .filter(
            (flavor) =>
              flavor.slug.toLowerCase().includes(queryLower) ||
              flavor.description?.toLowerCase().includes(queryLower) ||
              flavor.primarySynthesisModel?.toLowerCase().includes(queryLower) ||
              String(flavor.flavorId) === numericTerm,
          )
          .slice(0, MAX_SEARCH_EVALUATED_ENTITIES)
          .map((flavor) => ({
            id: flavor.flavorId,
            slug: flavor.slug,
            description: flavor.description,
            studyCount: flavor.studyCount,
            latestStudyId: flavor.latestStudyId,
            positiveRate: null,
            href: `/?tab=flavors&flavor=${encodeURIComponent(flavor.slug)}`,
          }));

  const matchedUntestedFlavors: RichStudySearchResponse["flavors"] =
    source.unevaluatedFlavors
      .filter(
        (flavor) =>
          flavor.slug.toLowerCase().includes(queryLower) ||
          flavor.description?.toLowerCase().includes(queryLower) ||
          String(flavor.flavorId) === numericTerm,
      )
      .slice(0, MAX_SEARCH_UNTESTED_ENTITIES)
      .map((flavor) => ({
        id: flavor.flavorId,
        slug: flavor.slug,
        description: flavor.description,
        studyCount: 0,
        latestStudyId: null,
        exposures: 0,
        positiveRate: null,
        href: null,
      }));

  const matchedEvaluatedModels: RichStudySearchResponse["models"] =
    "models" in source
      ? source.models
          .filter(
            (model) =>
              model.name.toLowerCase().includes(queryLower) ||
              model.providerModelId.toLowerCase().includes(queryLower) ||
              model.providerName.toLowerCase().includes(queryLower) ||
              String(model.modelId) === numericTerm,
          )
          .slice(0, MAX_SEARCH_EVALUATED_ENTITIES)
          .map((model) => ({
            id: model.modelId,
            name: model.name,
            providerModelId: model.providerModelId,
            providerName: model.providerName,
            studyCount: model.pipelineStudyCount,
            latestStudyId: model.studies[0]?.studyId ?? null,
            exposures:
              model.synthesisExposures > 0
                ? model.synthesisExposures
                : model.pipelineExposures,
            positiveRate:
              model.synthesisExposures > 0
                ? model.synthesisRate
                : model.pipelineRate,
            primaryRole: model.primaryRole,
            href: `/?tab=models&model=${encodeURIComponent(String(model.modelId))}`,
          }))
      : source.evaluatedModels
          .filter(
            (model) =>
              model.name.toLowerCase().includes(queryLower) ||
              model.providerModelId.toLowerCase().includes(queryLower) ||
              model.providerName.toLowerCase().includes(queryLower) ||
              String(model.modelId) === numericTerm,
          )
          .slice(0, MAX_SEARCH_EVALUATED_ENTITIES)
          .map((model) => ({
            id: model.modelId,
            name: model.name,
            providerModelId: model.providerModelId,
            providerName: model.providerName,
            studyCount: model.studyCount,
            latestStudyId: model.latestStudyId,
            positiveRate: null,
            primaryRole: model.primaryRole,
            href: `/?tab=models&model=${encodeURIComponent(String(model.modelId))}`,
          }));

  const matchedUntestedModels: RichStudySearchResponse["models"] =
    source.unevaluatedModels
      .filter(
        (model) =>
          model.name.toLowerCase().includes(queryLower) ||
          model.providerModelId.toLowerCase().includes(queryLower) ||
          model.providerName.toLowerCase().includes(queryLower) ||
          String(model.modelId) === numericTerm,
      )
      .slice(0, MAX_SEARCH_UNTESTED_ENTITIES)
      .map((model) => ({
        id: model.modelId,
        name: model.name,
        providerModelId: model.providerModelId,
        providerName: model.providerName,
        studyCount: 0,
        latestStudyId: null,
        exposures: 0,
        positiveRate: null,
        primaryRole: null,
        href: null,
      }));

  const matchedReports = DEFAULT_GLOBAL_SEARCH_VIEWS.filter((report) =>
    report.label.toLowerCase().includes(queryLower),
  );

  return {
    query,
    studies: matchedStudies,
    flavors: [...matchedEvaluatedFlavors, ...matchedUntestedFlavors],
    models: [...matchedEvaluatedModels, ...matchedUntestedModels],
    reports: matchedReports,
  };
}

export function buildStudySwitcherCatalog(source: {
  studies: readonly EnrichedStudyCatalogEntry[];
}): StudySwitcherCatalogItem[] {
  return source.studies.map((study) => ({
    id: study.id,
    title: study.title,
    slug: study.slug,
    description: study.description,
    formatDisplayLabel: study.formatDisplayLabel,
    exposureMode: study.exposureMode,
    flavorCount: study.flavorCount,
    modelCount: study.modelCount,
    voterCount: study.voterCount,
    exposureCount: study.exposureCount,
    positiveRate: study.positiveRate,
    flavorSlugs: study.flavorSlugs,
    modelNames: study.modelNames,
  }));
}

export const getCachedFastStudyHubCatalog = cache(
  async (): Promise<FastStudyHubCatalog> => {
    const supabase = await createClient();
    const { supabaseUrl } = getSupabasePublicEnv();
    return fetchFastStudyHubCatalogWithClient(supabase, {
      cacheKey: supabaseUrl,
    });
  },
);

export const getCachedGlobalAttributionDataset = cache(
  async (): Promise<GlobalAttributionDataset> => {
    const supabase = await createClient();
    const { supabaseUrl } = getSupabasePublicEnv();
    return fetchGlobalAttributionDatasetWithClient(supabase, {
      cacheKey: supabaseUrl,
    });
  },
);
