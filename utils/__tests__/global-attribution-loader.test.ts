import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/supabase";
import {
  buildGlobalStudySearchResponse,
  buildStudySwitcherCatalog,
  clearGlobalAttributionCacheForTests,
  createConcurrencyLimiter,
  type EnrichedStudyCatalogEntry,
  fetchAllRowsConcurrent,
  fetchFastStudyHubCatalogWithClient,
  fetchGlobalAttributionDatasetWithClient,
  GLOBAL_CACHE_MAX_STALE_MS,
  GLOBAL_CACHE_TTL_MS,
  MAX_GLOBAL_CACHE_ENTRIES,
  selectFeaturedBenchmarkStudy,
  selectLatestScoredStudy,
} from "@/utils/global-attribution-loader";

type TableStore = Record<string, Array<Record<string, unknown>>>;

type AuthMockConfig = {
  userId?: string | null;
  authError?: string | null;
  throwsOnGetUser?: boolean;
};

type QueryCounters = {
  headCalls: number;
  rowCalls: number;
  notInCalls: number;
  voteRowCalls: number;
  voteHeadCalls: number;
  returnedVoteRows: number;
  activeQueries: number;
  peakConcurrentQueries: number;
  tableCalls: Record<string, number>;
};

const makeCounters = (): QueryCounters => ({
  headCalls: 0,
  rowCalls: 0,
  notInCalls: 0,
  voteRowCalls: 0,
  voteHeadCalls: 0,
  returnedVoteRows: 0,
  activeQueries: 0,
  peakConcurrentQueries: 0,
  tableCalls: {},
});

function createFakeSupabaseClient(
  store: TableStore,
  options?: {
    counters?: QueryCounters;
    auth?: AuthMockConfig;
    failTableOnce?: { table: string; message: string; remaining: number };
    queryDelayMs?: number;
  },
): SupabaseClient<Database> {
  const recordTable = (table: string) => {
    if (!options?.counters) return;
    options.counters.tableCalls[table] =
      (options.counters.tableCalls[table] ?? 0) + 1;
  };

  const client: Record<string, unknown> = {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const orders: Array<{ col: string; ascending: boolean }> = [];
      let limitVal: number | null = null;
      let rangeVal: { from: number; to: number } | null = null;
      let headCountMode = false;
      let maybeSingleMode = false;

      const executeInner = async () => {
        if (options?.queryDelayMs && options.queryDelayMs > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, options.queryDelayMs);
          });
        }
        recordTable(table);
        if (
          options?.failTableOnce &&
          options.failTableOnce.table === table &&
          options.failTableOnce.remaining > 0
        ) {
          options.failTableOnce.remaining -= 1;
          return {
            data: null,
            count: null,
            error: { message: options.failTableOnce.message },
          };
        }

        let rows = [...(store[table] ?? [])];
        for (const predicate of filters) {
          rows = rows.filter(predicate);
        }

        if (headCountMode) {
          if (options?.counters) {
            options.counters.headCalls += 1;
            if (table === "study_caption_vote_events") {
              options.counters.voteHeadCalls += 1;
            }
          }
          return { data: null, count: rows.length, error: null };
        }

        if (options?.counters) {
          options.counters.rowCalls += 1;
          if (table === "study_caption_vote_events") {
            options.counters.voteRowCalls += 1;
          }
        }
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
        if (maybeSingleMode) {
          return { data: rows[0] ?? null, error: null };
        }
        if (options?.counters && table === "study_caption_vote_events") {
          options.counters.returnedVoteRows += rows.length;
        }
        return { data: rows, error: null };
      };

      const execute = async () => {
        if (!options?.counters) {
          return executeInner();
        }
        options.counters.activeQueries += 1;
        if (
          options.counters.activeQueries >
          options.counters.peakConcurrentQueries
        ) {
          options.counters.peakConcurrentQueries =
            options.counters.activeQueries;
        }
        try {
          return await executeInner();
        } finally {
          options.counters.activeQueries -= 1;
        }
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
        gt(col: string, val: number | string) {
          filters.push((row) => {
            const rv = row[col] as number | string | null | undefined;
            return rv !== null && rv !== undefined && rv > val;
          });
          return builder;
        },
        gte(col: string, val: number | string) {
          filters.push((row) => {
            const rv = row[col] as number | string | null | undefined;
            return rv !== null && rv !== undefined && rv >= val;
          });
          return builder;
        },
        lt(col: string, val: number | string) {
          filters.push((row) => {
            const rv = row[col] as number | string | null | undefined;
            return rv !== null && rv !== undefined && rv < val;
          });
          return builder;
        },
        lte(col: string, val: number | string) {
          filters.push((row) => {
            const rv = row[col] as number | string | null | undefined;
            return rv !== null && rv !== undefined && rv <= val;
          });
          return builder;
        },
        not(col: string, op: string, rawVal: string) {
          if (options?.counters) {
            options.counters.notInCalls += 1;
          }
          if (op === "in") {
            const inner = rawVal.replace(/^\(/, "").replace(/\)$/, "");
            const items = inner
              .split(",")
              .map((part) => part.trim().replace(/^"(.*)"$/, "$1"));
            const excluded = new Set(items);
            filters.push((row) => !excluded.has(String(row[col])));
          }
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
        maybeSingle() {
          maybeSingleMode = true;
          limitVal = 1;
          return builder;
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((
                value: Awaited<ReturnType<typeof execute>>,
              ) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return execute().then(onfulfilled, onrejected);
        },
      };

      return builder;
    },
  };

  if (options?.auth) {
    const authConfig = options.auth;
    client.auth = {
      async getUser() {
        if (authConfig.throwsOnGetUser) {
          throw new Error("auth socket hang up");
        }
        if (authConfig.authError) {
          return {
            data: { user: null },
            error: { message: authConfig.authError },
          };
        }
        return {
          data: {
            user: authConfig.userId ? { id: authConfig.userId } : null,
          },
          error: null,
        };
      },
    };
  }

  return client as unknown as SupabaseClient<Database>;
}

