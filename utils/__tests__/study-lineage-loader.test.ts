import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/supabase";
import {
  assembleCaptionLineageMap,
  buildFlavorLookupMaps,
  clearStudyLineageCaches,
  fetchChunkedRowsConcurrently,
  fetchExecutiveHubDatasetWithClient,
  fetchFlavorCrossStudyTrajectoriesWithClient,
  fetchStudyAttributionBundleWithClient,
  fetchStudySearchResultsWithClient,
  fetchTopNavbarMetadataWithClient,
  getStudyDisplayLabel,
  getStudyLifecycleStatus,
  getStudyTitle,
  resolveEffectiveCaptionFlavor,
  STUDY_CACHE_MAX_ENTRIES,
  STUDY_CACHE_MAX_STALE_MS,
  STUDY_CACHE_TTL_MS,
  TRAJECTORY_CACHE_MAX_ENTRIES,
} from "@/utils/study-lineage-loader";

type TableStore = Record<string, Array<Record<string, unknown>>>;

type FakeClientOptions = {
  supabaseUrl?: string;
  authUserId?: string | null;
  authError?: string | null;
  authThrows?: boolean;
};

function createFakeSupabaseClient(
  store: TableStore,
  counters?: { headCalls: number; rowCalls: number },
  options?: FakeClientOptions,
): SupabaseClient<Database> {
  const client: Record<string, unknown> = {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const orders: Array<{ col: string; ascending: boolean }> = [];
      let limitVal: number | null = null;
      let rangeVal: { from: number; to: number } | null = null;
      let headCountMode = false;

      const execute = async () => {
        let rows = [...(store[table] ?? [])];
        for (const predicate of filters) {
          rows = rows.filter(predicate);
        }

        if (headCountMode) {
          if (counters) counters.headCalls += 1;
          return { data: null, count: rows.length, error: null };
        }

        if (counters) counters.rowCalls += 1;
        if (orders.length > 0) {
          rows.sort((a, b) => {
            for (const { col, ascending } of orders) {
              const av = a[col] as string | number | null;
              const bv = b[col] as string | number | null;
              if (av === bv) continue;
              if (av === null || av === undefined) return ascending ? 1 : -1;
              if (bv === null || bv === undefined) return ascending ? -1 : 1;
              if (av < bv) return ascending ? -1 : 1;
              if (av > bv) return ascending ? 1 : -1;
            }
            return 0;
          });
        }

        if (rangeVal !== null) {
          rows = rows.slice(rangeVal.from, rangeVal.to + 1);
        }
        if (limitVal !== null) {
          rows = rows.slice(0, limitVal);
        }
        return { data: rows, error: null };
      };

      const builder = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head && opts.count === "exact") {
            headCountMode = true;
          }
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push((row) => row[col] === val);
          return builder;
        },
        in(col: string, vals: readonly unknown[]) {
          const set = new Set(vals);
          filters.push((row) => set.has(row[col]));
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orders.push({ col, ascending: opts?.ascending !== false });
          return builder;
        },
        limit(n: number) {
          limitVal = n;
          return builder;
        },
        range(from: number, to: number) {
          rangeVal = { from, to };
          return builder;
        },
        async maybeSingle() {
          const result = await execute();
          return {
            data: result.data ? (result.data[0] ?? null) : null,
            error: result.error,
          };
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: Awaited<ReturnType<typeof execute>>) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return execute().then(onfulfilled, onrejected);
        },
      };

      return builder;
    },
  };

  if (options?.supabaseUrl !== undefined) {
    client.supabaseUrl = options.supabaseUrl;
  }
  if (
    options?.authUserId !== undefined ||
    options?.authError !== undefined ||
    options?.authThrows
  ) {
    client.auth = {
      async getUser() {
        if (options.authThrows) {
          throw new Error("auth socket disconnect");
        }
        if (options.authError) {
          return { data: { user: null }, error: { message: options.authError } };
        }
        return {
          data: {
            user: options.authUserId ? { id: options.authUserId } : null,
          },
          error: null,
        };
      },
    };
  }

  return client as unknown as SupabaseClient<Database>;
}

