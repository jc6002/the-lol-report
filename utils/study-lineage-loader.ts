import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "@/src/types/supabase";
import {
  buildAttributionLeaderboards,
  buildCaptionMetricsAndHistogram,
  buildDemographicCohortMatrices,
  computeMedian,
  computeSameImageMetrics,
  computeWilsonConfidenceInterval,
  type AttributionLeaderboardRow,
  type AttributionPipelineStep,
  type AttributionSampleCaption,
  type CaptionAttributionSource,
  type CaptionLineageInfo,
  type CaptionRateDistribution,
  type DemographicMatrixBundle,
  type RawDemographicAnswerRow,
  type RawDemographicMappingRow,
  type RawDemographicQuestionRow,
  type RawDemographicUserResponseRow,
  type SameImageComparisonGroup,
  type WilsonInterval,
} from "@/utils/attribution-stats";
import {
  adaptStudyExposures,
  buildStudyParticipationFunnel,
  getSwipeEventMatchKey,
  NEW_STYLE_MIN_STUDY_ID,
  resolveStudyExposureMode,
  type AdaptedStudyExposures,
  type RawStudyMappingRow,
  type RawStudyNavigationRow,
  type RawStudyParticipationRow,
  type RawStudyVoteRow,
  type StudyExposureMode,
  type StudyParticipationFunnel,
} from "@/utils/study-exposure-adapter";
import {
  chunkArray,
  DEFAULT_QUERY_CHUNK_SIZE,
  DEFAULT_QUERY_PAGE_SIZE,
  fetchAllRows,
  fetchExactCount,
  fetchHasAnyRow,
  fetchRowsByIdChunks,
  isLikelyTransientFetchError,
  mapWithConcurrency,
  sumExactCountsByIdChunks,
  type SupabaseCountResult,
  type SupabaseListResult,
} from "@/utils/supabase-pagination";
import { createClient } from "@/utils/supabase/server";
import { isSuperadminProfile } from "@/utils/supabase/superadmin";

const MS_PER_MINUTE = 60_000;
const ERA_PROBE_CONCURRENCY = 8;
const TRAJECTORY_STUDY_CONCURRENCY = 6;
const MAX_SEARCH_ITEMS_PER_GROUP = 6;
export const STUDY_CACHE_MAX_ENTRIES = 16;
export const TRAJECTORY_CACHE_MAX_ENTRIES = 64;
export const STUDY_CACHE_TTL_MS = 15 * 60_000;
export const STUDY_CACHE_MAX_STALE_MS = 12 * 60 * 60_000;
const EVENT_CHUNK_CONCURRENCY = 4;
const EVENT_PAGE_CONCURRENCY = 8;
const PAGE_RETRY_ATTEMPTS = 3;
const PAGE_RETRY_BASE_DELAY_MS = 150;

export type StudyLifecycleStatus = "active" | "closed" | "scheduled";

export type StudySummaryRow = Pick<
  Tables<"studies">,
  | "id"
  | "slug"
  | "description"
  | "start_datetime_utc"
  | "end_datetime_utc"
  | "created_datetime_utc"
  | "is_hidden"
  | "is_private"
>;

export type StudyCatalogEntry = {
  id: number;
  slug: string | null;
  title: string;
  description: string | null;
  start_datetime_utc: string | null;
  end_datetime_utc: string | null;
  created_datetime_utc: string;
  is_hidden: boolean;
  is_private: boolean;
  status: StudyLifecycleStatus;
  exposureMode: StudyExposureMode;
  isTransitionalLikert: boolean;
  formatLabel: "Swipe" | "Likert";
  detailHref: string;
  captionCount: number;
  participationsStarted: number;
  participationsEnded: number;
  completionRate: number | null;
  medianRunMinutes: number | null;
};

export type TopNavbarActivityItem = {
  studyId: number;
  label: string;
  status: StudyLifecycleStatus;
  participationsStarted: number;
  participationsEnded: number;
  captionCount: number;
  referenceUtc: string;
};

export type TopNavbarMetadata = {
  recentStudies: TopNavbarActivityItem[];
  hasActiveStudy: boolean;
};

export type ExecutiveHubDataset = {
  studies: StudyCatalogEntry[];
  latestStudyId: number | null;
  kpis: {
    totalStudies: number;
    activeStudies: number;
    swipeStudies: number;
    likertStudies: number;
    totalParticipations: number;
    completedParticipations: number;
    overallCompletionRate: number | null;
    totalFlavorCount: number;
    testedFlavorCount: number;
    totalModelCount: number;
    testedModelCount: number;
    mappedCaptionCount: number;
    totalVoteEvents: number;
    totalNavigationEvents: number;
    surveyedProfileCount: number;
  };
};

export type StudySearchResponse = {
  studies: Array<{
    id: number;
    title: string;
    slug: string | null;
    status: StudyLifecycleStatus;
    formatLabel: "Swipe" | "Likert";
    href: string;
  }>;
  flavors: Array<{
    id: number;
    slug: string;
    description: string | null;
    studyCount: number;
    latestStudyId: number | null;
    href: string | null;
  }>;
  models: Array<{
    id: number;
    name: string;
    providerModelId: string;
    providerName: string;
    studyCount: number;
    latestStudyId: number | null;
    href: string | null;
  }>;
  reports: Array<{
    label: string;
    href: string;
  }>;
};

export type StudyAttributionBundle = {
  study: StudySummaryRow;
  studies: StudySummaryRow[];
  excludeHighRisk: boolean;
  mappedCaptionCount: number;
  unattributedCaptionCount: number;
  metadataAttributedCaptionCount: number;
  studyRateCi: WilsonInterval;
  exposureBundle: AdaptedStudyExposures;
  participationFunnel: StudyParticipationFunnel;
  captionsById: Map<string, CaptionLineageInfo>;
  leaderboards: {
    flavors: AttributionLeaderboardRow[];
    models: AttributionLeaderboardRow[];
    pipelines: AttributionLeaderboardRow[];
  };
  captionRateHistogram?: CaptionRateDistribution;
  captionMetrics?: AttributionSampleCaption[];
  headToHead: {
    structuralSharedImageCount: number;
    evaluatedSharedImageCount: number;
    crossFlavorSharedImageCount: number;
    comparableCaptionCount: number;
    maxImageSpreadPp: number | null;
    groups: SameImageComparisonGroup[];
  };
  demographics: DemographicMatrixBundle;
};

export type FlavorCrossStudyPoint = {
  studyId: number;
  studySlug: string | null;
  studyLabel: string;
  exposureMode: StudyExposureMode;
  formatLabel: "Swipe" | "Likert";
  captionCount: number;
  exposures: number;
  positive: number;
  rate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
};

export type RawFlavorRow = Pick<
  Tables<"humor_flavors">,
  "id" | "slug" | "description"
>;

export type RawFlavorStepRow = Pick<
  Tables<"humor_flavor_steps">,
  "id" | "humor_flavor_id" | "order_by" | "llm_model_id"
>;

export type RawModelRow = Pick<
  Tables<"llm_models">,
  "id" | "name" | "provider_model_id" | "llm_provider_id"
>;

export type RawProviderRow = Pick<Tables<"llm_providers">, "id" | "name">;

export type RawCaptionLineageRow = Pick<
  Tables<"captions">,
  | "id"
  | "content"
  | "image_id"
  | "humor_flavor_id"
  | "llm_prompt_chain_id"
  | "caption_request_id"
  | "metadata"
>;

type RawCaptionFlavorOnlyRow = Pick<
  Tables<"captions">,
  "id" | "humor_flavor_id" | "metadata"
>;

type RawImageRow = Pick<
  Tables<"images">,
  "id" | "url" | "image_description"
>;

export type RawLlmResponseRow = Pick<
  Tables<"llm_model_responses">,
  | "id"
  | "llm_prompt_chain_id"
  | "caption_request_id"
  | "humor_flavor_id"
  | "humor_flavor_step_id"
  | "llm_model_id"
  | "processing_time_seconds"
  | "created_datetime_utc"
>;

const GLOBAL_REPORTS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Study Hub", href: "/" },
  { label: "Study-to-Study Comparison", href: "/reports/study-comparison" },
  { label: "Weekly Humor Study Summary", href: "/reports/weekly-study-summary" },
];

const parseEpochMs = (isoUtc: string | null): number | null => {
  if (!isoUtc) {
    return null;
  }
  const parsed = Date.parse(isoUtc);
  return Number.isFinite(parsed) ? parsed : null;
};

export function getStudyTitle(study: {
  id: number;
  slug: string | null;
  description: string | null;
}): string {
  const slug = study.slug?.trim();
  if (slug) {
    return slug;
  }
  const description = study.description?.trim();
  if (description) {
    return description;
  }
  return `Study ${study.id}`;
}

export function getStudyDisplayLabel(study: {
  id: number;
  slug: string | null;
  description: string | null;
}): string {
  const slug = study.slug?.trim();
  if (slug) {
    return `${study.id} - ${slug}`;
  }
  const description = study.description?.trim();
  if (description) {
    return `${study.id} - ${description}`;
  }
  return `Study ${study.id}`;
}

export function getStudyLifecycleStatus(
  study: Pick<StudySummaryRow, "start_datetime_utc" | "end_datetime_utc">,
  nowMs = Date.now(),
): StudyLifecycleStatus {
  const startMs = parseEpochMs(study.start_datetime_utc);
  const endMs = parseEpochMs(study.end_datetime_utc);

  if (startMs !== null && nowMs < startMs) {
    return "scheduled";
  }
  if (endMs !== null && nowMs > endMs) {
    return "closed";
  }
  if (startMs !== null || endMs !== null) {
    return "active";
  }
  return "closed";
}