const buildGlobalFixtureStore = (): TableStore => ({
  profiles: [
    { id: "admin-1", is_superadmin: true },
    { id: "student-1", is_superadmin: false },
  ],
  studies: [
    // Study 123: newest created, private 0-vote staging stub (must NOT win latestScoredStudy!)
    {
      id: 123,
      slug: "10-12--0--first-day-intern-energy",
      description: null,
      start_datetime_utc: null,
      end_datetime_utc: null,
      created_datetime_utc: "2026-10-12T00:00:00Z",
      is_hidden: true,
      is_private: true,
    },
    // Study 122: latest scored Swipe single-flavor study
    {
      id: 122,
      slug: "10-10-22-captions-sad-girl-4",
      description: "Created with Quick Study (captions with images).",
      start_datetime_utc: "2026-10-10T00:00:00Z",
      end_datetime_utc: "2026-10-11T00:00:00Z",
      created_datetime_utc: "2026-10-10T00:00:00Z",
      is_hidden: false,
      is_private: false,
    },
    // Study 20: multi-flavor transitional Likert benchmark (study_id >= 7, 0 navs, >0 votes)
    {
      id: 20,
      slug: "2026-04-17",
      description: "Flagship multi-flavor evaluation",
      start_datetime_utc: "2026-04-17T00:00:00Z",
      end_datetime_utc: "2026-04-20T00:00:00Z",
      created_datetime_utc: "2026-04-17T00:00:00Z",
      is_hidden: false,
      is_private: false,
    },
    // Study 3: legacy Likert study (study_id < 7) with unattributed + tie pair
    {
      id: 3,
      slug: "2026-01-30",
      description: null,
      start_datetime_utc: "2026-01-30T00:00:00Z",
      end_datetime_utc: "2026-02-02T00:00:00Z",
      created_datetime_utc: "2026-01-30T00:00:00Z",
      is_hidden: false,
      is_private: false,
    },
  ],
  humor_flavors: [
    { id: 10, slug: "flavor-simple-match", description: "Concise caption alignment" },
    { id: 20, slug: "flavor-roast", description: "Playful roast energy" },
    { id: 30, slug: "first-day-intern-energy", description: "Intern staging jokes" },
    { id: 99, slug: "unused-catalog-draft", description: "Never linked to studies" },
  ],
  humor_flavor_steps: [
    // Flavor 10: Step 1 upstream model 19 (Gemini 3.5 Flash) -> Step 2 synthesis model 16 (GPT 5)
    { id: 1, humor_flavor_id: 10, order_by: 1, llm_model_id: 19 },
    { id: 2, humor_flavor_id: 10, order_by: 2, llm_model_id: 16 },
    // Flavor 20: Step 1 configured as 16, while Study 20 request 500 logged model 13 (Gemini 2.5 Pro)
    // to verify historical llm_model_responses lineage parity across Tier 1 and Tier 2.
    { id: 3, humor_flavor_id: 20, order_by: 1, llm_model_id: 16 },
    // Flavor 30: configured step only (no llm_model_responses logged yet)
    { id: 4, humor_flavor_id: 30, order_by: 1, llm_model_id: 16 },
  ],
  llm_providers: [
    { id: 1, name: "OpenAI" },
    { id: 2, name: "Google" },
  ],
  llm_models: [
    { id: 13, name: "Gemini 2.5 Pro", provider_model_id: "gemini-2.5-pro", llm_provider_id: 2 },
    { id: 16, name: "GPT 5", provider_model_id: "gpt-5", llm_provider_id: 1 },
    { id: 19, name: "Gemini 3.5 Flash", provider_model_id: "gemini-3.5-flash", llm_provider_id: 2 },
    { id: 21, name: "GPT-5.6 Sol", provider_model_id: "gpt-5.6-sol", llm_provider_id: 1 },
  ],
  captions: [
    // Study 20 shared image img-1: flavor 10 (via direct FK + chain 100) vs flavor 20 (via metadata + request 500)
    {
      id: "cap-20-a",
      image_id: "img-1",
      humor_flavor_id: 10,
      llm_prompt_chain_id: 100,
      caption_request_id: null,
      metadata: null,
    },
    {
      id: "cap-20-b",
      image_id: "img-1",
      humor_flavor_id: null,
      llm_prompt_chain_id: null,
      caption_request_id: 500,
      metadata: { flavor_name: "FLAVOR-ROAST" },
    },
    // Study 122 swipe captions (single flavor 10 on same image -> must NOT inflate cross-flavor lift!)
    {
      id: "cap-122-a",
      image_id: "img-2",
      humor_flavor_id: 10,
      llm_prompt_chain_id: null,
      caption_request_id: null,
      metadata: null,
    },
    {
      id: "cap-122-b",
      image_id: "img-2",
      humor_flavor_id: 10,
      llm_prompt_chain_id: null,
      caption_request_id: null,
      metadata: null,
    },
    // Study 123 staged 0-vote caption
    {
      id: "cap-123-a",
      image_id: "img-3",
      humor_flavor_id: 30,
      llm_prompt_chain_id: null,
      caption_request_id: null,
      metadata: null,
    },
    // Study 3 legacy caption (manual unattributed vs flavor 10 tie on img-4)
    {
      id: "cap-3-manual",
      image_id: "img-4",
      humor_flavor_id: null,
      llm_prompt_chain_id: null,
      caption_request_id: null,
      metadata: null,
    },
    {
      id: "cap-3-f10",
      image_id: "img-4",
      humor_flavor_id: 10,
      llm_prompt_chain_id: null,
      caption_request_id: null,
      metadata: null,
    },
  ],
  llm_model_responses: [
    {
      id: "resp-1",
      llm_prompt_chain_id: 100,
      caption_request_id: null,
      humor_flavor_step_id: 1,
      llm_model_id: 19,
      processing_time_seconds: 1.2,
      created_datetime_utc: "2026-04-17T00:00:01Z",
    },
    {
      id: "resp-2",
      llm_prompt_chain_id: 100,
      caption_request_id: null,
      humor_flavor_step_id: 2,
      llm_model_id: 16,
      processing_time_seconds: 2.8,
      created_datetime_utc: "2026-04-17T00:00:03Z",
    },
    {
      id: "resp-3",
      llm_prompt_chain_id: null,
      caption_request_id: 500,
      humor_flavor_step_id: 3,
      llm_model_id: 13,
      processing_time_seconds: 3.1,
      created_datetime_utc: "2026-04-17T00:00:05Z",
    },
  ],
  study_caption_mappings: [
    { id: 1, study_id: 20, caption_id: "cap-20-a" },
    { id: 2, study_id: 20, caption_id: "cap-20-b" },
    { id: 3, study_id: 122, caption_id: "cap-122-a" },
    { id: 4, study_id: 122, caption_id: "cap-122-b" },
    { id: 5, study_id: 123, caption_id: "cap-123-a" },
    { id: 6, study_id: 3, caption_id: "cap-3-manual" },
    { id: 7, study_id: 3, caption_id: "cap-3-f10" },
  ],
  study_participations: [
    {
      profile_id: "u1",
      study_id: 122,
      started_at: "2026-10-10T10:00:00Z",
      ended_at: "2026-10-10T10:04:00Z",
      completion_stats: null,
    },
    {
      profile_id: "u2",
      study_id: 122,
      started_at: "2026-10-10T11:00:00Z",
      ended_at: null,
      completion_stats: null,
    },
  ],
  study_caption_navigation_events: [
    // u1 saw mapping 3 twice across two sessions (liked in s2 -> counts as 1 liked exposure!)
    { id: 1, profile_id: "u1", study_caption_mapping_id: 3, session_id: "s1" },
    { id: 2, profile_id: "u1", study_caption_mapping_id: 3, session_id: "s2" },
    // u1 saw mapping 4 once (not liked)
    { id: 3, profile_id: "u1", study_caption_mapping_id: 4, session_id: "s1" },
    // u2 saw mapping 3 once (not liked; u2 liked mapping 3 in DIFFERENT session s9 -> must NOT match s1!)
    { id: 4, profile_id: "u2", study_caption_mapping_id: 3, session_id: "s1" },
    // Null mapping nav ignored cleanly
    { id: 5, profile_id: "u9", study_caption_mapping_id: null, session_id: "s1" },
  ],
  study_caption_vote_events: [
    // Study 20 transitional Likert votes: cap-20-a wins 3/4 (75%), cap-20-b gets 1/4 (25%)
    { id: 10, profile_id: "v1", study_caption_mapping_id: 1, vote_value: "very funny", session_id: null },
    { id: 11, profile_id: "v2", study_caption_mapping_id: 1, vote_value: "funny", session_id: null },
    { id: 12, profile_id: "v3", study_caption_mapping_id: 1, vote_value: "funny", session_id: null },
    { id: 13, profile_id: "v4", study_caption_mapping_id: 1, vote_value: "meh", session_id: null },
    { id: 14, profile_id: "v1", study_caption_mapping_id: 2, vote_value: "funny", session_id: null },
    { id: 15, profile_id: "v2", study_caption_mapping_id: 2, vote_value: "not very funny", session_id: null },
    { id: 16, profile_id: "v3", study_caption_mapping_id: 2, vote_value: "not funny at all", session_id: null },
    { id: 17, profile_id: "v4", study_caption_mapping_id: 2, vote_value: "didnt get it", session_id: null },
    // Study 122 swipe votes: u1 likes map 3 in s2 (matches nav #2); u2 vote in s9 does not match s1 nav
    { id: 20, profile_id: "u1", study_caption_mapping_id: 3, vote_value: "funny", session_id: "s2" },
    { id: 21, profile_id: "u2", study_caption_mapping_id: 3, vote_value: "funny", session_id: "s9" },
    // Study 3 legacy Likert tie on img-4: both 1/2 (50%)
    { id: 30, profile_id: "v1", study_caption_mapping_id: 6, vote_value: "funny", session_id: null },
    { id: 31, profile_id: "v2", study_caption_mapping_id: 6, vote_value: "meh", session_id: null },
    { id: 32, profile_id: "v1", study_caption_mapping_id: 7, vote_value: "funny", session_id: null },
    { id: 33, profile_id: "v2", study_caption_mapping_id: 7, vote_value: "meh", session_id: null },
    // Null mapping vote ignored cleanly
    { id: 34, profile_id: "v9", study_caption_mapping_id: null, vote_value: "funny", session_id: null },
  ],
  demographic_answer_question_mapping: [
    { id: 1, is_deleted: false },
    { id: 2, is_deleted: true },
  ],
  demographic_user_responses: [
    { user_id: "v1", answer_question_mapping_id: 1 },
    { user_id: "v2", answer_question_mapping_id: 1 },
    { user_id: "v3", answer_question_mapping_id: 2 },
  ],
});