const buildFixtureStore = (): TableStore => ({
  studies: [
    // Study 8: transitional Likert (id >= 7, 0 navs, >0 votes)
    {
      id: 8,
      slug: "2026-02-20",
      description: "Likert transitional run",
      start_datetime_utc: "2026-02-20T00:00:00+00:00",
      end_datetime_utc: "2026-02-25T00:00:00+00:00",
      created_datetime_utc: "2026-02-20T00:00:00+00:00",
      is_hidden: false,
      is_private: false,
    },
    // Study 122: active swipe study with metadata.flavor_name captions + participations
    {
      id: 122,
      slug: "10-10-sad-girl",
      description: null,
      start_datetime_utc: "2026-10-10T00:00:00+00:00",
      end_datetime_utc: "2026-12-31T00:00:00+00:00",
      created_datetime_utc: "2026-10-10T00:00:00+00:00",
      is_hidden: false,
      is_private: false,
    },
    // Study 130: scheduled empty study
    {
      id: 130,
      slug: null,
      description: "Upcoming winter evaluation",
      start_datetime_utc: "2027-01-15T00:00:00+00:00",
      end_datetime_utc: "2027-01-20T00:00:00+00:00",
      created_datetime_utc: "2026-10-15T00:00:00+00:00",
      is_hidden: false,
      is_private: true,
    },
  ],
  humor_flavors: [
    { id: 115, slug: "lifecycle-ter-re-lyn-test-lydia", description: "Lifecycle chain" },
    { id: 177, slug: "multi-person-scene-SAD-GIRL-4", description: "Sad girl scene" },
    { id: 199, slug: "unused-draft-flavor", description: "Never tested" },
  ],
  humor_flavor_steps: [
    // Flavor 115 currently configures step 2 as model 1 (GPT-4.1), whereas Study 8's
    // recorded llm_model_responses chain executed step 2 on model 5 (GPT-4o)!
    { id: 1, humor_flavor_id: 115, order_by: 1, llm_model_id: 14 },
    { id: 2, humor_flavor_id: 115, order_by: 2, llm_model_id: 1 },
    { id: 3, humor_flavor_id: 177, order_by: 1, llm_model_id: 14 },
    { id: 4, humor_flavor_id: 177, order_by: 2, llm_model_id: 15 },
  ],
  llm_models: [
    { id: 1, name: "GPT-4.1", provider_model_id: "gpt-4.1", llm_provider_id: 1 },
    { id: 5, name: "GPT-4o", provider_model_id: "gpt-4o", llm_provider_id: 1 },
    { id: 14, name: "Gemini 2.5 Flash", provider_model_id: "gemini-2.5-flash", llm_provider_id: 2 },
    { id: 15, name: "Gemini 2.5 Pro", provider_model_id: "gemini-2.5-pro", llm_provider_id: 2 },
  ],
  llm_providers: [
    { id: 1, name: "OpenAI" },
    { id: 2, name: "Google" },
  ],
  images: [
    { id: "img-1", url: "https://example.org/1.jpg", image_description: "Library goat" },
  ],
  captions: [
    // FK-attributed caption in Study 8
    {
      id: "cap-fk",
      content: "Goat glazing Butler",
      image_id: "img-1",
      humor_flavor_id: 115,
      llm_prompt_chain_id: 500,
      caption_request_id: 900,
      metadata: null,
    },
    // Metadata-attributed caption in Study 122 (humor_flavor_id is null!)
    {
      id: "cap-meta",
      content: "Sad girl at midterm",
      image_id: "img-1",
      humor_flavor_id: null,
      llm_prompt_chain_id: null,
      caption_request_id: null,
      metadata: { flavor_id: 1546, flavor_name: "multi-person-scene-sad-girl-4" },
    },
    // Also map flavor 115 via metadata in Study 122 on same image for head-to-head
    {
      id: "cap-meta-2",
      content: "Lifecycle punchline",
      image_id: "img-1",
      humor_flavor_id: null,
      llm_prompt_chain_id: null,
      caption_request_id: null,
      metadata: { flavor_name: "lifecycle-ter-re-lyn-test-lydia" },
    },
    // Unattributed caption in Study 122
    {
      id: "cap-manual",
      content: "Manual control caption",
      image_id: null,
      humor_flavor_id: null,
      llm_prompt_chain_id: null,
      caption_request_id: null,
      metadata: ["unexpected-array"],
    },
  ],
  llm_model_responses: [
    // Inserted intentionally out-of-order to test order_by sorting
    {
      id: "r2",
      llm_prompt_chain_id: 500,
      caption_request_id: 900,
      humor_flavor_id: 115,
      humor_flavor_step_id: 2,
      llm_model_id: 5,
      processing_time_seconds: 3.2,
      created_datetime_utc: "2026-02-20T00:00:05+00:00",
    },
    {
      id: "r1",
      llm_prompt_chain_id: 500,
      caption_request_id: 900,
      humor_flavor_id: 115,
      humor_flavor_step_id: 1,
      llm_model_id: 14,
      processing_time_seconds: 1.8,
      created_datetime_utc: "2026-02-20T00:00:02+00:00",
    },
  ],
  study_caption_mappings: [
    { id: 10, study_id: 8, caption_id: "cap-fk" },
    { id: 20, study_id: 122, caption_id: "cap-meta" },
    { id: 21, study_id: 122, caption_id: "cap-meta-2" },
    { id: 22, study_id: 122, caption_id: "cap-manual" },
  ],
  study_participations: [
    {
      profile_id: "u1",
      study_id: 122,
      started_at: "2026-10-10T10:00:00+00:00",
      ended_at: "2026-10-10T10:04:00+00:00",
      completion_stats: null,
    },
    {
      profile_id: "u2",
      study_id: 122,
      started_at: "2026-10-10T11:00:00+00:00",
      ended_at: null,
      completion_stats: null,
    },
  ],
  study_caption_navigation_events: [
    {
      id: 1,
      profile_id: "u1",
      caption_id: "cap-meta",
      study_caption_mapping_id: 20,
      time_to_next_caption_ms: 2500,
      session_id: "s1",
      created_datetime_utc: "2026-10-10T10:00:05+00:00",
    },
    {
      id: 2,
      profile_id: "u1",
      caption_id: "cap-meta-2",
      study_caption_mapping_id: 21,
      time_to_next_caption_ms: 3000,
      session_id: "s1",
      created_datetime_utc: "2026-10-10T10:00:10+00:00",
    },
    {
      id: 3,
      profile_id: "u2",
      caption_id: "cap-manual",
      study_caption_mapping_id: 22,
      time_to_next_caption_ms: 2000,
      session_id: "s2",
      created_datetime_utc: "2026-10-10T11:00:05+00:00",
    },
  ],
  study_caption_vote_events: [
    // Study 8 Likert votes (2 positive out of 3)
    {
      id: 101,
      profile_id: "u1",
      caption_id: "cap-fk",
      study_caption_mapping_id: 10,
      vote_value: "funny",
      time_to_vote_ms: null,
      session_id: null,
      created_datetime_utc: "2026-02-20T01:00:00+00:00",
    },
    {
      id: 102,
      profile_id: "u2",
      caption_id: "cap-fk",
      study_caption_mapping_id: 10,
      vote_value: "very funny",
      time_to_vote_ms: null,
      session_id: null,
      created_datetime_utc: "2026-02-20T01:01:00+00:00",
    },
    {
      id: 103,
      profile_id: "u3",
      caption_id: "cap-fk",
      study_caption_mapping_id: 10,
      vote_value: "meh",
      time_to_vote_ms: null,
      session_id: null,
      created_datetime_utc: "2026-02-20T01:02:00+00:00",
    },
    // Study 122 Swipe like on cap-meta (mapping 20)
    {
      id: 201,
      profile_id: "u1",
      caption_id: "cap-meta",
      study_caption_mapping_id: 20,
      vote_value: "funny",
      time_to_vote_ms: 1200,
      session_id: "s1",
      created_datetime_utc: "2026-10-10T10:00:06+00:00",
    },
  ],
  demographic_questions: [{ id: 1, question: "Graduation year?" }],
  demographic_answers: [{ id: 10, answer: "2027" }],
  demographic_answer_question_mapping: [
    { id: 100, question_id: 1, answer_id: 10, display_order: 1, is_deleted: false },
  ],
  demographic_user_responses: [
    {
      id: 1,
      user_id: "u1",
      answer_question_mapping_id: 100,
      created_datetime_utc: "2026-10-01T00:00:00+00:00",
      modified_datetime_utc: null,
    },
  ],
});