const extractMetadataFlavorName = (metadata: Json | null): string | null => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const candidate = (metadata as Record<string, Json | undefined>).flavor_name;
  if (typeof candidate !== "string") {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export function resolveEffectiveCaptionFlavor(
  caption: Pick<RawCaptionLineageRow, "humor_flavor_id" | "metadata">,
  flavorsById: ReadonlyMap<number, RawFlavorRow>,
  flavorsBySlugLower: ReadonlyMap<string, RawFlavorRow>,
): { flavor: RawFlavorRow | null; source: CaptionAttributionSource } {
  if (caption.humor_flavor_id !== null) {
    const direct = flavorsById.get(caption.humor_flavor_id);
    if (direct) {
      return { flavor: direct, source: "direct_fk" };
    }
  }

  const metadataFlavorName = extractMetadataFlavorName(caption.metadata);
  if (metadataFlavorName) {
    const matched = flavorsBySlugLower.get(metadataFlavorName.toLowerCase());
    if (matched) {
      return { flavor: matched, source: "metadata_flavor_name" };
    }
  }

  return { flavor: null, source: "unattributed" };
}

export function buildFlavorLookupMaps(flavors: readonly RawFlavorRow[]): {
  flavorsById: Map<number, RawFlavorRow>;
  flavorsBySlugLower: Map<string, RawFlavorRow>;
} {
  const flavorsById = new Map<number, RawFlavorRow>();
  const flavorsBySlugLower = new Map<string, RawFlavorRow>();
  for (const flavor of flavors) {
    flavorsById.set(flavor.id, flavor);
    flavorsBySlugLower.set(flavor.slug.trim().toLowerCase(), flavor);
  }
  return { flavorsById, flavorsBySlugLower };
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

export function assembleCaptionLineageMap({
  captions,
  imagesById,
  flavors,
  flavorSteps,
  models,
  providers,
  llmResponses,
}: {
  captions: readonly RawCaptionLineageRow[];
  imagesById: ReadonlyMap<string, RawImageRow>;
  flavors: readonly RawFlavorRow[];
  flavorSteps: readonly RawFlavorStepRow[];
  models: readonly RawModelRow[];
  providers: readonly RawProviderRow[];
  llmResponses: readonly RawLlmResponseRow[];
}): {
  captionsById: Map<string, CaptionLineageInfo>;
  metadataAttributedCaptionCount: number;
  unattributedCaptionCount: number;
} {
  const { flavorsById, flavorsBySlugLower } = buildFlavorLookupMaps(flavors);
  const stepsByFlavorId = buildStepsByFlavorId(flavorSteps);
  const stepById = new Map(flavorSteps.map((step) => [step.id, step]));
  const modelsById = new Map(models.map((model) => [model.id, model]));
  const providersById = new Map(
    providers.map((provider) => [provider.id, provider]),
  );

  const responsesByChainId = new Map<number, RawLlmResponseRow[]>();
  const responsesByRequestId = new Map<number, RawLlmResponseRow[]>();
  for (const resp of llmResponses) {
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
    rows: readonly RawLlmResponseRow[],
  ): RawLlmResponseRow[] =>
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

  const captionsById = new Map<string, CaptionLineageInfo>();
  let metadataAttributedCaptionCount = 0;
  let unattributedCaptionCount = 0;

  for (const caption of captions) {
    const image = caption.image_id ? imagesById.get(caption.image_id) : undefined;
    const { flavor, source } = resolveEffectiveCaptionFlavor(
      caption,
      flavorsById,
      flavorsBySlugLower,
    );
    if (source === "metadata_flavor_name") {
      metadataAttributedCaptionCount += 1;
    } else if (source === "unattributed") {
      unattributedCaptionCount += 1;
    }

    const configuredSteps = flavor
      ? (stepsByFlavorId.get(flavor.id) ?? [])
      : [];

    const rawChainRows =
      caption.llm_prompt_chain_id !== null
        ? (responsesByChainId.get(caption.llm_prompt_chain_id) ?? [])
        : caption.caption_request_id !== null
          ? (responsesByRequestId.get(caption.caption_request_id) ?? [])
          : [];

    let terminalModel: RawModelRow | undefined;
    let pipelineSteps: string[] = [];
    let pipelineStepDetails: AttributionPipelineStep[] = [];
    let chainLatencySeconds: number | null = null;
    let flavorStepCount = configuredSteps.length;

    if (rawChainRows.length > 0) {
      const orderedResponses = sortChainResponses(rawChainRows);
      if (flavorStepCount === 0) {
        flavorStepCount = orderedResponses.length;
      }
      const terminalResponse = orderedResponses[orderedResponses.length - 1];
      terminalModel = modelsById.get(terminalResponse.llm_model_id);

      pipelineStepDetails = orderedResponses.map((resp, index) => {
        const m = modelsById.get(resp.llm_model_id);
        const p = m ? providersById.get(m.llm_provider_id) : undefined;
        return {
          stepOrder: index + 1,
          modelName:
            m?.name ?? m?.provider_model_id ?? `Model #${resp.llm_model_id}`,
          providerName: p?.name ?? null,
        };
      });
      pipelineSteps = pipelineStepDetails.map((step) => step.modelName);

      let latencySum = 0;
      let hasTiming = false;
      for (const resp of orderedResponses) {
        if (
          Number.isFinite(resp.processing_time_seconds) &&
          resp.processing_time_seconds >= 0
        ) {
          latencySum += resp.processing_time_seconds;
          hasTiming = true;
        }
      }
      chainLatencySeconds = hasTiming
        ? Number(latencySum.toFixed(3))
        : null;
    } else if (configuredSteps.length > 0) {
      // Quick-study imported captions carry flavor attribution without
      // llm_model_responses rows; derive step/model signature cleanly from
      // humor_flavor_steps while keeping chainLatencySeconds strictly null.
      const lastStep = configuredSteps[configuredSteps.length - 1];
      terminalModel = modelsById.get(lastStep.llm_model_id);
      pipelineStepDetails = configuredSteps.map((step, index) => {
        const m = modelsById.get(step.llm_model_id);
        const p = m ? providersById.get(m.llm_provider_id) : undefined;
        return {
          stepOrder: index + 1,
          modelName:
            m?.name ?? m?.provider_model_id ?? `Model #${step.llm_model_id}`,
          providerName: p?.name ?? null,
        };
      });
      pipelineSteps = pipelineStepDetails.map((step) => step.modelName);
      chainLatencySeconds = null;
    }

    const terminalProvider = terminalModel
      ? providersById.get(terminalModel.llm_provider_id)
      : undefined;

    captionsById.set(caption.id, {
      captionId: caption.id,
      content: caption.content,
      imageId: caption.image_id,
      imageUrl: image?.url ?? null,
      imageDescription: image?.image_description ?? null,
      attributionSource: source,
      flavorId: flavor?.id ?? null,
      flavorSlug: flavor?.slug ?? null,
      flavorDescription: flavor?.description ?? null,
      flavorStepCount,
      terminalModelId: terminalModel?.id ?? null,
      terminalModelName: terminalModel?.name ?? null,
      terminalProviderModelId: terminalModel?.provider_model_id ?? null,
      terminalProviderName: terminalProvider?.name ?? null,
      pipelineSignature:
        pipelineSteps.length > 0 ? pipelineSteps.join(" → ") : null,
      pipelineSteps,
      pipelineStepDetails,
      chainLatencySeconds,
    });
  }

  return {
    captionsById,
    metadataAttributedCaptionCount,
    unattributedCaptionCount,
  };
}

const fetchStudiesList = (
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

const fetchAllStudyMappings = (
  supabase: SupabaseClient<Database>,
): Promise<RawStudyMappingRow[]> =>
  fetchAllRows<RawStudyMappingRow>({
    contextLabel: "study caption mappings",
    runQuery: (from, to) =>
      supabase
        .from("study_caption_mappings")
        .select("id, study_id, caption_id")
        .order("id", { ascending: true })
        .range(from, to) as PromiseLike<SupabaseListResult<RawStudyMappingRow>>,
  });

const fetchAllStudyParticipations = (
  supabase: SupabaseClient<Database>,
): Promise<RawStudyParticipationRow[]> =>
  fetchAllRows<RawStudyParticipationRow>({
    contextLabel: "study participations",
    runQuery: (from, to) =>
      supabase
        .from("study_participations")
        .select("profile_id, study_id, started_at, ended_at, completion_stats")
        .order("study_id", { ascending: true })
        .order("started_at", { ascending: true })
        .order("profile_id", { ascending: true })
        .range(from, to) as PromiseLike<
        SupabaseListResult<RawStudyParticipationRow>
      >,
  });

const probeTableHasRowForMappings = async (
  supabase: SupabaseClient<Database>,
  table: "study_caption_navigation_events" | "study_caption_vote_events",
  mappingIds: readonly number[],
): Promise<boolean> => {
  if (mappingIds.length === 0) {
    return false;
  }
  const chunkSize = 120;
  for (let i = 0; i < mappingIds.length; i += chunkSize) {
    const chunk = mappingIds.slice(i, i + chunkSize);
    const hasRow = await fetchHasAnyRow<{ id: number }>({
      contextLabel: table,
      runQuery: () =>
        supabase
          .from(table)
          .select("id")
          .in("study_caption_mapping_id", chunk)
          .limit(1) as PromiseLike<SupabaseListResult<{ id: number }>>,
    });
    if (hasRow) {
      return true;
    }
  }
  return false;
};

async function buildStudyCatalogEntries(
  supabase: SupabaseClient<Database>,
  studies: readonly StudySummaryRow[],
  mappings: readonly RawStudyMappingRow[],
  participations: readonly RawStudyParticipationRow[],
  nowMs: number,
): Promise<StudyCatalogEntry[]> {
  const mappingIdsByStudy = new Map<number, number[]>();
  const captionIdsByStudy = new Map<number, Set<string>>();
  for (const m of mappings) {
    let idList = mappingIdsByStudy.get(m.study_id);
    if (!idList) {
      idList = [];
      mappingIdsByStudy.set(m.study_id, idList);
    }
    idList.push(m.id);

    let capSet = captionIdsByStudy.get(m.study_id);
    if (!capSet) {
      capSet = new Set<string>();
      captionIdsByStudy.set(m.study_id, capSet);
    }
    capSet.add(m.caption_id);
  }

  const participationsByStudy = new Map<number, RawStudyParticipationRow[]>();
  for (const p of participations) {
    let list = participationsByStudy.get(p.study_id);
    if (!list) {
      list = [];
      participationsByStudy.set(p.study_id, list);
    }
    list.push(p);
  }

  return mapWithConcurrency(
    studies,
    ERA_PROBE_CONCURRENCY,
    async (study): Promise<StudyCatalogEntry> => {
      const studyMappingIds = mappingIdsByStudy.get(study.id) ?? [];
      const captionCount = captionIdsByStudy.get(study.id)?.size ?? 0;

      let hasNavigationEvents = false;
      let hasVoteEvents = false;
      if (study.id >= NEW_STYLE_MIN_STUDY_ID && studyMappingIds.length > 0) {
        hasNavigationEvents = await probeTableHasRowForMappings(
          supabase,
          "study_caption_navigation_events",
          studyMappingIds,
        );
        if (!hasNavigationEvents) {
          hasVoteEvents = await probeTableHasRowForMappings(
            supabase,
            "study_caption_vote_events",
            studyMappingIds,
          );
        }
      }

      const resolved = resolveStudyExposureMode({
        studyId: study.id,
        hasNavigationEvents,
        hasVoteEvents,
      });

      const studyParts = participationsByStudy.get(study.id) ?? [];
      const started = studyParts.length;
      let ended = 0;
      const runMinutes: number[] = [];
      for (const part of studyParts) {
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
        id: study.id,
        slug: study.slug,
        title: getStudyTitle(study),
        description: study.description,
        start_datetime_utc: study.start_datetime_utc,
        end_datetime_utc: study.end_datetime_utc,
        created_datetime_utc: study.created_datetime_utc,
        is_hidden: study.is_hidden,
        is_private: study.is_private,
        status: getStudyLifecycleStatus(study, nowMs),
        exposureMode: resolved.mode,
        isTransitionalLikert: resolved.isTransitionalLikert,
        formatLabel: resolved.mode === "swipe_navigation" ? "Swipe" : "Likert",
        detailHref: resolved.detailHref,
        captionCount,
        participationsStarted: started,
        participationsEnded: ended,
        completionRate: started > 0 ? ended / started : null,
        medianRunMinutes: computeMedian(runMinutes),
      };
    },
  );
}

export async function fetchTopNavbarMetadataWithClient(
  supabase: SupabaseClient<Database>,
  nowMs?: number,
): Promise<TopNavbarMetadata> {
  const effectiveNowMs = nowMs ?? Date.now();
  const cacheNamespace =
    await resolveVerifiedSuperadminCacheNamespace(supabase);

  const loadMetadataUncached = async (): Promise<TopNavbarMetadata> => {
    const [studies, mappings, participations] = await Promise.all([
      fetchStudiesList(supabase),
      fetchAllStudyMappings(supabase),
      fetchAllStudyParticipations(supabase),
    ]);

    const captionCounts = new Map<number, Set<string>>();
    for (const m of mappings) {
      let set = captionCounts.get(m.study_id);
      if (!set) {
        set = new Set<string>();
        captionCounts.set(m.study_id, set);
      }
      set.add(m.caption_id);
    }

    const partCounts = new Map<number, { started: number; ended: number }>();
    for (const p of participations) {
      let stats = partCounts.get(p.study_id);
      if (!stats) {
        stats = { started: 0, ended: 0 };
        partCounts.set(p.study_id, stats);
      }
      stats.started += 1;
      if (p.ended_at !== null) {
        stats.ended += 1;
      }
    }

    let hasActiveStudy = false;
    const recentStudies: TopNavbarActivityItem[] = [];
    const statusRefMs = nowMs ?? Date.now();

    for (const study of studies) {
      const status = getStudyLifecycleStatus(study, statusRefMs);
      if (status === "active") {
        hasActiveStudy = true;
      }
      if (recentStudies.length < 5) {
        const parts = partCounts.get(study.id) ?? { started: 0, ended: 0 };
        recentStudies.push({
          studyId: study.id,
          label: getStudyTitle(study),
          status,
          participationsStarted: parts.started,
          participationsEnded: parts.ended,
          captionCount: captionCounts.get(study.id)?.size ?? 0,
          referenceUtc: study.start_datetime_utc ?? study.created_datetime_utc,
        });
      }
    }

    return { recentStudies, hasActiveStudy };
  };

  if (cacheNamespace === null) {
    return loadMetadataUncached();
  }
  return topNavbarMetadataCache.resolveWithSwr(
    cacheNamespace,
    effectiveNowMs,
    () => nowMs ?? Date.now(),
    loadMetadataUncached,
  );
}

export async function fetchExecutiveHubDatasetWithClient(
  supabase: SupabaseClient<Database>,
  nowMs = Date.now(),
): Promise<ExecutiveHubDataset> {
  const [
    studies,
    mappings,
    participations,
    flavors,
    flavorSteps,
    models,
    demographicMappings,
    demographicResponses,
    totalVoteEvents,
    totalNavigationEvents,
  ] = await Promise.all([
    fetchStudiesList(supabase),
    fetchAllStudyMappings(supabase),
    fetchAllStudyParticipations(supabase),
    fetchAllRows<RawFlavorRow>({
      contextLabel: "humor flavors",
      runQuery: (from, to) =>
        supabase
          .from("humor_flavors")
          .select("id, slug, description")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawFlavorRow>>,
    }),
    fetchAllRows<RawFlavorStepRow>({
      contextLabel: "humor flavor steps",
      runQuery: (from, to) =>
        supabase
          .from("humor_flavor_steps")
          .select("id, humor_flavor_id, order_by, llm_model_id")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawFlavorStepRow>>,
    }),
    fetchAllRows<RawModelRow>({
      contextLabel: "llm models",
      runQuery: (from, to) =>
        supabase
          .from("llm_models")
          .select("id, name, provider_model_id, llm_provider_id")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawModelRow>>,
    }),
    fetchAllRows<Pick<Tables<"demographic_answer_question_mapping">, "id" | "is_deleted">>({
      contextLabel: "demographic mappings",
      runQuery: (from, to) =>
        supabase
          .from("demographic_answer_question_mapping")
          .select("id, is_deleted")
          .order("id", { ascending: true })
          .range(from, to),
    }),
    fetchAllRows<Pick<Tables<"demographic_user_responses">, "user_id" | "answer_question_mapping_id">>({
      contextLabel: "demographic user responses",
      runQuery: (from, to) =>
        supabase
          .from("demographic_user_responses")
          .select("user_id, answer_question_mapping_id")
          .order("id", { ascending: true })
          .range(from, to),
    }),
    fetchExactCount({
      contextLabel: "study vote events",
      runQuery: () =>
        supabase
          .from("study_caption_vote_events")
          .select("id", { count: "exact", head: true }),
    }),
    fetchExactCount({
      contextLabel: "study navigation events",
      runQuery: () =>
        supabase
          .from("study_caption_navigation_events")
          .select("id", { count: "exact", head: true }),
    }),
  ]);

  const distinctMappedCaptionIds = Array.from(
    new Set(mappings.map((m) => m.caption_id)),
  );

  const [catalogEntries, mappedCaptions] = await Promise.all([
    buildStudyCatalogEntries(supabase, studies, mappings, participations, nowMs),
    fetchRowsByIdChunks<string, RawCaptionLineageRow>({
      ids: distinctMappedCaptionIds,
      contextLabel: "study-mapped captions",
      runQuery: (chunk, from, to) =>
        supabase
          .from("captions")
          .select(
            "id, content, image_id, humor_flavor_id, llm_prompt_chain_id, caption_request_id, metadata",
          )
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<
          SupabaseListResult<RawCaptionLineageRow>
        >,
    }),
  ]);

  const mappedChainIds = mappedCaptions
    .map((c) => c.llm_prompt_chain_id)
    .filter((id): id is number => id !== null);

  const chainResponses = await fetchRowsByIdChunks<
    number,
    Pick<Tables<"llm_model_responses">, "llm_prompt_chain_id" | "llm_model_id">
  >({
    ids: mappedChainIds,
    contextLabel: "study chain model responses",
    runQuery: (chunk, from, to) =>
      supabase
        .from("llm_model_responses")
        .select("llm_prompt_chain_id, llm_model_id")
        .in("llm_prompt_chain_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
  });

  const { flavorsById, flavorsBySlugLower } = buildFlavorLookupMaps(flavors);
  const stepsByFlavorId = buildStepsByFlavorId(flavorSteps);
  const modelsByChainId = new Map<number, Set<number>>();
  for (const resp of chainResponses) {
    if (resp.llm_prompt_chain_id === null) {
      continue;
    }
    let set = modelsByChainId.get(resp.llm_prompt_chain_id);
    if (!set) {
      set = new Set<number>();
      modelsByChainId.set(resp.llm_prompt_chain_id, set);
    }
    set.add(resp.llm_model_id);
  }

  const testedFlavorIds = new Set<number>();
  const testedModelIds = new Set<number>();
  const validModelIds = new Set(models.map((m) => m.id));

  for (const cap of mappedCaptions) {
    const { flavor } = resolveEffectiveCaptionFlavor(
      cap,
      flavorsById,
      flavorsBySlugLower,
    );
    if (flavor) {
      testedFlavorIds.add(flavor.id);
    }

    const chainModels =
      cap.llm_prompt_chain_id !== null
        ? modelsByChainId.get(cap.llm_prompt_chain_id)
        : undefined;
    if (chainModels && chainModels.size > 0) {
      for (const mId of chainModels) {
        if (validModelIds.has(mId)) {
          testedModelIds.add(mId);
        }
      }
    } else if (flavor) {
      for (const step of stepsByFlavorId.get(flavor.id) ?? []) {
        if (validModelIds.has(step.llm_model_id)) {
          testedModelIds.add(step.llm_model_id);
        }
      }
    }
  }

  const activeMappingIds = new Set(
    demographicMappings.filter((m) => !m.is_deleted).map((m) => m.id),
  );
  const surveyedProfiles = new Set<string>();
  for (const r of demographicResponses) {
    if (activeMappingIds.has(r.answer_question_mapping_id)) {
      surveyedProfiles.add(r.user_id);
    }
  }

  const activeStudies = catalogEntries.filter(
    (s) => s.status === "active",
  ).length;
  const swipeStudies = catalogEntries.filter(
    (s) => s.exposureMode === "swipe_navigation",
  ).length;
  const likertStudies = catalogEntries.length - swipeStudies;
  const totalParticipations = participations.length;
  const completedParticipations = participations.filter(
    (p) => p.ended_at !== null,
  ).length;

  return {
    studies: catalogEntries,
    latestStudyId: catalogEntries[0]?.id ?? null,
    kpis: {
      totalStudies: catalogEntries.length,
      activeStudies,
      swipeStudies,
      likertStudies,
      totalParticipations,
      completedParticipations,
      overallCompletionRate:
        totalParticipations > 0
          ? completedParticipations / totalParticipations
          : null,
      totalFlavorCount: flavors.length,
      testedFlavorCount: testedFlavorIds.size,
      totalModelCount: models.length,
      testedModelCount: testedModelIds.size,
      mappedCaptionCount: distinctMappedCaptionIds.length,
      totalVoteEvents,
      totalNavigationEvents,
      surveyedProfileCount: surveyedProfiles.size,
    },
  };
}

export async function fetchStudySearchResultsWithClient(
  supabase: SupabaseClient<Database>,
  rawQuery: string,
  nowMs?: number,
): Promise<StudySearchResponse> {
  const effectiveNowMs = nowMs ?? Date.now();
  const query = rawQuery.trim().slice(0, 80);
  const queryLower = query.toLowerCase();

  if (query.length === 0) {
    const cacheNamespace =
      await resolveVerifiedSuperadminCacheNamespace(supabase);

    const loadEmptySearchUncached = async (): Promise<StudySearchResponse> => {
      const studies = await fetchStudiesList(supabase);
      const topStudySummaries = studies.slice(0, 5);
      const topStudyIds = topStudySummaries.map((s) => s.id);
      const topStudyMappings =
        topStudyIds.length > 0
          ? await fetchRowsByIdChunks<number, RawStudyMappingRow>({
              ids: topStudyIds,
              contextLabel: "top study caption mappings",
              runQuery: (chunk, from, to) =>
                supabase
                  .from("study_caption_mappings")
                  .select("id, study_id, caption_id")
                  .in("study_id", chunk)
                  .order("id", { ascending: true })
                  .range(from, to) as PromiseLike<
                  SupabaseListResult<RawStudyMappingRow>
                >,
            })
          : [];
      const topStudies = await buildStudyCatalogEntries(
        supabase,
        topStudySummaries,
        topStudyMappings,
        [],
        nowMs ?? Date.now(),
      );
      return {
        studies: topStudies.map((s) => ({
          id: s.id,
          title: s.title,
          slug: s.slug,
          status: s.status,
          formatLabel: s.formatLabel,
          href: `/study/${s.id}/attribution`,
        })),
        flavors: [],
        models: [],
        reports: [...GLOBAL_REPORTS],
      };
    };

    if (cacheNamespace === null) {
      return loadEmptySearchUncached();
    }
    return emptySearchResponseCache.resolveWithSwr(
      cacheNamespace,
      effectiveNowMs,
      () => nowMs ?? Date.now(),
      loadEmptySearchUncached,
    );
  }

  const [studies, mappings, participations, flavors, flavorSteps, models, providers] =
    await Promise.all([
      fetchStudiesList(supabase),
      fetchAllStudyMappings(supabase),
      fetchAllStudyParticipations(supabase),
      fetchAllRows<RawFlavorRow>({
        contextLabel: "humor flavors",
        runQuery: (from, to) =>
          supabase
            .from("humor_flavors")
            .select("id, slug, description")
            .order("id", { ascending: true })
            .range(from, to) as PromiseLike<SupabaseListResult<RawFlavorRow>>,
      }),
      fetchAllRows<RawFlavorStepRow>({
        contextLabel: "humor flavor steps",
        runQuery: (from, to) =>
          supabase
            .from("humor_flavor_steps")
            .select("id, humor_flavor_id, order_by, llm_model_id")
            .order("id", { ascending: true })
            .range(from, to) as PromiseLike<
            SupabaseListResult<RawFlavorStepRow>
          >,
      }),
      fetchAllRows<RawModelRow>({
        contextLabel: "llm models",
        runQuery: (from, to) =>
          supabase
            .from("llm_models")
            .select("id, name, provider_model_id, llm_provider_id")
            .order("id", { ascending: true })
            .range(from, to) as PromiseLike<SupabaseListResult<RawModelRow>>,
      }),
      fetchAllRows<RawProviderRow>({
        contextLabel: "llm providers",
        runQuery: (from, to) =>
          supabase
            .from("llm_providers")
            .select("id, name")
            .order("id", { ascending: true })
            .range(from, to) as PromiseLike<SupabaseListResult<RawProviderRow>>,
      }),
    ]);

  const hasExplicitHash = query.startsWith("#");
  const numericTerm = hasExplicitHash ? query.slice(1) : query;
  const matchedStudySummaries = studies
    .filter((s) => {
      if (hasExplicitHash) {
        return (
          numericTerm.length > 0 &&
          (String(s.id) === numericTerm || String(s.id).startsWith(numericTerm))
        );
      }
      if (String(s.id) === numericTerm || String(s.id).startsWith(numericTerm)) {
        return true;
      }
      if (s.slug?.toLowerCase().includes(queryLower)) {
        return true;
      }
      if (s.description?.toLowerCase().includes(queryLower)) {
        return true;
      }
      return false;
    })
    .sort((left, right) => {
      const leftExact = String(left.id) === numericTerm ? 1 : 0;
      const rightExact = String(right.id) === numericTerm ? 1 : 0;
      if (leftExact !== rightExact) {
        return rightExact - leftExact;
      }
      return right.id - left.id;
    })
    .slice(0, MAX_SEARCH_ITEMS_PER_GROUP);

  const distinctMappedCaptionIds = Array.from(
    new Set(mappings.map((m) => m.caption_id)),
  );

  type RawSearchCaptionRow = Pick<
    Tables<"captions">,
    "id" | "humor_flavor_id" | "llm_prompt_chain_id" | "caption_request_id" | "metadata"
  >;

  const [matchedStudyCatalog, mappedCaptions] = await Promise.all([
    buildStudyCatalogEntries(
      supabase,
      matchedStudySummaries,
      mappings,
      participations,
      effectiveNowMs,
    ),
    fetchRowsByIdChunks<string, RawSearchCaptionRow>({
      ids: distinctMappedCaptionIds,
      contextLabel: "search mapped captions",
      runQuery: (chunk, from, to) =>
        supabase
          .from("captions")
          .select("id, humor_flavor_id, llm_prompt_chain_id, caption_request_id, metadata")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<
          SupabaseListResult<RawSearchCaptionRow>
        >,
    }),
  ]);

  const searchChainIds = mappedCaptions
    .map((c) => c.llm_prompt_chain_id)
    .filter((id): id is number => id !== null);
  const searchFallbackReqIds = mappedCaptions
    .filter((c) => c.llm_prompt_chain_id === null && c.caption_request_id !== null)
    .map((c) => c.caption_request_id as number);

  type RawSearchRespRow = Pick<
    Tables<"llm_model_responses">,
    | "id"
    | "llm_prompt_chain_id"
    | "caption_request_id"
    | "humor_flavor_step_id"
    | "llm_model_id"
    | "created_datetime_utc"
  >;

  const [searchChainResps, searchReqResps] = await Promise.all([
    fetchRowsByIdChunks<number, RawSearchRespRow>({
      ids: searchChainIds,
      contextLabel: "search chain responses",
      runQuery: (chunk, from, to) =>
        supabase
          .from("llm_model_responses")
          .select(
            "id, llm_prompt_chain_id, caption_request_id, humor_flavor_step_id, llm_model_id, created_datetime_utc",
          )
          .in("llm_prompt_chain_id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawSearchRespRow>>,
    }),
    fetchRowsByIdChunks<number, RawSearchRespRow>({
      ids: searchFallbackReqIds,
      contextLabel: "search request responses",
      runQuery: (chunk, from, to) =>
        supabase
          .from("llm_model_responses")
          .select(
            "id, llm_prompt_chain_id, caption_request_id, humor_flavor_step_id, llm_model_id, created_datetime_utc",
          )
          .in("caption_request_id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawSearchRespRow>>,
    }),
  ]);

  const { flavorsById, flavorsBySlugLower } = buildFlavorLookupMaps(flavors);
  const stepsByFlavorId = buildStepsByFlavorId(flavorSteps);
  const stepById = new Map(flavorSteps.map((s) => [s.id, s]));
  const providersById = new Map(providers.map((p) => [p.id, p]));

  const respsByChain = new Map<number, RawSearchRespRow[]>();
  const respsByReq = new Map<number, RawSearchRespRow[]>();
  const seenRespIds = new Set<string>();
  for (const resp of [...searchChainResps, ...searchReqResps]) {
    if (seenRespIds.has(resp.id)) {
      continue;
    }
    seenRespIds.add(resp.id);
    if (resp.llm_prompt_chain_id !== null) {
      let list = respsByChain.get(resp.llm_prompt_chain_id);
      if (!list) {
        list = [];
        respsByChain.set(resp.llm_prompt_chain_id, list);
      }
      list.push(resp);
    }
    if (resp.caption_request_id !== null) {
      let list = respsByReq.get(resp.caption_request_id);
      if (!list) {
        list = [];
        respsByReq.set(resp.caption_request_id, list);
      }
      list.push(resp);
    }
  }

  const pickTerminalModelId = (rows: readonly RawSearchRespRow[]): number | null => {
    if (rows.length === 0) {
      return null;
    }
    const ordered = [...rows].sort((left, right) => {
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
    return ordered[ordered.length - 1].llm_model_id;
  };

  const captionFlavorId = new Map<string, number>();
  const captionTerminalModelId = new Map<string, number>();
  for (const cap of mappedCaptions) {
    const { flavor } = resolveEffectiveCaptionFlavor(
      cap,
      flavorsById,
      flavorsBySlugLower,
    );
    if (flavor) {
      captionFlavorId.set(cap.id, flavor.id);
    }

    const chainRows =
      cap.llm_prompt_chain_id !== null
        ? (respsByChain.get(cap.llm_prompt_chain_id) ?? [])
        : cap.caption_request_id !== null
          ? (respsByReq.get(cap.caption_request_id) ?? [])
          : [];
    const executedTerminalModelId = pickTerminalModelId(chainRows);
    if (executedTerminalModelId !== null) {
      captionTerminalModelId.set(cap.id, executedTerminalModelId);
    } else if (flavor) {
      const steps = stepsByFlavorId.get(flavor.id) ?? [];
      if (steps.length > 0) {
        captionTerminalModelId.set(cap.id, steps[steps.length - 1].llm_model_id);
      }
    }
  }

  const studiesByFlavor = new Map<number, Set<number>>();
  const studiesByModel = new Map<number, Set<number>>();
  for (const m of mappings) {
    const fId = captionFlavorId.get(m.caption_id);
    if (fId !== undefined) {
      let fSet = studiesByFlavor.get(fId);
      if (!fSet) {
        fSet = new Set<number>();
        studiesByFlavor.set(fId, fSet);
      }
      fSet.add(m.study_id);
    }

    const terminalModelId = captionTerminalModelId.get(m.caption_id);
    if (terminalModelId !== undefined) {
      let mSet = studiesByModel.get(terminalModelId);
      if (!mSet) {
        mSet = new Set<number>();
        studiesByModel.set(terminalModelId, mSet);
      }
      mSet.add(m.study_id);
    }
  }

  const getMaxStudyId = (set: Set<number> | undefined): number | null => {
    if (!set || set.size === 0) {
      return null;
    }
    let maxId = -1;
    for (const id of set) {
      if (id > maxId) {
        maxId = id;
      }
    }
    return maxId;
  };

  const matchedFlavors = flavors
    .filter(
      (f) =>
        f.slug.toLowerCase().includes(queryLower) ||
        f.description?.toLowerCase().includes(queryLower) ||
        String(f.id) === numericTerm,
    )
    .sort((a, b) => {
      const aStudies = studiesByFlavor.get(a.id)?.size ?? 0;
      const bStudies = studiesByFlavor.get(b.id)?.size ?? 0;
      if (aStudies !== bStudies) {
        return bStudies - aStudies;
      }
      return a.slug.localeCompare(b.slug);
    })
    .slice(0, MAX_SEARCH_ITEMS_PER_GROUP)
    .map((f) => {
      const studySet = studiesByFlavor.get(f.id);
      const latestStudyId = getMaxStudyId(studySet);
      return {
        id: f.id,
        slug: f.slug,
        description: f.description,
        studyCount: studySet?.size ?? 0,
        latestStudyId,
        href:
          latestStudyId !== null
            ? `/study/${latestStudyId}/attribution?flavor=${f.id}`
            : null,
      };
    });

  const matchedModels = models
    .filter((m) => {
      const pName = providersById.get(m.llm_provider_id)?.name ?? "";
      return (
        m.name.toLowerCase().includes(queryLower) ||
        m.provider_model_id.toLowerCase().includes(queryLower) ||
        pName.toLowerCase().includes(queryLower) ||
        String(m.id) === numericTerm
      );
    })
    .sort((a, b) => {
      const aStudies = studiesByModel.get(a.id)?.size ?? 0;
      const bStudies = studiesByModel.get(b.id)?.size ?? 0;
      if (aStudies !== bStudies) {
        return bStudies - aStudies;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_SEARCH_ITEMS_PER_GROUP)
    .map((m) => {
      const studySet = studiesByModel.get(m.id);
      const latestStudyId = getMaxStudyId(studySet);
      return {
        id: m.id,
        name: m.name,
        providerModelId: m.provider_model_id,
        providerName: providersById.get(m.llm_provider_id)?.name ?? "Unknown",
        studyCount: studySet?.size ?? 0,
        latestStudyId,
        href:
          latestStudyId !== null
            ? `/study/${latestStudyId}/attribution?groupBy=model&model=${m.id}`
            : null,
      };
    });

  const matchedReports = GLOBAL_REPORTS.filter((r) =>
    r.label.toLowerCase().includes(queryLower),
  );

  return {
    studies: matchedStudyCatalog.map((s) => ({
      id: s.id,
      title: s.title,
      slug: s.slug,
      status: s.status,
      formatLabel: s.formatLabel,
      href: `/study/${s.id}/attribution`,
    })),
    flavors: matchedFlavors,
    models: matchedModels,
    reports: matchedReports,
  };
}

type TimedSwrEntry<TValue> = {
  value?: TValue;
  freshUntilMs: number;
  staleUntilMs: number;
  inFlight?: Promise<TValue>;
};

class BoundedSwrLru<TValue> {
  private readonly store = new Map<string, TimedSwrEntry<TValue>>();
  private readonly maxEntries: number;
  private readonly freshTtlMs: number;
  private readonly maxStaleMs: number;

  constructor(maxEntries: number, freshTtlMs: number, maxStaleMs: number) {
    this.maxEntries = maxEntries;
    this.freshTtlMs = freshTtlMs;
    this.maxStaleMs = maxStaleMs;
  }

  private promote(key: string, entry: TimedSwrEntry<TValue>): void {
    this.store.delete(key);
    this.store.set(key, entry);
  }

  private evictOverflow(): void {
    for (const oldestKey of this.store.keys()) {
      if (this.store.size <= this.maxEntries) {
        break;
      }
      this.store.delete(oldestKey);
    }
  }

  resolveWithSwr(
    key: string,
    nowMs: number,
    resolveCompletedAtMs: () => number,
    loader: () => Promise<TValue>,
  ): Promise<TValue> {
    const startBlocking = (): Promise<TValue> => {
      const record: TimedSwrEntry<TValue> = {
        freshUntilMs: 0,
        staleUntilMs: 0,
      };
      const inFlight = loader()
        .then((val) => {
          const doneMs = resolveCompletedAtMs();
          record.value = val;
          record.freshUntilMs = doneMs + this.freshTtlMs;
          record.staleUntilMs = record.freshUntilMs + this.maxStaleMs;
          return val;
        })
        .finally(() => {
          const current = this.store.get(key);
          if (current === record) {
            current.inFlight = undefined;
            if (current.value === undefined) {
              this.store.delete(key);
            }
          }
        });
      record.inFlight = inFlight;
      this.promote(key, record);
      this.evictOverflow();
      return inFlight;
    };

    const existing = this.store.get(key);
    if (existing) {
      if (existing.value !== undefined && nowMs < existing.freshUntilMs) {
        this.promote(key, existing);
        return Promise.resolve(existing.value);
      }

      if (existing.value !== undefined && nowMs < existing.staleUntilMs) {
        this.promote(key, existing);
        if (!existing.inFlight) {
          const bgRefresh = loader()
            .then((freshVal) => {
              const current = this.store.get(key);
              if (current === existing) {
                const doneMs = resolveCompletedAtMs();
                current.value = freshVal;
                current.freshUntilMs = doneMs + this.freshTtlMs;
                current.staleUntilMs = current.freshUntilMs + this.maxStaleMs;
              }
              return freshVal;
            })
            .finally(() => {
              const current = this.store.get(key);
              if (current === existing) {
                current.inFlight = undefined;
              }
            });
          void bgRefresh.catch(() => undefined);
          existing.inFlight = bgRefresh;
        }
        return Promise.resolve(existing.value);
      }

      if (existing.inFlight) {
        this.promote(key, existing);
        return existing.inFlight.catch(() => startBlocking());
      }

      this.store.delete(key);
    }

    return startBlocking();
  }

  async resolveManyWithSwr<TKey extends number | string>({
    namespace,
    keys,
    nowMs,
    resolveCompletedAtMs,
    batchLoader,
  }: {
    namespace: string;
    keys: readonly TKey[];
    nowMs: number;
    resolveCompletedAtMs: () => number;
    batchLoader: (missingKeys: TKey[]) => Promise<Map<TKey, TValue>>;
  }): Promise<Map<TKey, TValue>> {
    const resolved = new Map<TKey, TValue>();
    const staleRefreshItems: Array<{
      itemKey: TKey;
      fullKey: string;
      entry: TimedSwrEntry<TValue>;
    }> = [];
    const joinedWaiters: Array<Promise<void>> = [];
    const blockingMissKeys: TKey[] = [];
    const fallbackMissKeys: TKey[] = [];

    for (const itemKey of keys) {
      const fullKey = `${namespace}:${String(itemKey)}`;
      const existing = this.store.get(fullKey);
      if (existing) {
        if (existing.value !== undefined && nowMs < existing.freshUntilMs) {
          this.promote(fullKey, existing);
          resolved.set(itemKey, existing.value);
          continue;
        }
        if (existing.value !== undefined && nowMs < existing.staleUntilMs) {
          this.promote(fullKey, existing);
          resolved.set(itemKey, existing.value);
          if (!existing.inFlight) {
            staleRefreshItems.push({ itemKey, fullKey, entry: existing });
          }
          continue;
        }
        if (existing.inFlight) {
          this.promote(fullKey, existing);
          joinedWaiters.push(
            existing.inFlight.then(
              (val) => {
                resolved.set(itemKey, val);
              },
              () => {
                fallbackMissKeys.push(itemKey);
              },
            ),
          );
          continue;
        }
        this.store.delete(fullKey);
      }
      blockingMissKeys.push(itemKey);
    }

    if (staleRefreshItems.length > 0) {
      const bgKeys = staleRefreshItems.map((item) => item.itemKey);
      const bgBatchPromise = batchLoader(bgKeys);
      void bgBatchPromise.catch(() => undefined);
      for (const { itemKey, fullKey, entry } of staleRefreshItems) {
        const perKeyPromise = bgBatchPromise
          .then((batchMap) => {
            const freshVal = batchMap.get(itemKey);
            if (freshVal === undefined) {
              throw new Error(`Missing batch trajectory for ${String(itemKey)}`);
            }
            const current = this.store.get(fullKey);
            if (current === entry) {
              const doneMs = resolveCompletedAtMs();
              current.value = freshVal;
              current.freshUntilMs = doneMs + this.freshTtlMs;
              current.staleUntilMs = current.freshUntilMs + this.maxStaleMs;
            }
            return freshVal;
          })
          .finally(() => {
            const current = this.store.get(fullKey);
            if (current === entry) {
              current.inFlight = undefined;
            }
          });
        void perKeyPromise.catch(() => undefined);
        entry.inFlight = perKeyPromise;
      }
    }

    const fetchBlockingGroup = async (groupKeys: TKey[]): Promise<void> => {
      if (groupKeys.length === 0) {
        return;
      }
      const batchPromise = batchLoader(groupKeys);
      const perKeyPromises: Array<Promise<void>> = [];

      for (const itemKey of groupKeys) {
        const fullKey = `${namespace}:${String(itemKey)}`;
        const record: TimedSwrEntry<TValue> = {
          freshUntilMs: 0,
          staleUntilMs: 0,
        };
        const inFlight = batchPromise
          .then((batchMap) => {
            const val = batchMap.get(itemKey);
            if (val === undefined) {
              throw new Error(`Missing batch trajectory for ${String(itemKey)}`);
            }
            const doneMs = resolveCompletedAtMs();
            record.value = val;
            record.freshUntilMs = doneMs + this.freshTtlMs;
            record.staleUntilMs = record.freshUntilMs + this.maxStaleMs;
            return val;
          })
          .finally(() => {
            const current = this.store.get(fullKey);
            if (current === record) {
              current.inFlight = undefined;
              if (current.value === undefined) {
                this.store.delete(fullKey);
              }
            }
          });
        record.inFlight = inFlight;
        this.promote(fullKey, record);
        this.evictOverflow();
        perKeyPromises.push(
          inFlight.then((val) => {
            resolved.set(itemKey, val);
          }),
        );
      }

      await Promise.all(perKeyPromises);
    };

    await Promise.all([
      Promise.all(joinedWaiters),
      fetchBlockingGroup(blockingMissKeys),
    ]);

    if (fallbackMissKeys.length > 0) {
      await fetchBlockingGroup(fallbackMissKeys);
    }

    return resolved;
  }

  clear(): void {
    this.store.clear();
  }
}

type CachedStudyComputedPayload = Omit<
  StudyAttributionBundle,
  "study" | "studies" | "captionsById"
> & {
  captionsById: ReadonlyMap<string, CaptionLineageInfo>;
};

type CachedStudyRawDataset = {
  mappedCaptionIds: readonly string[];
  participationRows: readonly RawStudyParticipationRow[];
  voteRows: readonly RawStudyVoteRow[];
  navigationRows: readonly RawStudyNavigationRow[];
  demographicQuestions: readonly RawDemographicQuestionRow[];
  demographicAnswers: readonly RawDemographicAnswerRow[];
  demographicMappings: readonly RawDemographicMappingRow[];
  demographicResponses: readonly RawDemographicUserResponseRow[];
  captionsById: ReadonlyMap<string, CaptionLineageInfo>;
  metadataAttributedCaptionCount: number;
  unattributedCaptionCount: number;
  computedAll?: CachedStudyComputedPayload;
  computedFiltered?: CachedStudyComputedPayload;
};

type StudyLineageCacheRegistry = {
  studyRawDatasetCache: BoundedSwrLru<CachedStudyRawDataset>;
  flavorTrajectoryCache: BoundedSwrLru<readonly FlavorCrossStudyPoint[]>;
  topNavbarMetadataCache: BoundedSwrLru<TopNavbarMetadata>;
  emptySearchResponseCache: BoundedSwrLru<StudySearchResponse>;
};

const STUDY_LINEAGE_CACHE_SYMBOL = Symbol.for(
  "the-lol-report.studyLineageCacheRegistry.v3",
);

const getStudyLineageCacheRegistry = (): StudyLineageCacheRegistry => {
  const host = globalThis as Record<
    symbol,
    StudyLineageCacheRegistry | undefined
  >;
  let registry = host[STUDY_LINEAGE_CACHE_SYMBOL];
  if (!registry) {
    registry = {
      studyRawDatasetCache: new BoundedSwrLru<CachedStudyRawDataset>(
        STUDY_CACHE_MAX_ENTRIES,
        STUDY_CACHE_TTL_MS,
        STUDY_CACHE_MAX_STALE_MS,
      ),
      flavorTrajectoryCache: new BoundedSwrLru<readonly FlavorCrossStudyPoint[]>(
        TRAJECTORY_CACHE_MAX_ENTRIES,
        STUDY_CACHE_TTL_MS,
        STUDY_CACHE_MAX_STALE_MS,
      ),
      topNavbarMetadataCache: new BoundedSwrLru<TopNavbarMetadata>(
        4,
        STUDY_CACHE_TTL_MS,
        STUDY_CACHE_MAX_STALE_MS,
      ),
      emptySearchResponseCache: new BoundedSwrLru<StudySearchResponse>(
        4,
        STUDY_CACHE_TTL_MS,
        STUDY_CACHE_MAX_STALE_MS,
      ),
    };
    host[STUDY_LINEAGE_CACHE_SYMBOL] = registry;
  }
  return registry;
};

const {
  studyRawDatasetCache,
  flavorTrajectoryCache,
  topNavbarMetadataCache,
  emptySearchResponseCache,
} = getStudyLineageCacheRegistry();

/** Clears module-level study and trajectory caches (useful in unit tests). */
export function clearStudyLineageCaches(): void {
  studyRawDatasetCache.clear();
  flavorTrajectoryCache.clear();
  topNavbarMetadataCache.clear();
  emptySearchResponseCache.clear();
}

/**
 * Verifies live caller authentication and `profiles.is_superadmin = true`
 * before allowing access to any cross-request module-level cache namespace.
 *
 * Returns `null` for unauthenticated callers, non-superadmin callers, errored
 * checks, and bare unit-test mock clients lacking `auth.getUser`, causing the
 * loader to skip both reading from and writing to shared caches.
 */
async function resolveVerifiedSuperadminCacheNamespace(
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  const rawUrl: unknown = Reflect.get(supabase as object, "supabaseUrl");
  if (typeof rawUrl !== "string") {
    return null;
  }
  const normalizedUrl = rawUrl.trim().replace(/\/+$/, "");
  if (normalizedUrl.length === 0) {
    return null;
  }

  const rawAuth: unknown = Reflect.get(supabase as object, "auth");
  if (!rawAuth || typeof rawAuth !== "object") {
    return null;
  }
  const rawGetUser: unknown = Reflect.get(rawAuth, "getUser");
  if (typeof rawGetUser !== "function") {
    return null;
  }

  try {
    const authResult: unknown = await rawGetUser.call(rawAuth);
    if (!authResult || typeof authResult !== "object") {
      return null;
    }
    const authError: unknown = Reflect.get(authResult, "error");
    if (authError) {
      return null;
    }
    const authData: unknown = Reflect.get(authResult, "data");
    const authUser: unknown =
      authData && typeof authData === "object"
        ? Reflect.get(authData, "user")
        : null;
    const userId: unknown =
      authUser && typeof authUser === "object"
        ? Reflect.get(authUser, "id")
        : null;
    if (typeof userId !== "string" || userId.length === 0) {
      return null;
    }
    const isSuperadmin = await isSuperadminProfile(supabase, userId);
    if (!isSuperadmin) {
      return null;
    }
    return normalizedUrl;
  } catch {
    return null;
  }
}

const delayRetryMs = (ms: number): Promise<void> =>
  ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

/**
 * Loads large event tables in parallel across chunked foreign-key IDs by
 * probing each chunk's exact count (`HEAD`) first, fanning out concurrent
 * range pages (`concurrency = 8`), sweeping any trailing tail after the probe,
 * and recursively splitting oversized transient-failure chunks in half.
 */
export async function fetchChunkedRowsConcurrently<
  TId extends string | number,
  TRow,
>({
  ids,
  contextLabel,
  chunkSize = DEFAULT_QUERY_CHUNK_SIZE,
  pageSize = DEFAULT_QUERY_PAGE_SIZE,
  chunkConcurrency = EVENT_CHUNK_CONCURRENCY,
  pageConcurrency = EVENT_PAGE_CONCURRENCY,
  retryAttempts = PAGE_RETRY_ATTEMPTS,
  retryBaseDelayMs = PAGE_RETRY_BASE_DELAY_MS,
  runCountQuery,
  runPageQuery,
}: {
  ids: readonly TId[];
  contextLabel: string;
  chunkSize?: number;
  pageSize?: number;
  chunkConcurrency?: number;
  pageConcurrency?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  runCountQuery: (chunk: TId[]) => PromiseLike<SupabaseCountResult>;
  runPageQuery: (
    chunk: TId[],
    from: number,
    to: number,
  ) => PromiseLike<SupabaseListResult<TRow>>;
}): Promise<TRow[]> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return [];
  }

  const safePageSize = Math.max(1, Math.floor(pageSize));
  const maxAttempts = Math.max(1, Math.floor(retryAttempts));

  const fetchWindowWithRetry = async (
    chunk: TId[],
    from: number,
    to: number,
  ): Promise<TRow[]> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { data, error } = await runPageQuery(chunk, from, to);
        if (error) {
          throw new Error(error.message);
        }
        return data ?? [];
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown query error";
        if (isLikelyTransientFetchError(message) && attempt < maxAttempts) {
          await delayRetryMs(retryBaseDelayMs * attempt);
          continue;
        }
        throw new Error(message);
      }
    }
    /* c8 ignore next */
    throw new Error("exhausted retries");
  };

  const fetchChunk = async (chunk: TId[]): Promise<TRow[]> => {
    try {
      const exactCount = await fetchExactCount({
        contextLabel,
        retryAttempts: maxAttempts,
        retryBaseDelayMs,
        runQuery: () => runCountQuery(chunk),
      });
      if (exactCount <= 0) {
        return [];
      }

      const pageCount = Math.ceil(exactCount / safePageSize);
      const windows = Array.from({ length: pageCount }, (_, index) => {
        const from = index * safePageSize;
        return { from, to: from + safePageSize - 1 };
      });

      const pages = await mapWithConcurrency(
        windows,
        pageConcurrency,
        (win) => fetchWindowWithRetry(chunk, win.from, win.to),
      );

      const collected = pages.flat();
      const lastPage = pages[pages.length - 1];
      if (lastPage && lastPage.length >= safePageSize) {
        let nextFrom = pageCount * safePageSize;
        while (true) {
          const tailRows = await fetchWindowWithRetry(
            chunk,
            nextFrom,
            nextFrom + safePageSize - 1,
          );
          collected.push(...tailRows);
          if (tailRows.length < safePageSize) {
            break;
          }
          nextFrom += safePageSize;
        }
      }

      return collected;
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Unknown query error";
      if (isLikelyTransientFetchError(rawMessage) && chunk.length > 1) {
        const midpoint = Math.ceil(chunk.length / 2);
        const left = await fetchChunk(chunk.slice(0, midpoint));
        const right = await fetchChunk(chunk.slice(midpoint));
        return [...left, ...right];
      }
      if (rawMessage.startsWith(`Unable to count ${contextLabel}:`)) {
        throw new Error(rawMessage);
      }
      throw new Error(`Unable to load ${contextLabel}: ${rawMessage}`);
    }
  };

  const chunks = chunkArray(uniqueIds, chunkSize);
  const perChunk = await mapWithConcurrency(
    chunks,
    chunkConcurrency,
    fetchChunk,
  );
  return perChunk.flat();
}

async function loadUncachedStudyRawDataset(
  supabase: SupabaseClient<Database>,
  studyId: number,
): Promise<CachedStudyRawDataset> {
  // Wave 1: mappings, participations, and small reference dictionaries.
  const [
    studyMappings,
    participationRows,
    flavors,
    flavorSteps,
    models,
    providers,
    demographicQuestions,
    demographicAnswers,
    demographicMappings,
  ] = await Promise.all([
    fetchAllRows<RawStudyMappingRow>({
      contextLabel: "study caption mappings",
      runQuery: (from, to) =>
        supabase
          .from("study_caption_mappings")
          .select("id, study_id, caption_id")
          .eq("study_id", studyId)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<
          SupabaseListResult<RawStudyMappingRow>
        >,
    }),
    fetchAllRows<RawStudyParticipationRow>({
      contextLabel: "study participations",
      runQuery: (from, to) =>
        supabase
          .from("study_participations")
          .select("profile_id, study_id, started_at, ended_at, completion_stats")
          .eq("study_id", studyId)
          .order("started_at", { ascending: true })
          .order("profile_id", { ascending: true })
          .range(from, to) as PromiseLike<
          SupabaseListResult<RawStudyParticipationRow>
        >,
    }),
    fetchAllRows<RawFlavorRow>({
      contextLabel: "humor flavors",
      runQuery: (from, to) =>
        supabase
          .from("humor_flavors")
          .select("id, slug, description")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawFlavorRow>>,
    }),
    fetchAllRows<RawFlavorStepRow>({
      contextLabel: "humor flavor steps",
      runQuery: (from, to) =>
        supabase
          .from("humor_flavor_steps")
          .select("id, humor_flavor_id, order_by, llm_model_id")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawFlavorStepRow>>,
    }),
    fetchAllRows<RawModelRow>({
      contextLabel: "llm models",
      runQuery: (from, to) =>
        supabase
          .from("llm_models")
          .select("id, name, provider_model_id, llm_provider_id")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawModelRow>>,
    }),
    fetchAllRows<RawProviderRow>({
      contextLabel: "llm providers",
      runQuery: (from, to) =>
        supabase
          .from("llm_providers")
          .select("id, name")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawProviderRow>>,
    }),
    fetchAllRows<RawDemographicQuestionRow>({
      contextLabel: "demographic questions",
      runQuery: (from, to) =>
        supabase
          .from("demographic_questions")
          .select("id, question")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<
          SupabaseListResult<RawDemographicQuestionRow>
        >,
    }),
    fetchAllRows<RawDemographicAnswerRow>({
      contextLabel: "demographic answers",
      runQuery: (from, to) =>
        supabase
          .from("demographic_answers")
          .select("id, answer")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<
          SupabaseListResult<RawDemographicAnswerRow>
        >,
    }),
    fetchAllRows<RawDemographicMappingRow>({
      contextLabel: "demographic answer mappings",
      runQuery: (from, to) =>
        supabase
          .from("demographic_answer_question_mapping")
          .select("id, question_id, answer_id, display_order, is_deleted")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<
          SupabaseListResult<RawDemographicMappingRow>
        >,
    }),
  ]);

  const mappingIds = studyMappings.map((row) => row.id);
  const mappedCaptionIds = Array.from(
    new Set(studyMappings.map((row) => row.caption_id)),
  );

  // Wave 2: concurrent multi-page vote & navigation scans + mapped captions.
  const [voteRows, navigationRows, captions] = await Promise.all([
    fetchChunkedRowsConcurrently<number, RawStudyVoteRow>({
      ids: mappingIds,
      contextLabel: "study caption vote events",
      runCountQuery: (chunk) =>
        supabase
          .from("study_caption_vote_events")
          .select("id", { count: "exact", head: true })
          .in("study_caption_mapping_id", chunk),
      runPageQuery: (chunk, from, to) =>
        supabase
          .from("study_caption_vote_events")
          .select(
            "id, profile_id, caption_id, study_caption_mapping_id, vote_value, time_to_vote_ms, session_id, created_datetime_utc",
          )
          .in("study_caption_mapping_id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawStudyVoteRow>>,
    }),
    fetchChunkedRowsConcurrently<number, RawStudyNavigationRow>({
      ids: mappingIds,
      contextLabel: "study caption navigation events",
      runCountQuery: (chunk) =>
        supabase
          .from("study_caption_navigation_events")
          .select("id", { count: "exact", head: true })
          .in("study_caption_mapping_id", chunk),
      runPageQuery: (chunk, from, to) =>
        supabase
          .from("study_caption_navigation_events")
          .select(
            "id, profile_id, caption_id, study_caption_mapping_id, time_to_next_caption_ms, session_id, created_datetime_utc",
          )
          .in("study_caption_mapping_id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<
          SupabaseListResult<RawStudyNavigationRow>
        >,
    }),
    fetchRowsByIdChunks<string, RawCaptionLineageRow>({
      ids: mappedCaptionIds,
      contextLabel: "captions",
      runQuery: (chunk, from, to) =>
        supabase
          .from("captions")
          .select(
            "id, content, image_id, humor_flavor_id, llm_prompt_chain_id, caption_request_id, metadata",
          )
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<
          SupabaseListResult<RawCaptionLineageRow>
        >,
    }),
  ]);

  const imageIds = captions
    .map((row) => row.image_id)
    .filter((id): id is string => id !== null);
  const chainIds = captions
    .map((row) => row.llm_prompt_chain_id)
    .filter((id): id is number => id !== null);
  const fallbackRequestIds = captions
    .filter(
      (row) => row.llm_prompt_chain_id === null && row.caption_request_id !== null,
    )
    .map((row) => row.caption_request_id as number);

  // Fetch survey answers for every participant who generated a valid exposure
  // event so toggling excludeHighRisk true <-> false hits the warm cache cleanly.
  const allStudyVoterIdsSet = new Set<string>();
  for (const row of voteRows) {
    if (row.study_caption_mapping_id !== null) {
      allStudyVoterIdsSet.add(row.profile_id);
    }
  }
  for (const row of navigationRows) {
    if (row.study_caption_mapping_id !== null) {
      allStudyVoterIdsSet.add(row.profile_id);
    }
  }
  const allStudyVoterIds = Array.from(allStudyVoterIdsSet);

  // Wave 3: images, prompt-chain LLM responses, and study voters' demographic answers.
  const [images, chainResponses, requestFallbackResponses, demographicResponses] =
    await Promise.all([
      fetchRowsByIdChunks<string, RawImageRow>({
        ids: imageIds,
        contextLabel: "images",
        runQuery: (chunk, from, to) =>
          supabase
            .from("images")
            .select("id, url, image_description")
            .in("id", chunk)
            .order("id", { ascending: true })
            .range(from, to) as PromiseLike<SupabaseListResult<RawImageRow>>,
      }),
      fetchRowsByIdChunks<number, RawLlmResponseRow>({
        ids: chainIds,
        contextLabel: "llm model responses",
        runQuery: (chunk, from, to) =>
          supabase
            .from("llm_model_responses")
            .select(
              "id, llm_prompt_chain_id, caption_request_id, humor_flavor_id, humor_flavor_step_id, llm_model_id, processing_time_seconds, created_datetime_utc",
            )
            .in("llm_prompt_chain_id", chunk)
            .order("id", { ascending: true })
            .range(from, to) as PromiseLike<
            SupabaseListResult<RawLlmResponseRow>
          >,
      }),
      fetchRowsByIdChunks<number, RawLlmResponseRow>({
        ids: fallbackRequestIds,
        contextLabel: "llm model responses by request",
        runQuery: (chunk, from, to) =>
          supabase
            .from("llm_model_responses")
            .select(
              "id, llm_prompt_chain_id, caption_request_id, humor_flavor_id, humor_flavor_step_id, llm_model_id, processing_time_seconds, created_datetime_utc",
            )
            .in("caption_request_id", chunk)
            .order("id", { ascending: true })
            .range(from, to) as PromiseLike<
            SupabaseListResult<RawLlmResponseRow>
          >,
      }),
      fetchRowsByIdChunks<string, RawDemographicUserResponseRow>({
        ids: allStudyVoterIds,
        contextLabel: "demographic user responses",
        runQuery: (chunk, from, to) =>
          supabase
            .from("demographic_user_responses")
            .select(
              "id, user_id, answer_question_mapping_id, created_datetime_utc, modified_datetime_utc",
            )
            .in("user_id", chunk)
            .order("id", { ascending: true })
            .range(from, to) as PromiseLike<
            SupabaseListResult<RawDemographicUserResponseRow>
          >,
      }),
    ]);

  const imagesById = new Map(images.map((image) => [image.id, image]));
  const dedupedLlmResponses = Array.from(
    new Map(
      [...chainResponses, ...requestFallbackResponses].map((row) => [
        row.id,
        row,
      ]),
    ).values(),
  );

  const {
    captionsById,
    metadataAttributedCaptionCount,
    unattributedCaptionCount,
  } = assembleCaptionLineageMap({
    captions,
    imagesById,
    flavors,
    flavorSteps,
    models,
    providers,
    llmResponses: dedupedLlmResponses,
  });

  return {
    mappedCaptionIds,
    participationRows,
    voteRows,
    navigationRows,
    demographicQuestions,
    demographicAnswers,
    demographicMappings,
    demographicResponses,
    captionsById,
    metadataAttributedCaptionCount,
    unattributedCaptionCount,
  };
}

export async function fetchStudyAttributionBundleWithClient(
  supabase: SupabaseClient<Database>,
  studyId: number,
  options?: { excludeHighRisk?: boolean; nowMs?: number },
): Promise<StudyAttributionBundle | null> {
  if (!Number.isInteger(studyId) || studyId <= 0) {
    return null;
  }
  const excludeHighRisk = options?.excludeHighRisk === true;
  const nowMs = options?.nowMs ?? Date.now();

  // Always check live caller superadmin status + live study visibility FIRST
  // before touching any cross-request module-level cache entry.
  const [cacheNamespace, studies] = await Promise.all([
    resolveVerifiedSuperadminCacheNamespace(supabase),
    fetchStudiesList(supabase),
  ]);

  const study = studies.find((candidate) => candidate.id === studyId);
  if (!study) {
    return null;
  }

  const cacheKey =
    cacheNamespace !== null ? `${cacheNamespace}:${studyId}` : null;

  const rawData =
    cacheKey !== null
      ? await studyRawDatasetCache.resolveWithSwr(
          cacheKey,
          nowMs,
          () => options?.nowMs ?? Date.now(),
          () => loadUncachedStudyRawDataset(supabase, studyId),
        )
      : await loadUncachedStudyRawDataset(supabase, studyId);

  const cachedComputed = excludeHighRisk
    ? rawData.computedFiltered
    : rawData.computedAll;
  if (cachedComputed) {
    return {
      ...cachedComputed,
      study,
      studies,
      captionsById: new Map(cachedComputed.captionsById),
    };
  }

  const exposureBundle = adaptStudyExposures({
    studyId,
    voteRows: rawData.voteRows,
    navigationRows: rawData.navigationRows,
    excludeHighRisk,
  });

  const sameImage = computeSameImageMetrics({
    mappedCaptionIds: rawData.mappedCaptionIds,
    captionsById: rawData.captionsById,
    exposures: exposureBundle.exposures,
  });

  const leaderboards = buildAttributionLeaderboards({
    mappedCaptionIds: rawData.mappedCaptionIds,
    captionsById: rawData.captionsById,
    exposures: exposureBundle.exposures,
    sameImage,
  });

  const { captionMetrics, captionRateHistogram } =
    buildCaptionMetricsAndHistogram({
      mappedCaptionIds: rawData.mappedCaptionIds,
      captionsById: rawData.captionsById,
      exposures: exposureBundle.exposures,
    });

  const demographics = buildDemographicCohortMatrices({
    exposures: exposureBundle.exposures,
    captionsById: rawData.captionsById,
    flavorRows: leaderboards.flavors,
    questions: rawData.demographicQuestions,
    answers: rawData.demographicAnswers,
    mappings: rawData.demographicMappings,
    responses: rawData.demographicResponses,
  });

  const participationFunnel = buildStudyParticipationFunnel({
    participationRows: rawData.participationRows,
    exposures: exposureBundle.exposures,
    mappedCaptionCount: rawData.mappedCaptionIds.length,
  });

  const computedPayload: CachedStudyComputedPayload = {
    excludeHighRisk,
    mappedCaptionCount: rawData.mappedCaptionIds.length,
    unattributedCaptionCount: rawData.unattributedCaptionCount,
    metadataAttributedCaptionCount: rawData.metadataAttributedCaptionCount,
    studyRateCi: computeWilsonConfidenceInterval(
      exposureBundle.totalPositive,
      exposureBundle.totalExposures,
    ),
    exposureBundle,
    participationFunnel,
    captionsById: rawData.captionsById,
    leaderboards,
    captionRateHistogram,
    captionMetrics,
    headToHead: {
      structuralSharedImageCount: sameImage.structuralSharedImageCount,
      evaluatedSharedImageCount: sameImage.evaluatedSharedImageCount,
      crossFlavorSharedImageCount: sameImage.crossFlavorSharedImageCount,
      comparableCaptionCount: sameImage.comparableCaptionCount,
      maxImageSpreadPp: sameImage.maxImageSpreadPp,
      groups: sameImage.groups,
    },
    demographics,
  };

  if (cacheKey !== null) {
    if (excludeHighRisk) {
      rawData.computedFiltered = computedPayload;
    } else {
      rawData.computedAll = computedPayload;
    }
  }

  return {
    ...computedPayload,
    study,
    studies,
    captionsById: new Map(computedPayload.captionsById),
  };
}

async function loadUncachedFlavorTrajectoriesBatch(
  supabase: SupabaseClient<Database>,
  studies: readonly StudySummaryRow[],
  missingFlavorIds: readonly number[],
): Promise<Map<number, readonly FlavorCrossStudyPoint[]>> {
  const targetSet = new Set(missingFlavorIds);
  const [allMappings, flavors] = await Promise.all([
    fetchAllStudyMappings(supabase),
    fetchAllRows<RawFlavorRow>({
      contextLabel: "humor flavors",
      runQuery: (from, to) =>
        supabase
          .from("humor_flavors")
          .select("id, slug, description")
          .order("id", { ascending: true })
          .range(from, to) as PromiseLike<SupabaseListResult<RawFlavorRow>>,
    }),
  ]);

  const distinctMappedCaptionIds = Array.from(
    new Set(allMappings.map((m) => m.caption_id)),
  );
  const mappedCaptions = await fetchRowsByIdChunks<
    string,
    RawCaptionFlavorOnlyRow
  >({
    ids: distinctMappedCaptionIds,
    contextLabel: "trajectory mapped captions",
    runQuery: (chunk, from, to) =>
      supabase
        .from("captions")
        .select("id, humor_flavor_id, metadata")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to) as PromiseLike<
        SupabaseListResult<RawCaptionFlavorOnlyRow>
      >,
  });

  const { flavorsById, flavorsBySlugLower } = buildFlavorLookupMaps(flavors);
  const targetFlavorByCaptionId = new Map<string, number>();
  for (const caption of mappedCaptions) {
    const { flavor } = resolveEffectiveCaptionFlavor(
      caption,
      flavorsById,
      flavorsBySlugLower,
    );
    if (flavor && targetSet.has(flavor.id)) {
      targetFlavorByCaptionId.set(caption.id, flavor.id);
    }
  }

  const allMappingIdsByStudy = new Map<number, number[]>();
  type StudyFlavorGroup = {
    mappingIds: number[];
    captionIds: Set<string>;
  };
  const flavorGroupsByStudy = new Map<
    number,
    Map<number, StudyFlavorGroup>
  >();

  for (const mapping of allMappings) {
    let allList = allMappingIdsByStudy.get(mapping.study_id);
    if (!allList) {
      allList = [];
      allMappingIdsByStudy.set(mapping.study_id, allList);
    }
    allList.push(mapping.id);

    const flavorId = targetFlavorByCaptionId.get(mapping.caption_id);
    if (flavorId === undefined) {
      continue;
    }

    let studyMap = flavorGroupsByStudy.get(mapping.study_id);
    if (!studyMap) {
      studyMap = new Map<number, StudyFlavorGroup>();
      flavorGroupsByStudy.set(mapping.study_id, studyMap);
    }
    let group = studyMap.get(flavorId);
    if (!group) {
      group = { mappingIds: [], captionIds: new Set<string>() };
      studyMap.set(flavorId, group);
    }
    group.mappingIds.push(mapping.id);
    group.captionIds.add(mapping.caption_id);
  }

  const studiesById = new Map(studies.map((s) => [s.id, s]));
  const candidateStudyIds = Array.from(flavorGroupsByStudy.keys()).sort(
    (a, b) => a - b,
  );

  const perStudyPoints = await mapWithConcurrency(
    candidateStudyIds,
    TRAJECTORY_STUDY_CONCURRENCY,
    async (
      candidateStudyId,
    ): Promise<Array<{ flavorId: number; point: FlavorCrossStudyPoint }>> => {
      const study = studiesById.get(candidateStudyId);
      const studyFlavorMap = flavorGroupsByStudy.get(candidateStudyId);
      if (!study || !studyFlavorMap) {
        return [];
      }

      const studyAllMappings = allMappingIdsByStudy.get(candidateStudyId) ?? [];
      let hasNavigationEvents = false;
      let hasVoteEvents = false;
      if (candidateStudyId >= NEW_STYLE_MIN_STUDY_ID && studyAllMappings.length > 0) {
        hasNavigationEvents = await probeTableHasRowForMappings(
          supabase,
          "study_caption_navigation_events",
          studyAllMappings,
        );
        if (!hasNavigationEvents) {
          hasVoteEvents = await probeTableHasRowForMappings(
            supabase,
            "study_caption_vote_events",
            studyAllMappings,
          );
        }
      }

      const resolved = resolveStudyExposureMode({
        studyId: candidateStudyId,
        hasNavigationEvents,
        hasVoteEvents,
      });

      if (resolved.mode === "likert_votes") {
        // HEAD exact-count fast path: transfers zero row payloads even across
        // studies with 55k+ votes per study / 222k+ cross-study vote rows.
        return mapWithConcurrency(
          Array.from(studyFlavorMap.entries()),
          ERA_PROBE_CONCURRENCY,
          async ([flavorId, group]) => {
            const [exposures, positive] = await Promise.all([
              sumExactCountsByIdChunks({
                ids: group.mappingIds,
                contextLabel: `trajectory exposures study ${candidateStudyId}`,
                runQuery: (chunk) =>
                  supabase
                    .from("study_caption_vote_events")
                    .select("id", { count: "exact", head: true })
                    .in("study_caption_mapping_id", chunk),
              }),
              sumExactCountsByIdChunks({
                ids: group.mappingIds,
                contextLabel: `trajectory positive study ${candidateStudyId}`,
                runQuery: (chunk) =>
                  supabase
                    .from("study_caption_vote_events")
                    .select("id", { count: "exact", head: true })
                    .in("study_caption_mapping_id", chunk)
                    .in("vote_value", ["funny", "very funny"]),
              }),
            ]);
            const ci = computeWilsonConfidenceInterval(positive, exposures);
            return {
              flavorId,
              point: {
                studyId: candidateStudyId,
                studySlug: study.slug,
                studyLabel: getStudyDisplayLabel(study),
                exposureMode: resolved.mode,
                formatLabel: "Likert" as const,
                captionCount: group.captionIds.size,
                exposures,
                positive,
                rate: ci.rate,
                ciLow: ci.low,
                ciHigh: ci.high,
              },
            };
          },
        );
      }

      // Swipe navigation mode: match same-session (profile_id, mapping_id, session_id) pairs.
      const unionMappingIds: number[] = [];
      const flavorIdByMappingId = new Map<number, number>();
      for (const [flavorId, group] of studyFlavorMap.entries()) {
        for (const mId of group.mappingIds) {
          unionMappingIds.push(mId);
          flavorIdByMappingId.set(mId, flavorId);
        }
      }

      type MinSwipeRow = {
        profile_id: string;
        study_caption_mapping_id: number | null;
        session_id: string | null;
      };

      const [navRows, voteRows] = await Promise.all([
        fetchChunkedRowsConcurrently<number, MinSwipeRow>({
          ids: unionMappingIds,
          contextLabel: `trajectory swipe navs study ${candidateStudyId}`,
          runCountQuery: (chunk) =>
            supabase
              .from("study_caption_navigation_events")
              .select("id", { count: "exact", head: true })
              .in("study_caption_mapping_id", chunk),
          runPageQuery: (chunk, from, to) =>
            supabase
              .from("study_caption_navigation_events")
              .select("profile_id, study_caption_mapping_id, session_id")
              .in("study_caption_mapping_id", chunk)
              .order("id", { ascending: true })
              .range(from, to) as PromiseLike<SupabaseListResult<MinSwipeRow>>,
        }),
        fetchChunkedRowsConcurrently<number, MinSwipeRow>({
          ids: unionMappingIds,
          contextLabel: `trajectory swipe votes study ${candidateStudyId}`,
          runCountQuery: (chunk) =>
            supabase
              .from("study_caption_vote_events")
              .select("id", { count: "exact", head: true })
              .in("study_caption_mapping_id", chunk),
          runPageQuery: (chunk, from, to) =>
            supabase
              .from("study_caption_vote_events")
              .select("profile_id, study_caption_mapping_id, session_id")
              .in("study_caption_mapping_id", chunk)
              .order("id", { ascending: true })
              .range(from, to) as PromiseLike<SupabaseListResult<MinSwipeRow>>,
        }),
      ]);

      const likeKeys = new Set<string>();
      for (const vote of voteRows) {
        if (vote.study_caption_mapping_id !== null) {
          likeKeys.add(
            getSwipeEventMatchKey({
              profile_id: vote.profile_id,
              study_caption_mapping_id: vote.study_caption_mapping_id,
              session_id: vote.session_id,
            }),
          );
        }
      }

      const seenPairs = new Map<string, { flavorId: number; liked: boolean }>();
      for (const nav of navRows) {
        if (nav.study_caption_mapping_id === null) {
          continue;
        }
        const flavorId = flavorIdByMappingId.get(nav.study_caption_mapping_id);
        if (flavorId === undefined) {
          continue;
        }
        const pairKey = `${nav.profile_id}|${nav.study_caption_mapping_id}`;
        const matched = likeKeys.has(
          getSwipeEventMatchKey({
            profile_id: nav.profile_id,
            study_caption_mapping_id: nav.study_caption_mapping_id,
            session_id: nav.session_id,
          }),
        );
        const existing = seenPairs.get(pairKey);
        if (!existing) {
          seenPairs.set(pairKey, { flavorId, liked: matched });
        } else if (matched) {
          existing.liked = true;
        }
      }

      const tallies = new Map<number, { exposures: number; positive: number }>();
      for (const { flavorId, liked } of seenPairs.values()) {
        let cur = tallies.get(flavorId);
        if (!cur) {
          cur = { exposures: 0, positive: 0 };
          tallies.set(flavorId, cur);
        }
        cur.exposures += 1;
        if (liked) {
          cur.positive += 1;
        }
      }

      const out: Array<{ flavorId: number; point: FlavorCrossStudyPoint }> = [];
      for (const [flavorId, group] of studyFlavorMap.entries()) {
        const tally = tallies.get(flavorId) ?? { exposures: 0, positive: 0 };
        const ci = computeWilsonConfidenceInterval(
          tally.positive,
          tally.exposures,
        );
        out.push({
          flavorId,
          point: {
            studyId: candidateStudyId,
            studySlug: study.slug,
            studyLabel: getStudyDisplayLabel(study),
            exposureMode: resolved.mode,
            formatLabel: "Swipe",
            captionCount: group.captionIds.size,
            exposures: tally.exposures,
            positive: tally.positive,
            rate: ci.rate,
            ciLow: ci.low,
            ciHigh: ci.high,
          },
        });
      }
      return out;
    },
  );

  const fetchedByFlavor = new Map<number, FlavorCrossStudyPoint[]>();
  for (const flavorId of missingFlavorIds) {
    fetchedByFlavor.set(flavorId, []);
  }
  for (const entries of perStudyPoints) {
    for (const { flavorId, point } of entries) {
      fetchedByFlavor.get(flavorId)?.push(point);
    }
  }
  const outMap = new Map<number, readonly FlavorCrossStudyPoint[]>();
  for (const flavorId of missingFlavorIds) {
    const sorted = (fetchedByFlavor.get(flavorId) ?? []).sort(
      (a, b) => a.studyId - b.studyId,
    );
    outMap.set(flavorId, sorted);
  }
  return outMap;
}

export async function fetchFlavorCrossStudyTrajectoriesWithClient(
  supabase: SupabaseClient<Database>,
  flavorIds: readonly number[],
  options?: { nowMs?: number },
): Promise<Record<number, FlavorCrossStudyPoint[]>> {
  const targetFlavorIds = Array.from(
    new Set(flavorIds.filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (targetFlavorIds.length === 0) {
    return {};
  }
  const nowMs = options?.nowMs ?? Date.now();

  const [cacheNamespace, studies] = await Promise.all([
    resolveVerifiedSuperadminCacheNamespace(supabase),
    fetchStudiesList(supabase),
  ]);
  const visibleStudyIdSet = new Set(studies.map((study) => study.id));

  const rawByFlavorId =
    cacheNamespace !== null
      ? await flavorTrajectoryCache.resolveManyWithSwr<number>({
          namespace: cacheNamespace,
          keys: targetFlavorIds,
          nowMs,
          resolveCompletedAtMs: () => options?.nowMs ?? Date.now(),
          batchLoader: (batchIds) =>
            loadUncachedFlavorTrajectoriesBatch(supabase, studies, batchIds),
        })
      : await loadUncachedFlavorTrajectoriesBatch(
          supabase,
          studies,
          targetFlavorIds,
        );

  const trajectories: Record<number, FlavorCrossStudyPoint[]> = {};
  for (const flavorId of targetFlavorIds) {
    const points = rawByFlavorId.get(flavorId) ?? [];
    trajectories[flavorId] = points.filter((point) =>
      visibleStudyIdSet.has(point.studyId),
    );
  }

  return trajectories;
}

export const getCachedTopNavbarMetadata = cache(
  async (): Promise<TopNavbarMetadata> => {
    const supabase = await createClient();
    return fetchTopNavbarMetadataWithClient(supabase);
  },
);

export const getCachedExecutiveHubDataset = cache(
  async (): Promise<ExecutiveHubDataset> => {
    const supabase = await createClient();
    return fetchExecutiveHubDatasetWithClient(supabase);
  },
);

export const getCachedStudyAttributionBundle = cache(
  async (
    studyId: number,
    excludeHighRisk = false,
  ): Promise<StudyAttributionBundle | null> => {
    const supabase = await createClient();
    return fetchStudyAttributionBundleWithClient(supabase, studyId, {
      excludeHighRisk,
    });
  },
);

const getCachedFlavorCrossStudyTrajectoriesByKey = cache(
  async (
    flavorIdsKey: string,
  ): Promise<Record<number, FlavorCrossStudyPoint[]>> => {
    const flavorIds = flavorIdsKey
      .split(",")
      .map((part) => Number.parseInt(part, 10))
      .filter((id) => Number.isInteger(id) && id > 0);
    const supabase = await createClient();
    return fetchFlavorCrossStudyTrajectoriesWithClient(supabase, flavorIds);
  },
);

export const getCachedFlavorCrossStudyTrajectories = (
  flavorIds: readonly number[],
): Promise<Record<number, FlavorCrossStudyPoint[]>> => {
  const normalizedKey = Array.from(
    new Set(flavorIds.filter((id) => Number.isInteger(id) && id > 0)),
  )
    .sort((a, b) => a - b)
    .join(",");
  return getCachedFlavorCrossStudyTrajectoriesByKey(normalizedKey);
};