beforeEach(() => {
  clearGlobalAttributionCacheForTests();
});

describe("createConcurrencyLimiter", () => {
  it("prevents synchronous microtask handoff races from exceeding concurrency and recovers slots after errors", async () => {
    const limit = createConcurrencyLimiter(2);
    let active = 0;
    let peakActive = 0;
    const startOrder: string[] = [];

    const makeManualDeferred = () => {
      let resolveFn!: () => void;
      let rejectFn!: (err: Error) => void;
      const promise = new Promise<void>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
      });
      return { promise, resolve: resolveFn, reject: rejectFn };
    };

    const runTracked = (
      label: string,
      deferred: ReturnType<typeof makeManualDeferred>,
    ) =>
      limit(async () => {
        startOrder.push(label);
        active += 1;
        if (active > peakActive) {
          peakActive = active;
        }
        try {
          await deferred.promise;
          return label;
        } finally {
          active -= 1;
        }
      });

    const d1 = makeManualDeferred();
    const d2 = makeManualDeferred();
    const d3Waiter = makeManualDeferred();
    const d4Barger = makeManualDeferred();
    const d5AfterError = makeManualDeferred();

    // Fill both slots (d1, d2) and queue d3Waiter in FIFO waiters.
    const p1 = runTracked("t1", d1);
    const p2 = runTracked("t2", d2);
    const p3 = runTracked("t3-waiter", d3Waiter);

    // Attach a same-tick .then() continuation on p1 that synchronously tries to barge in
    // before t3-waiter's resume microtask runs.
    const p4 = p1.then(() => runTracked("t4-barger", d4Barger));

    assert.equal(active, 2);
    assert.deepEqual(startOrder, ["t1", "t2"]);

    // Resolve d1 and reject d2 in the same synchronous tick while t3-waiter is queued
    // and p1.then(...) tries to grab a slot immediately.
    d1.resolve();
    d2.reject(new Error("boom-t2"));

    await assert.rejects(p2, /boom-t2/);
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Peak concurrency must stay strictly <= 2, and FIFO t3-waiter must start before t4-barger!
    assert.equal(peakActive, 2);
    assert.equal(active, 2);
    assert.deepEqual(startOrder, ["t1", "t2", "t3-waiter", "t4-barger"]);

    d3Waiter.resolve();
    d4Barger.resolve();
    assert.equal(await p3, "t3-waiter");
    assert.equal(await p4, "t4-barger");
    assert.equal(active, 0);

    // Verify full slot capacity recovers cleanly after earlier rejection.
    d5AfterError.resolve();
    assert.equal(await runTracked("t5-recovered", d5AfterError), "t5-recovered");
    assert.equal(peakActive, 2);
    assert.equal(active, 0);
  });
});