describe("utils/study-lineage-loader", () => {
  it("formats study labels and lifecycle statuses across time windows", () => {
    const fixedNow = Date.parse("2026-10-30T00:00:00Z");
    assert.equal(
      getStudyTitle({ id: 5, slug: "2026-02-09", description: "Desc" }),
      "2026-02-09",
    );
    assert.equal(
      getStudyTitle({ id: 5, slug: null, description: "Fallback desc" }),
      "Fallback desc",
    );
    assert.equal(
      getStudyDisplayLabel({ id: 5, slug: null, description: null }),
      "Study 5",
    );

    assert.equal(
      getStudyLifecycleStatus(
        {
          start_datetime_utc: "2027-01-01T00:00:00+00:00",
          end_datetime_utc: "2027-01-10T00:00:00+00:00",
        },
        fixedNow,
      ),
      "scheduled",
    );
    assert.equal(
      getStudyLifecycleStatus(
        {
          start_datetime_utc: "2026-10-01T00:00:00+00:00",
          end_datetime_utc: "2026-12-01T00:00:00+00:00",
        },
        fixedNow,
      ),
      "active",
    );
    assert.equal(
      getStudyLifecycleStatus(
        { start_datetime_utc: null, end_datetime_utc: null },
        fixedNow,
      ),
      "closed",
    );
  });

  it("assembles both direct FK chains and metadata.flavor_name fallbacks with strictly null chainLatencySeconds", () => {
    const store = buildFixtureStore();
    const { flavorsById, flavorsBySlugLower } = buildFlavorLookupMaps(
      store.humor_flavors as never,
    );

    // Case-insensitive metadata.flavor_name match
    const resolved = resolveEffectiveCaptionFlavor(
      {
        humor_flavor_id: null,
        metadata: { flavor_name: "MULTI-PERSON-SCENE-sad-girl-4" },
      },
      flavorsById,
      flavorsBySlugLower,
    );
    assert.equal(resolved.source, "metadata_flavor_name");
    assert.equal(resolved.flavor?.id, 177);

    const assembled = assembleCaptionLineageMap({
      captions: store.captions as never,
      imagesById: new Map([["img-1", store.images[0] as never]]),
      flavors: store.humor_flavors as never,
      flavorSteps: store.humor_flavor_steps as never,
      models: store.llm_models as never,
      providers: store.llm_providers as never,
      llmResponses: store.llm_model_responses as never,
    });

    assert.equal(assembled.metadataAttributedCaptionCount, 2);
    assert.equal(assembled.unattributedCaptionCount, 1);

    const fkCap = assembled.captionsById.get("cap-fk");
    assert.equal(fkCap?.attributionSource, "direct_fk");
    assert.equal(fkCap?.terminalModelName, "GPT-4o");
    assert.equal(fkCap?.pipelineSignature, "Gemini 2.5 Flash → GPT-4o");
    assert.equal(fkCap?.chainLatencySeconds, 5); // 1.8 + 3.2

    const metaCap = assembled.captionsById.get("cap-meta");
    assert.equal(metaCap?.attributionSource, "metadata_flavor_name");
    assert.equal(metaCap?.flavorSlug, "multi-person-scene-SAD-GIRL-4");
    assert.equal(metaCap?.flavorStepCount, 2);
    assert.equal(metaCap?.terminalModelName, "Gemini 2.5 Pro");
    assert.equal(
      metaCap?.pipelineSignature,
      "Gemini 2.5 Flash → Gemini 2.5 Pro",
    );
    assert.equal(metaCap?.chainLatencySeconds, null);
  });

  it("loads Hub, Navbar, Search, single-study bundle, and HEAD-optimized cross-study trajectories", async () => {
    const store = buildFixtureStore();
    const counters = { headCalls: 0, rowCalls: 0 };
    const supabase = createFakeSupabaseClient(store, counters);
    const fixedNow = Date.parse("2026-10-30T12:00:00Z");

    const navMeta = await fetchTopNavbarMetadataWithClient(supabase, fixedNow);
    assert.equal(navMeta.hasActiveStudy, true);
    assert.equal(navMeta.recentStudies.length, 3);
    assert.equal(navMeta.recentStudies[0].studyId, 130);

    const hub = await fetchExecutiveHubDatasetWithClient(supabase, fixedNow);
    assert.equal(hub.kpis.totalStudies, 3);
    assert.equal(hub.kpis.activeStudies, 1); // Study 122
    assert.equal(hub.kpis.likertStudies, 1); // Study 8 transitional Likert!
    assert.equal(hub.kpis.swipeStudies, 2); // Study 122 + empty Study 130
    assert.equal(hub.kpis.testedFlavorCount, 2); // 115 + 177 (both FK + metadata!)
    assert.equal(hub.kpis.testedModelCount, 4); // 5 + 14 from Study 8 chain, 1 + 15 from Study 122 metadata steps
    assert.equal(hub.kpis.surveyedProfileCount, 1);

    const study8Entry = hub.studies.find((s) => s.id === 8);
    assert.equal(study8Entry?.formatLabel, "Likert");
    assert.equal(study8Entry?.detailHref, "/study/8/study-detail");

    // Empty search returns recent studies + global reports without scanning flavor/model/participation tables
    const rowsBeforeEmptySearch = counters.rowCalls;
    const emptySearch = await fetchStudySearchResultsWithClient(
      supabase,
      "",
      fixedNow,
    );
    assert.equal(emptySearch.studies.length, 3);
    assert.equal(emptySearch.reports.length, 3);
    assert.ok(
      counters.rowCalls - rowsBeforeEmptySearch <= 6,
      `empty search should short-circuit dictionary fetches (ran ${counters.rowCalls - rowsBeforeEmptySearch} row queries)`,
    );

    // Non-empty search finds metadata-attributed flavor and untested flavor safely
    const flavorSearch = await fetchStudySearchResultsWithClient(
      supabase,
      "girl",
      fixedNow,
    );
    assert.equal(flavorSearch.flavors[0]?.id, 177);
    assert.equal(
      flavorSearch.flavors[0]?.href,
      "/study/122/attribution?flavor=177",
    );

    // Search attributes Study 8 to executed chain model GPT-4o (5), NOT flavor 115's later step GPT-4.1 (1),
    // while attributing Study 122's metadata-imported caption to GPT-4.1 (1) via step fallback!
    const modelSearch = await fetchStudySearchResultsWithClient(
      supabase,
      "gpt",
      fixedNow,
    );
    const gpt4o = modelSearch.models.find((m) => m.id === 5);
    const gpt41 = modelSearch.models.find((m) => m.id === 1);
    assert.equal(gpt4o?.studyCount, 1);
    assert.equal(gpt4o?.latestStudyId, 8);
    assert.equal(gpt41?.studyCount, 1);
    assert.equal(gpt41?.latestStudyId, 122);

    const draftSearch = await fetchStudySearchResultsWithClient(
      supabase,
      "unused-draft",
      fixedNow,
    );
    assert.equal(draftSearch.flavors[0]?.href, null);

    // Exact study ID ranks ahead of higher prefix-matching study IDs before slicing to 6
    const manyPrefixedStore = {
      ...store,
      studies: [
        ...Array.from({ length: 8 }, (_, idx) => ({
          id: 89 - idx,
          slug: `study-${89 - idx}`,
          description: null,
          start_datetime_utc: "2026-09-01T00:00:00+00:00",
          end_datetime_utc: "2026-09-02T00:00:00+00:00",
          created_datetime_utc: "2026-09-01T00:00:00+00:00",
          is_hidden: false,
          is_private: false,
        })),
        ...store.studies,
      ],
    };
    const exactIdSearch = await fetchStudySearchResultsWithClient(
      createFakeSupabaseClient(manyPrefixedStore),
      "#8",
      fixedNow,
    );
    assert.equal(exactIdSearch.studies[0]?.id, 8);

    // Invalid or unknown study IDs return null
    assert.equal(await fetchStudyAttributionBundleWithClient(supabase, -1), null);
    assert.equal(await fetchStudyAttributionBundleWithClient(supabase, 999), null);

    // Study 122 bundle reconciles swipe + metadata lineage + head-to-head
    const bundle122 = await fetchStudyAttributionBundleWithClient(supabase, 122);
    assert.ok(bundle122);
    assert.equal(bundle122.metadataAttributedCaptionCount, 2);
    assert.equal(bundle122.unattributedCaptionCount, 1);
    assert.equal(bundle122.exposureBundle.totalExposures, 3);
    assert.equal(bundle122.exposureBundle.totalPositive, 1);
    assert.equal(bundle122.headToHead.evaluatedSharedImageCount, 1);

    // Cross-study trajectory for flavor 115 hits BOTH Study 8 (via HEAD exact count!) AND Study 122 (via metadata fallback!)
    const headBefore = counters.headCalls;
    const trajectories = await fetchFlavorCrossStudyTrajectoriesWithClient(
      supabase,
      [115, 177],
    );
    assert.ok(
      counters.headCalls >= headBefore + 2,
      "Likert cross-study trajectory must use HEAD exact counts",
    );
    assert.deepEqual(
      trajectories[115].map((p) => ({
        studyId: p.studyId,
        mode: p.exposureMode,
        exposures: p.exposures,
        positive: p.positive,
      })),
      [
        { studyId: 8, mode: "likert_votes", exposures: 3, positive: 2 },
        { studyId: 122, mode: "swipe_navigation", exposures: 1, positive: 0 },
      ],
    );
    assert.deepEqual(
      trajectories[177].map((p) => ({
        studyId: p.studyId,
        exposures: p.exposures,
        positive: p.positive,
      })),
      [{ studyId: 122, exposures: 1, positive: 1 }],
    );
  });

  it("enforces live auth.getUser() + isSuperadminProfile before shared cache read/write (Gap G5) plus TTL & LRU eviction", async () => {
    clearStudyLineageCaches();
    assert.equal(STUDY_CACHE_TTL_MS, 15 * 60_000);
    assert.equal(STUDY_CACHE_MAX_STALE_MS, 12 * 60 * 60_000);
    const sharedUrl = "https://shared-prod.example.org/";
    const adminStore: TableStore = {
      ...buildFixtureStore(),
      profiles: [{ id: "admin-1", is_superadmin: true }],
    };
    // Simulate production Supabase RLS for a regular participant on the exact
    // same supabaseUrl: studies are readable (no RLS on public.studies), while
    // participations, navigation events, vote events, and demographic responses
    // return 0 rows under caller RLS.
    const rlsFilteredStore: TableStore = {
      ...buildFixtureStore(),
      profiles: [{ id: "student-9", is_superadmin: false }],
      study_participations: [],
      study_caption_navigation_events: [],
      study_caption_vote_events: [],
      demographic_user_responses: [],
    };

    const adminCounters = { headCalls: 0, rowCalls: 0 };
    const adminClient = createFakeSupabaseClient(adminStore, adminCounters, {
      supabaseUrl: sharedUrl,
      authUserId: "admin-1",
    });
    const studentCounters = { headCalls: 0, rowCalls: 0 };
    const studentClient = createFakeSupabaseClient(
      rlsFilteredStore,
      studentCounters,
      {
        supabaseUrl: sharedUrl,
        authUserId: "student-9",
      },
    );
    const anonErrorClient = createFakeSupabaseClient(rlsFilteredStore, undefined, {
      supabaseUrl: sharedUrl,
      authError: "jwt expired",
    });
    const throwingAuthClient = createFakeSupabaseClient(
      rlsFilteredStore,
      undefined,
      {
        supabaseUrl: sharedUrl,
        authThrows: true,
      },
    );
    const blankUrlClient = createFakeSupabaseClient(rlsFilteredStore, undefined, {
      supabaseUrl: "   ",
      authUserId: "admin-1",
    });

    const t0 = 1_700_000_000_000;

    // 1. Cold-cache poisoning prevention: non-superadmin, errored, throwing, and
    // blank-URL callers hit the cold cache first and MUST NOT write partial 0-row
    // results into the shared supabaseUrl namespace.
    const studentColdBundle = await fetchStudyAttributionBundleWithClient(
      studentClient,
      122,
      { nowMs: t0 },
    );
    assert.equal(studentColdBundle?.exposureBundle.totalExposures, 0);
    assert.equal(studentColdBundle?.participationFunnel.participationsStarted, 0);

    const studentColdTraj = await fetchFlavorCrossStudyTrajectoriesWithClient(
      studentClient,
      [115, 177],
      { nowMs: t0 },
    );
    assert.equal(studentColdTraj[115]?.[0]?.exposures, 0);
    assert.equal(studentColdTraj[177]?.[0]?.exposures, 0);

    const studentColdNav = await fetchTopNavbarMetadataWithClient(
      studentClient,
      t0,
    );
    assert.equal(studentColdNav.recentStudies[1]?.participationsStarted, 0);
    await fetchStudySearchResultsWithClient(studentClient, "", t0);

    await fetchStudyAttributionBundleWithClient(anonErrorClient, 122, {
      nowMs: t0,
    });
    await fetchStudyAttributionBundleWithClient(throwingAuthClient, 122, {
      nowMs: t0,
    });
    await fetchStudyAttributionBundleWithClient(blankUrlClient, 122, {
      nowMs: t0,
    });
    const nullUserClient = createFakeSupabaseClient(rlsFilteredStore, undefined, {
      supabaseUrl: sharedUrl,
      authUserId: null,
    });
    await fetchStudyAttributionBundleWithClient(nullUserClient, 122, {
      nowMs: t0,
    });
    // Also exercise auth missing getUser and getUser returning non-object safely
    const emptyAuthClient = createFakeSupabaseClient(rlsFilteredStore, undefined, {
      supabaseUrl: sharedUrl,
    });
    (emptyAuthClient as unknown as { auth: object }).auth = {};
    await fetchStudyAttributionBundleWithClient(emptyAuthClient, 122, {
      nowMs: t0,
    });
    const primitiveAuthClient = createFakeSupabaseClient(
      rlsFilteredStore,
      undefined,
      { supabaseUrl: sharedUrl },
    );
    (primitiveAuthClient as unknown as { auth: object }).auth = {
      getUser: async () => null,
    };
    await fetchStudyAttributionBundleWithClient(primitiveAuthClient, 122, {
      nowMs: t0,
    });

    // Also verify Study 8 chain + request-fallback LLM response queries load cleanly.
    const adminStudy8Store: TableStore = {
      ...adminStore,
      captions: [
        ...adminStore.captions,
        {
          id: "cap-req-only",
          content: "Req fallback joke",
          image_id: "img-1",
          humor_flavor_id: 115,
          llm_prompt_chain_id: null,
          caption_request_id: 900,
          metadata: null,
        },
      ],
      study_caption_mappings: [
        ...adminStore.study_caption_mappings,
        { id: 11, study_id: 8, caption_id: "cap-req-only" },
      ],
    };
    const study8Bundle = await fetchStudyAttributionBundleWithClient(
      createFakeSupabaseClient(adminStudy8Store, undefined, {
        supabaseUrl: "https://study8-check.example.org",
        authUserId: "admin-1",
      }),
      8,
      { nowMs: t0 },
    );
    assert.equal(study8Bundle?.mappedCaptionCount, 2);
    assert.equal(
      study8Bundle?.captionsById.get("cap-req-only")?.terminalModelName,
      "GPT-4o",
    );

    // Superadmin arrives right after and receives full unpoisoned study + trajectory data.
    const adminColdBundle = await fetchStudyAttributionBundleWithClient(
      adminClient,
      122,
      { nowMs: t0 + 10 },
    );
    assert.equal(adminColdBundle?.exposureBundle.totalExposures, 3);
    assert.equal(adminColdBundle?.exposureBundle.totalPositive, 1);
    assert.equal(adminColdBundle?.participationFunnel.participationsStarted, 2);
    assert.equal(adminColdBundle?.demographics.surveyedVoterCount, 1);
    assert.equal(adminColdBundle?.captionMetrics?.length, 3);
    assert.equal(adminColdBundle?.captionRateHistogram?.scoredCaptionCount, 3);

    // 2. Superadmin warm cache hit & excludeHighRisk toggle issue strictly 2 live
    // check queries (profiles + studies) with zero raw event re-fetching.
    const rowsBeforeHit = adminCounters.rowCalls;
    const headsBeforeHit = adminCounters.headCalls;
    const adminWarmFiltered = await fetchStudyAttributionBundleWithClient(
      adminClient,
      122,
      { excludeHighRisk: true, nowMs: t0 + 50 },
    );
    assert.equal(adminWarmFiltered?.excludeHighRisk, true);
    assert.equal(adminWarmFiltered?.exposureBundle.totalExposures, 3);
    assert.equal(adminCounters.rowCalls - rowsBeforeHit, 2);
    assert.equal(adminCounters.headCalls - headsBeforeHit, 0);

    // Repeating same (studyId, excludeHighRisk) hits computed bundle cache directly.
    const rowsBeforeComputedHit = adminCounters.rowCalls;
    const adminWarmRepeat = await fetchStudyAttributionBundleWithClient(
      adminClient,
      122,
      { excludeHighRisk: true, nowMs: t0 + 60 },
    );
    assert.equal(adminWarmRepeat?.exposureBundle.totalExposures, 3);
    assert.equal(adminCounters.rowCalls - rowsBeforeComputedHit, 2);

    // TopNavbar metadata caches per superadmin namespace without poisoning or warm bypass.
    const adminColdNav = await fetchTopNavbarMetadataWithClient(
      adminClient,
      t0 + 70,
    );
    assert.equal(adminColdNav.recentStudies[1]?.participationsStarted, 2);
    const rowsBeforeNavHit = adminCounters.rowCalls;
    const adminWarmNav = await fetchTopNavbarMetadataWithClient(
      adminClient,
      t0 + 80,
    );
    assert.equal(adminWarmNav.recentStudies[1]?.participationsStarted, 2);
    assert.equal(adminCounters.rowCalls - rowsBeforeNavHit, 1); // live profile superadmin check only!
    const studentNavAfterWarm = await fetchTopNavbarMetadataWithClient(
      studentClient,
      t0 + 90,
    );
    assert.equal(studentNavAfterWarm.recentStudies[1]?.participationsStarted, 0);

    // Empty search preload caches per superadmin namespace without poisoning or warm bypass.
    const rowsBeforeColdEmptySearch = adminCounters.rowCalls;
    const adminColdEmptySearch = await fetchStudySearchResultsWithClient(
      adminClient,
      "",
      t0 + 91,
    );
    assert.equal(adminColdEmptySearch.studies.length, 3);
    assert.ok(adminCounters.rowCalls - rowsBeforeColdEmptySearch > 1);
    const rowsBeforeWarmEmptySearch = adminCounters.rowCalls;
    const adminWarmEmptySearch = await fetchStudySearchResultsWithClient(
      adminClient,
      "",
      t0 + 92,
    );
    assert.equal(adminWarmEmptySearch.studies.length, 3);
    assert.equal(adminCounters.rowCalls - rowsBeforeWarmEmptySearch, 1);
    const studentRowsBeforeWarmSearch = studentCounters.rowCalls;
    await fetchStudySearchResultsWithClient(studentClient, "", t0 + 93);
    assert.ok(studentCounters.rowCalls - studentRowsBeforeWarmSearch > 2);

    // Warm trajectory cache hit also skips mapping/caption/HEAD event scans.
    await fetchFlavorCrossStudyTrajectoriesWithClient(adminClient, [115, 177], {
      nowMs: t0 + 100,
    });
    const rowsBeforeTrajHit = adminCounters.rowCalls;
    const headsBeforeTrajHit = adminCounters.headCalls;
    const warmTraj = await fetchFlavorCrossStudyTrajectoriesWithClient(
      adminClient,
      [115, 177],
      { nowMs: t0 + 200 },
    );
    assert.equal(warmTraj[115]?.[0]?.exposures, 3);
    assert.equal(warmTraj[177]?.[0]?.positive, 1);
    assert.equal(adminCounters.rowCalls - rowsBeforeTrajHit, 2);
    assert.equal(adminCounters.headCalls - headsBeforeTrajHit, 0);

    // 3. Warm-bypass rejection: with the shared supabaseUrl cache now warm,
    // a non-superadmin client targeting the exact same URL NEVER receives A's rows.
    const studentAfterWarm = await fetchStudyAttributionBundleWithClient(
      studentClient,
      122,
      { nowMs: t0 + 300 },
    );
    assert.equal(studentAfterWarm?.exposureBundle.totalExposures, 0);
    assert.equal(studentAfterWarm?.participationFunnel.participationsStarted, 0);
    assert.equal(studentAfterWarm?.demographics.surveyedVoterCount, 0);

    const studentTrajAfterWarm =
      await fetchFlavorCrossStudyTrajectoriesWithClient(
        studentClient,
        [115, 177],
        { nowMs: t0 + 300 },
      );
    assert.equal(studentTrajAfterWarm[115]?.[0]?.exposures, 0);
    assert.equal(studentTrajAfterWarm[177]?.[0]?.exposures, 0);

    // 4. Stale-While-Revalidate: past STUDY_CACHE_TTL_MS (15m) inside max-stale (12h),
    // verified superadmin immediately receives the stale bundle/trajectory/navbar/search
    // while triggering ONE coalesced background refresh; non-superadmin callers STILL
    // never read stale superadmin entries (Gap G5).
    adminStore.study_participations.push({
      profile_id: "u-late",
      study_id: 122,
      started_at: "2026-10-10T05:00:00+00:00",
      ended_at: "2026-10-10T05:02:00+00:00",
      completion_stats: null,
    });
    const tStale = t0 + STUDY_CACHE_TTL_MS + 500;
    const studentDuringStale = await fetchStudyAttributionBundleWithClient(
      studentClient,
      122,
      { nowMs: tStale },
    );
    assert.equal(
      studentDuringStale?.participationFunnel.participationsStarted,
      0,
    );

    const [staleBundleA, staleBundleB] = await Promise.all([
      fetchStudyAttributionBundleWithClient(adminClient, 122, {
        nowMs: tStale,
      }),
      fetchStudyAttributionBundleWithClient(adminClient, 122, {
        nowMs: tStale + 1,
      }),
    ]);
    assert.equal(staleBundleA?.participationFunnel.participationsStarted, 2);
    assert.equal(staleBundleB?.participationFunnel.participationsStarted, 2);

    const [staleNavA, staleNavB] = await Promise.all([
      fetchTopNavbarMetadataWithClient(adminClient, tStale),
      fetchTopNavbarMetadataWithClient(adminClient, tStale + 1),
    ]);
    assert.equal(staleNavA.recentStudies[1]?.participationsStarted, 2);
    assert.equal(staleNavB.recentStudies[1]?.participationsStarted, 2);

    const [staleTrajA, staleTrajB] = await Promise.all([
      fetchFlavorCrossStudyTrajectoriesWithClient(adminClient, [115, 177], {
        nowMs: tStale,
      }),
      fetchFlavorCrossStudyTrajectoriesWithClient(adminClient, [115, 177], {
        nowMs: tStale + 1,
      }),
    ]);
    assert.equal(staleTrajA[115]?.[0]?.exposures, 3);
    assert.equal(staleTrajB[177]?.[0]?.positive, 1);

    await new Promise((resolve) => setTimeout(resolve, 15));

    const refreshedBundle = await fetchStudyAttributionBundleWithClient(
      adminClient,
      122,
      { nowMs: tStale + 1_000 },
    );
    assert.equal(
      refreshedBundle?.participationFunnel.participationsStarted,
      3,
    );
    const refreshedNav = await fetchTopNavbarMetadataWithClient(
      adminClient,
      tStale + 1_000,
    );
    assert.equal(refreshedNav.recentStudies[1]?.participationsStarted, 3);

    // Past STUDY_CACHE_TTL_MS + STUDY_CACHE_MAX_STALE_MS, blocks for synchronous reload.
    adminStore.study_participations.push({
      profile_id: "u-expired",
      study_id: 122,
      started_at: "2026-10-10T06:00:00+00:00",
      ended_at: "2026-10-10T06:02:00+00:00",
      completion_stats: null,
    });
    const tHardExpired =
      tStale + STUDY_CACHE_TTL_MS + STUDY_CACHE_MAX_STALE_MS + 2_000;
    const hardReloadedBundle = await fetchStudyAttributionBundleWithClient(
      adminClient,
      122,
      { nowMs: tHardExpired },
    );
    assert.equal(
      hardReloadedBundle?.participationFunnel.participationsStarted,
      4,
    );
    await fetchFlavorCrossStudyTrajectoriesWithClient(adminClient, [115, 177], {
      nowMs: tHardExpired,
    });

    // 5. Bounded LRU eviction caps study cache at STUDY_CACHE_MAX_ENTRIES (16)
    // and trajectory cache at TRAJECTORY_CACHE_MAX_ENTRIES (64).
    clearStudyLineageCaches();
    const manyStudiesStore: TableStore = {
      ...adminStore,
      studies: Array.from({ length: STUDY_CACHE_MAX_ENTRIES + 2 }, (_, idx) => ({
        id: idx + 1,
        slug: `s-${idx + 1}`,
        description: null,
        start_datetime_utc: "2026-10-01T00:00:00+00:00",
        end_datetime_utc: "2026-10-02T00:00:00+00:00",
        created_datetime_utc: "2026-10-01T00:00:00+00:00",
        is_hidden: false,
        is_private: false,
      })),
      humor_flavors: Array.from(
        { length: TRAJECTORY_CACHE_MAX_ENTRIES + 2 },
        (_, idx) => ({
          id: idx + 1,
          slug: `flv-${idx + 1}`,
          description: null,
        }),
      ),
      study_caption_mappings: [],
    };
    const lruCounters = { headCalls: 0, rowCalls: 0 };
    const lruClient = createFakeSupabaseClient(manyStudiesStore, lruCounters, {
      supabaseUrl: "https://lru-check.example.org",
      authUserId: "admin-1",
    });

    for (let id = 1; id <= STUDY_CACHE_MAX_ENTRIES; id += 1) {
      await fetchStudyAttributionBundleWithClient(lruClient, id, {
        nowMs: t0 + id,
      });
    }
    // Touch study 1 so study 2 becomes the least-recently-used entry.
    await fetchStudyAttributionBundleWithClient(lruClient, 1, {
      nowMs: t0 + 500,
    });
    // Insert study 17 -> evicts study 2 while retaining study 1.
    await fetchStudyAttributionBundleWithClient(
      lruClient,
      STUDY_CACHE_MAX_ENTRIES + 1,
      { nowMs: t0 + 600 },
    );

    const beforeStudy1 = lruCounters.rowCalls;
    await fetchStudyAttributionBundleWithClient(lruClient, 1, {
      nowMs: t0 + 700,
    });
    assert.equal(lruCounters.rowCalls - beforeStudy1, 2); // still cached!

    const beforeStudy2 = lruCounters.rowCalls;
    await fetchStudyAttributionBundleWithClient(lruClient, 2, {
      nowMs: t0 + 800,
    });
    assert.ok(lruCounters.rowCalls - beforeStudy2 > 2); // evicted and reloaded!

    await fetchFlavorCrossStudyTrajectoriesWithClient(
      lruClient,
      Array.from({ length: TRAJECTORY_CACHE_MAX_ENTRIES + 2 }, (_, idx) => idx + 1),
      { nowMs: t0 + 900 },
    );
    clearStudyLineageCaches();
  });

  it("paginates concurrently with post-HEAD tail sweep and splits transient failed chunks recursively", async () => {
    assert.deepEqual(
      await fetchChunkedRowsConcurrently({
        ids: [],
        contextLabel: "empty",
        runCountQuery: async () => ({ count: 0, error: null }),
        runPageQuery: async () => ({ data: [], error: null }),
      }),
      [],
    );

    // 7 items across 2 chunks (chunkSize=2), pageSize=2, with 2 extra post-HEAD tail pages in chunk "a"
    const dataset = [
      { id: 1, key: "a" },
      { id: 2, key: "a" },
      { id: 3, key: "a" },
      { id: 4, key: "a" },
      { id: 5, key: "a" }, // inserted after HEAD reported 4!
      { id: 8, key: "a" }, // full tail page triggers second tail iteration!
      { id: 9, key: "a" },
      { id: 6, key: "b" },
      { id: 7, key: "b" },
    ];
    let retriedOnce = false;
    const rows = await fetchChunkedRowsConcurrently<string, { id: number; key: string }>({
      ids: ["a", "b", "c", "a"],
      contextLabel: "concurrent events",
      chunkSize: 2,
      pageSize: 2,
      retryBaseDelayMs: 1,
      runCountQuery: async (chunk) => {
        if (chunk.includes("c") && chunk.length === 1) {
          return { count: 0, error: null };
        }
        // Intentionally under-report "a" as 4 rows while 7 exist to trigger multi-step tail sweep
        const matched = dataset.filter(
          (row) => chunk.includes(row.key) && row.id <= 4 || (row.key === "b" && chunk.includes("b")),
        );
        return { count: matched.length, error: null };
      },
      runPageQuery: async (chunk, from, to) => {
        if (!retriedOnce && from === 2) {
          retriedOnce = true;
          return { data: null, error: { message: "503 transient overload" } };
        }
        const matched = dataset.filter((row) => chunk.includes(row.key));
        return { data: matched.slice(from, to + 1), error: null };
      },
    });
    assert.deepEqual(
      rows.map((r) => r.id).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );

    // Oversized chunk triggers recursive midpoint splitting on transient timeout
    const splitRows = await fetchChunkedRowsConcurrently<number, { id: number }>({
      ids: [1, 2, 3, 4],
      contextLabel: "splittable chunk",
      chunkSize: 4,
      pageSize: 2,
      retryAttempts: 2,
      retryBaseDelayMs: 0,
      runCountQuery: async (chunk) => {
        if (chunk.length > 2) {
          return { count: null, error: { message: "504 gateway timed out" } };
        }
        return { count: chunk.length, error: null };
      },
      runPageQuery: async (chunk, from, to) => ({
        data: chunk.slice(from, to + 1).map((id) => ({ id })),
        error: null,
      }),
    });
    assert.deepEqual(
      splitRows.map((r) => r.id),
      [1, 2, 3, 4],
    );

    // Verify default pageConcurrency fans out 8 range pages in parallel.
    let activePages = 0;
    let peakActivePages = 0;
    const concurrentPages = await fetchChunkedRowsConcurrently<
      number,
      { id: number }
    >({
      ids: [1],
      contextLabel: "concurrency check",
      pageSize: 1,
      runCountQuery: async () => ({ count: 10, error: null }),
      runPageQuery: async (_chunk, from) => {
        activePages += 1;
        peakActivePages = Math.max(peakActivePages, activePages);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activePages -= 1;
        return { data: from < 10 ? [{ id: from }] : [], error: null };
      },
    });
    assert.equal(concurrentPages.length, 10);
    assert.equal(peakActivePages, 8);

    // Permanent SQL errors on both HEAD count and range page queries preserve contextLabel
    await assert.rejects(
      () =>
        fetchChunkedRowsConcurrently<number, { id: number }>({
          ids: [1],
          contextLabel: "broken count",
          retryBaseDelayMs: 0,
          runCountQuery: async () => ({
            count: null,
            error: { message: "permission denied" },
          }),
          runPageQuery: async () => ({ data: [], error: null }),
        }),
      /Unable to count broken count: permission denied/,
    );
    await assert.rejects(
      () =>
        fetchChunkedRowsConcurrently<number, { id: number }>({
          ids: [1, 2],
          contextLabel: "broken table",
          retryBaseDelayMs: 0,
          runCountQuery: async () => ({ count: 2, error: null }),
          runPageQuery: async () => ({
            data: null,
            error: { message: "column does not exist" },
          }),
        }),
      /Unable to load broken table: column does not exist/,
    );
  });
});