describe("fetchAllRowsConcurrent", () => {
  it("short-circuits empty tables, concurrently shards keyset bounds, catches post-probe tail inserts, and retries transient errors", async () => {
    let shardCalls = 0;
    const empty = await fetchAllRowsConcurrent<{ id: number }>({
      contextLabel: "empty test",
      boundsQuery: async () => ({ data: [], error: null }),
      shardQuery: async () => {
        shardCalls += 1;
        return { data: [], error: null };
      },
    });
    assert.deepEqual(empty, []);
    assert.equal(shardCalls, 0);

    const backingRows = [
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
      { id: 6 },
      { id: 7 },
      { id: 8 },
    ];
    let injectedTransient = false;
    const paged = await fetchAllRowsConcurrent<{ id: number }>({
      contextLabel: "paged test",
      pageSize: 2,
      concurrency: 2,
      retryBaseDelayMs: 0,
      boundsQuery: async (ascending) => ({
        data: [ascending ? { id: 1 } : { id: 6 }],
        error: null,
      }),
      shardQuery: async (afterId, maxId, limit) => {
        if (afterId === 3 && !injectedTransient) {
          injectedTransient = true;
          return { data: null, error: { message: "503 transient overload" } };
        }
        const filtered = backingRows
          .filter((r) => r.id > afterId && (maxId === null || r.id <= maxId))
          .slice(0, limit);
        return { data: filtered, error: null };
      },
    });
    assert.deepEqual(
      paged.map((r) => r.id).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );

    await assert.rejects(
      () =>
        fetchAllRowsConcurrent<{ id: number }>({
          contextLabel: "hard error test",
          retryBaseDelayMs: 0,
          boundsQuery: async (ascending) => ({
            data: [ascending ? { id: 1 } : { id: 2 }],
            error: null,
          }),
          shardQuery: async () => ({
            data: null,
            error: { message: "permission denied for table x" },
          }),
        }),
      /Unable to load hard error test: permission denied/,
    );
  });
});

describe("Global cross-study attribution loader, Tier-1 fast hub catalog, and search index", () => {
  it("computes dual-era exposures, metadata fallbacks, same-image lifts, hero targets, and 100%-reconciled Flavor/Model leaderboards with zero NOT IN scans", async () => {
    const counters = makeCounters();
    const client = createFakeSupabaseClient(buildGlobalFixtureStore(), {
      counters,
      queryDelayMs: 1,
    });
    const dataset = await fetchGlobalAttributionDatasetWithClient(client, {
      nowMs: Date.parse("2026-10-20T00:00:00Z"),
      pageSize: 3,
      concurrency: 2,
    });

    // Zero unindexed profile_id NOT IN (...) scans anywhere, and total overlapping
    // Promise.all query concurrency stays strictly bounded by createConcurrencyLimiter(2)!
    assert.equal(counters.notInCalls, 0);
    assert.equal(counters.peakConcurrentQueries, 2);

    assert.equal(dataset.kpis.totalStudies, 4);
    assert.equal(dataset.kpis.scoredStudies, 3);
    assert.equal(dataset.kpis.multiFlavorStudies, 1);
    assert.equal(dataset.kpis.testedFlavorCount, 3);
    assert.equal(dataset.kpis.scoredFlavorCount, 2);
    assert.equal(dataset.unusedFlavorCount, 1);
    assert.equal(dataset.unevaluatedFlavors[0]?.slug, "unused-catalog-draft");
    assert.equal(dataset.kpis.testedModelCount, 3);
    assert.equal(dataset.kpis.synthesisModelCount, 2);
    assert.equal(dataset.unevaluatedModels.length, 1);
    assert.equal(dataset.unevaluatedModels[0]?.name, "GPT-5.6 Sol");
    assert.equal(dataset.kpis.surveyedProfileCount, 2);

    // Smart hero target checks: #122 wins latestScoredStudy (skipping 0-vote #123),
    // and multi-flavor #20 wins featuredBenchmarkStudy!
    assert.equal(dataset.latestScoredStudy?.id, 122);
    assert.equal(dataset.featuredBenchmarkStudy?.id, 20);

    const byStudyId = new Map(dataset.studies.map((s) => [s.id, s]));

    // Study 20: transitional Likert (>= 7, 0 navs, 8 votes) reports Rating scale & 8 votes
    // without scanning Likert profile_id voters (voterCount === 0 since 0 participations).
    const study20 = byStudyId.get(20)!;
    assert.equal(study20.exposureMode, "likert_votes");
    assert.equal(study20.isTransitionalLikert, true);
    assert.equal(study20.formatDisplayLabel, "Rating scale");
    assert.equal(study20.detailHref, "/study/20/study-detail");
    assert.equal(study20.exposureCount, 8);
    assert.equal(study20.positiveCount, 4);
    assert.equal(study20.voterCount, 0);
    assert.equal(study20.flavorCount, 2);
    assert.equal(study20.modelCount, 3); // GPT 5, Gemini 3.5 Flash, Gemini 2.5 Pro (from request-level response)
    assert.equal(study20.sharedImagePairCount, 1);

    // Study 122: Swipe exact parity with adaptSwipeExposures (3 distinct user-card views, 1 matched like)
    const study122 = byStudyId.get(122)!;
    assert.equal(study122.exposureMode, "swipe_navigation");
    assert.equal(study122.formatDisplayLabel, "Swipe");
    assert.equal(study122.detailHref, "/study/122/new-style-report");
    assert.equal(study122.voterCount, 2);
    assert.equal(study122.exposureCount, 3);
    assert.equal(study122.positiveCount, 1);
    assert.equal(study122.sharedImagePairCount, 0);
    assert.equal(study122.completionRate, 0.5);
    assert.equal(study122.medianRunMinutes, 4);
    assert.equal(study122.customDescription, null);

    // Study 123: 0-vote staging stub
    const study123 = byStudyId.get(123)!;
    assert.equal(study123.exposureCount, 0);
    assert.equal(study123.positiveRate, null);

    // Global Prompt Flavors leaderboard
    const f10 = dataset.flavors.find((f) => f.flavorId === 10)!;
    const f20 = dataset.flavors.find((f) => f.flavorId === 20)!;
    const f30 = dataset.flavors.find((f) => f.flavorId === 30)!;
    assert.equal(f10.primarySynthesisModel, "GPT 5");
    assert.equal(f20.primarySynthesisModel, "Gemini 2.5 Pro");
    assert.equal(f10.swipeExposures, 3);
    assert.equal(f10.ratingScaleExposures, 6);
    assert.equal(f10.sharedImageCount, 2);
    assert.equal(f10.meanLiftPp, 12.5);
    assert.equal(f10.pairWins, 1);
    assert.equal(f10.pairTies, 1);
    assert.equal(
      f10.studies.find((s) => s.studyId === 20)?.headToHeadHref,
      "/study/20/head-to-head?flavor=flavor-simple-match",
    );
    assert.equal(
      f10.studies.find((s) => s.studyId === 122)?.headToHeadHref,
      null,
    );
    assert.equal(f20.meanLiftPp, -25);
    assert.equal(f20.pairLosses, 1);
    assert.equal(f30.exposures, 0);
    assert.equal(dataset.flavors[dataset.flavors.length - 1]?.flavorId, 30);

    // Global LLM Models leaderboard
    const m16 = dataset.models.find((m) => m.modelId === 16)!;
    const m19 = dataset.models.find((m) => m.modelId === 19)!;
    assert.equal(m16.primaryRole, "synthesis");
    assert.equal(m16.medianChainSeconds, 4);
    assert.equal(
      m16.studies.find((s) => s.studyId === 20)?.href,
      "/study/20/attribution?groupBy=model&model=16",
    );
    assert.equal(m19.primaryRole, "pipeline_step");
    assert.equal(m19.synthesisCaptionCount, 0);
    assert.equal(m19.pipelineExposures, 9);
    assert.equal(
      m19.studies.find((s) => s.studyId === 20)?.href,
      "/study/20/attribution?groupBy=pipeline",
    );

    const emptySearch = buildGlobalStudySearchResponse(dataset, "");
    assert.deepEqual(
      emptySearch.studies.map((s) => s.id),
      [20, 122, 3],
    );
    assert.equal(emptySearch.reports[0]?.href, "/?tab=flavors");
    assert.equal(emptySearch.reports[1]?.href, "/?tab=models");

    const geminiSearch = buildGlobalStudySearchResponse(dataset, "gemini");
    assert.ok(geminiSearch.studies.some((s) => s.id === 20));
    assert.equal(
      geminiSearch.models.find((m) => m.id === 19)?.href,
      "/?tab=models&model=19",
    );

    const hashSearch = buildGlobalStudySearchResponse(dataset, "#123");
    assert.deepEqual(hashSearch.studies.map((s) => s.id), [123]);

    const switcherCatalog = buildStudySwitcherCatalog(dataset);
    assert.equal(switcherCatalog.length, 4);
    assert.equal(
      switcherCatalog.find((s) => s.id === 20)?.flavorCount,
      2,
    );
  });

  it("Tier-1 fetchFastStudyHubCatalogWithClient transfers zero Likert vote rows and matches Tier-2 studies, hero targets, mutated models, and KPIs identically", async () => {
    const store = buildGlobalFixtureStore();
    // Add Study 15: single-flavor transitional Likert study WITH 2 participation rows
    // to verify voterCount uses distinct study_participations profiles when present.
    store.studies.push({
      id: 15,
      slug: "2026-03-06",
      description: null,
      start_datetime_utc: "2026-03-06T00:00:00Z",
      end_datetime_utc: "2026-03-08T00:00:00Z",
      created_datetime_utc: "2026-03-06T00:00:00Z",
      is_hidden: false,
      is_private: false,
    });
    for (let k = 0; k < 5; k += 1) {
      store.captions.push({
        id: `cap-15-${k}`,
        image_id: `img-15-${k}`,
        humor_flavor_id: 10,
        llm_prompt_chain_id: null,
        caption_request_id: null,
        metadata: null,
      });
      store.study_caption_mappings.push({
        id: 100 + k,
        study_id: 15,
        caption_id: `cap-15-${k}`,
      });
    }
    store.study_participations.push(
      {
        profile_id: "p1",
        study_id: 15,
        started_at: "2026-03-06T10:00:00Z",
        ended_at: "2026-03-06T10:02:00Z",
        completion_stats: null,
      },
      {
        profile_id: "p2",
        study_id: 15,
        started_at: "2026-03-06T11:00:00Z",
        ended_at: "2026-03-06T11:05:00Z",
        completion_stats: null,
      },
    );
    store.study_caption_vote_events.push(
      {
        id: 500,
        profile_id: "p1",
        study_caption_mapping_id: 100,
        vote_value: "funny",
        session_id: null,
      },
      {
        id: 501,
        profile_id: "p2",
        study_caption_mapping_id: 104,
        vote_value: "meh",
        session_id: null,
      },
    );
    // Add an unviewed caption from Flavor 20 / Model 13 inside Swipe Study 122 to verify
    // latestScoredStudyId stays pinned to Study 20 (where exposures > 0), matching Tier 2.
    store.captions.push({
      id: "cap-122-unshown",
      image_id: "img-unshown",
      humor_flavor_id: 20,
      llm_prompt_chain_id: null,
      caption_request_id: 500,
      metadata: null,
    });
    store.study_caption_mappings.push({
      id: 199,
      study_id: 122,
      caption_id: "cap-122-unshown",
    });

    const nowMs = Date.parse("2026-10-20T00:00:00Z");
    const fastCounters = makeCounters();
    const fastClient = createFakeSupabaseClient(store, {
      counters: fastCounters,
      queryDelayMs: 1,
    });
    const fastCatalog = await fetchFastStudyHubCatalogWithClient(fastClient, {
      nowMs,
      pageSize: 3,
      concurrency: 2,
    });

    // Tier 1 transfers ONLY the 2 Swipe vote rows (study 122) and 0 Likert vote rows,
    // while keeping total simultaneous HTTP requests strictly bounded to concurrency=2!
    assert.equal(fastCounters.notInCalls, 0);
    assert.equal(fastCounters.peakConcurrentQueries, 2);
    assert.equal(fastCounters.returnedVoteRows, 2);
    assert.ok(fastCounters.voteHeadCalls >= 4);

    const fullClient = createFakeSupabaseClient(store);
    const fullDataset = await fetchGlobalAttributionDatasetWithClient(
      fullClient,
      {
        nowMs,
        pageSize: 3,
        concurrency: 2,
      },
    );

    // Exact 100% parity across all studies, hero targets, and KPIs between Tier 1 and Tier 2.
    assert.deepEqual(fastCatalog.studies, fullDataset.studies);
    assert.deepEqual(fastCatalog.kpis, fullDataset.kpis);
    assert.equal(
      fastCatalog.featuredBenchmarkStudy?.id,
      fullDataset.featuredBenchmarkStudy?.id,
    );
    assert.equal(fastCatalog.featuredBenchmarkStudy?.id, 20);
    assert.equal(
      fastCatalog.latestScoredStudy?.id,
      fullDataset.latestScoredStudy?.id,
    );

    const study15 = fastCatalog.studies.find((s) => s.id === 15)!;
    assert.equal(study15.exposureMode, "likert_votes");
    assert.equal(study15.exposureCount, 2);
    assert.equal(study15.positiveCount, 1);
    assert.equal(study15.voterCount, 2);

    // Search over FastStudyHubCatalog routes flavors, models, and untested entries cleanly.
    const fastEmptySearch = buildGlobalStudySearchResponse(fastCatalog, "");
    assert.equal(fastEmptySearch.studies[0]?.id, 20);
    assert.equal(fastEmptySearch.studies[1]?.id, 122);

    const fastGeminiSearch = buildGlobalStudySearchResponse(
      fastCatalog,
      "gemini",
    );
    assert.ok(fastGeminiSearch.studies.some((s) => s.id === 20));
    assert.equal(
      fastGeminiSearch.flavors.find((f) => f.slug === "flavor-roast")?.href,
      "/?tab=flavors&flavor=flavor-roast",
    );
    assert.equal(
      fastGeminiSearch.flavors.find((f) => f.slug === "flavor-roast")
        ?.latestStudyId,
      20,
    );
    assert.equal(
      fastGeminiSearch.models.find((m) => m.id === 13)?.latestStudyId,
      20,
    );

    const fastUnusedSearch = buildGlobalStudySearchResponse(
      fastCatalog,
      "unused",
    );
    assert.equal(fastUnusedSearch.flavors[0]?.href, null);
    assert.equal(fastUnusedSearch.flavors[0]?.studyCount, 0);

    const fastSolSearch = buildGlobalStudySearchResponse(fastCatalog, "5.6");
    assert.equal(fastSolSearch.models[0]?.href, null);
    assert.equal(fastSolSearch.models[0]?.studyCount, 0);
  });

  it("handles fallback edge cases in selectLatestScoredStudy and selectFeaturedBenchmarkStudy", () => {
    const emptyStub = {
      id: 90,
      exposureCount: 0,
      flavorCount: 3,
      sharedImagePairCount: 5,
      is_private: false,
    } as EnrichedStudyCatalogEntry;
    const privScoredBenchmark = {
      id: 80,
      exposureCount: 50,
      flavorCount: 2,
      sharedImagePairCount: 4,
      is_private: true,
    } as EnrichedStudyCatalogEntry;

    assert.equal(selectLatestScoredStudy([emptyStub]), null);
    assert.equal(selectFeaturedBenchmarkStudy([emptyStub]), null);
    assert.equal(
      selectLatestScoredStudy([emptyStub, privScoredBenchmark])?.id,
      80,
    );
    assert.equal(
      selectFeaturedBenchmarkStudy([emptyStub, privScoredBenchmark])?.id,
      80,
    );
  });
});

describe("Live superadmin cache gate & 15m/12h SWR cache isolation across Tier 1 and Tier 2", () => {
  it("shares 15m/12h SWR caches strictly across verified superadmin calls, projects Tier-2 into Tier-1 cache, and blocks warm RLS bypass and cold poisoning", async () => {
    assert.equal(GLOBAL_CACHE_TTL_MS, 15 * 60_000);
    assert.equal(GLOBAL_CACHE_MAX_STALE_MS, 12 * 60 * 60_000);

    const adminStore = buildGlobalFixtureStore();
    const rlsFilteredMemberStore: TableStore = {
      ...buildGlobalFixtureStore(),
      study_participations: [],
      demographic_user_responses: [],
    };

    const cacheKey = "https://project.supabase.co";
    const t0 = 1_700_000_000_000;

    // 1. Cold-cache poisoning check on BOTH Tier 1 and Tier 2: non-superadmin hits first.
    const memberClientCold = createFakeSupabaseClient(rlsFilteredMemberStore, {
      auth: { userId: "student-1" },
    });
    const memberFastCold = await fetchFastStudyHubCatalogWithClient(
      memberClientCold,
      { cacheKey, nowMs: t0 },
    );
    assert.equal(memberFastCold.kpis.totalParticipations, 0);
    const memberFullCold = await fetchGlobalAttributionDatasetWithClient(
      memberClientCold,
      { cacheKey, nowMs: t0 + 10 },
    );
    assert.equal(memberFullCold.kpis.totalParticipations, 0);

    // 2. Superadmin builds Tier 2 cold: must NOT be poisoned, AND must warm Tier-1 cache!
    const adminCounters = makeCounters();
    const adminClient = createFakeSupabaseClient(adminStore, {
      counters: adminCounters,
      auth: { userId: "admin-1" },
    });
    const adminFull1 = await fetchGlobalAttributionDatasetWithClient(
      adminClient,
      { cacheKey, nowMs: t0 + 100 },
    );
    assert.equal(adminFull1.kpis.totalParticipations, 2);
    assert.equal(adminFull1.kpis.surveyedProfileCount, 2);
    const votesAfterFullWarmup =
      adminCounters.tableCalls.study_caption_vote_events ?? 0;

    // Tier-1 call immediately hits projected warm Tier-1 cache with ZERO extra vote queries!
    const adminFastFromProj = await fetchFastStudyHubCatalogWithClient(
      adminClient,
      { cacheKey, nowMs: t0 + 200 },
    );
    assert.equal(adminFastFromProj.kpis.totalParticipations, 2);
    assert.equal(
      adminCounters.tableCalls.study_caption_vote_events,
      votesAfterFullWarmup,
    );

    // Repeat Tier-2 call also hits warm cache cleanly.
    const adminFull2 = await fetchGlobalAttributionDatasetWithClient(
      adminClient,
      { cacheKey, nowMs: t0 + 5_000 },
    );
    assert.equal(adminFull2, adminFull1);

    // 3. Warm-cache bypass check across all non-superadmin / bare-mock variants on BOTH tiers!
    for (const authVariant of [
      { userId: "student-1" },
      { userId: null },
      { authError: "jwt expired" },
      { throwsOnGetUser: true },
      undefined,
    ] as const) {
      const probeClient = createFakeSupabaseClient(rlsFilteredMemberStore, {
        auth: authVariant,
      });
      const probeFast = await fetchFastStudyHubCatalogWithClient(probeClient, {
        cacheKey,
        nowMs: t0 + 6_000,
      });
      assert.equal(probeFast.kpis.totalParticipations, 0);
      const probeFull = await fetchGlobalAttributionDatasetWithClient(
        probeClient,
        { cacheKey, nowMs: t0 + 6_000 },
      );
      assert.equal(probeFull.kpis.totalParticipations, 0);
    }

    // 4. Stale-While-Revalidate past 15m TTL inside 12h max-stale window.
    adminStore.study_participations.push({
      profile_id: "u3",
      study_id: 122,
      started_at: "2026-10-10T12:00:00Z",
      ended_at: "2026-10-10T12:03:00Z",
      completion_stats: null,
    });
    const tStale = t0 + GLOBAL_CACHE_TTL_MS + 500;
    const [staleReturnA, staleReturnB] = await Promise.all([
      fetchGlobalAttributionDatasetWithClient(adminClient, {
        cacheKey,
        nowMs: tStale,
      }),
      fetchGlobalAttributionDatasetWithClient(adminClient, {
        cacheKey,
        nowMs: tStale + 1,
      }),
    ]);
    assert.equal(staleReturnA, adminFull1);
    assert.equal(staleReturnB, adminFull1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const refreshedAdmin = await fetchGlobalAttributionDatasetWithClient(
      adminClient,
      { cacheKey, nowMs: tStale + 1_000 },
    );
    assert.equal(refreshedAdmin.kpis.totalParticipations, 3);

    // Transient background SWR failure preserves existing stale value safely.
    const failingBgClient = createFakeSupabaseClient(adminStore, {
      auth: { userId: "admin-1" },
      failTableOnce: {
        table: "humor_flavors",
        message: "fatal background hiccup",
        remaining: 1,
      },
    });
    const tStale2 = tStale + GLOBAL_CACHE_TTL_MS + 500;
    const stillServed = await fetchGlobalAttributionDatasetWithClient(
      failingBgClient,
      { cacheKey, nowMs: tStale2 },
    );
    assert.equal(stillServed.kpis.totalParticipations, 3);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Hard expiry past TTL + MAX_STALE reloads synchronously.
    adminStore.study_participations.push({
      profile_id: "u4",
      study_id: 122,
      started_at: "2026-10-10T13:00:00Z",
      ended_at: "2026-10-10T13:02:00Z",
      completion_stats: null,
    });
    const hardExpired = await fetchGlobalAttributionDatasetWithClient(
      adminClient,
      {
        cacheKey,
        nowMs: tStale + GLOBAL_CACHE_TTL_MS + GLOBAL_CACHE_MAX_STALE_MS + 2_000,
      },
    );
    assert.equal(hardExpired.kpis.totalParticipations, 4);
  });

  it("deduplicates concurrent in-flight superadmin builds, clears rejected promises in finally, and caps LRU size on both tiers", async () => {
    const store = buildGlobalFixtureStore();
    const counters = makeCounters();
    const adminClient = createFakeSupabaseClient(store, {
      counters,
      auth: { userId: "admin-1" },
    });

    const [f1, f2] = await Promise.all([
      fetchFastStudyHubCatalogWithClient(adminClient, {
        cacheKey: "https://concurrent-fast.test",
        nowMs: 1_000,
      }),
      fetchFastStudyHubCatalogWithClient(adminClient, {
        cacheKey: "https://concurrent-fast.test",
        nowMs: 1_000,
      }),
    ]);
    assert.equal(f1, f2);
    assert.equal(counters.tableCalls.humor_flavors, 1);

    const flakyClient = createFakeSupabaseClient(store, {
      auth: { userId: "admin-1" },
      failTableOnce: {
        table: "humor_flavors",
        message: "fatal syntax failure",
        remaining: 1,
      },
    });
    await assert.rejects(() =>
      fetchFastStudyHubCatalogWithClient(flakyClient, {
        cacheKey: "https://recover-fast.test",
        nowMs: 2_000,
      }),
    );
    const recovered = await fetchFastStudyHubCatalogWithClient(flakyClient, {
      cacheKey: "https://recover-fast.test",
      nowMs: 2_001,
    });
    assert.equal(recovered.studies.length, 4);

    for (let i = 0; i < MAX_GLOBAL_CACHE_ENTRIES + 2; i += 1) {
      await fetchFastStudyHubCatalogWithClient(adminClient, {
        cacheKey: `https://lru-fast-${i}.test`,
        nowMs: 5_000 + i,
      });
      await fetchGlobalAttributionDatasetWithClient(adminClient, {
        cacheKey: `https://lru-full-${i}.test`,
        nowMs: 5_000 + i,
      });
    }
  });
});
