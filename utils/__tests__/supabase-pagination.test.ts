import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chunkArray,
  fetchAllRows,
  fetchExactCount,
  fetchHasAnyRow,
  fetchRowsByIdChunks,
  isLikelyTransientFetchError,
  mapWithConcurrency,
  sumExactCountsByIdChunks,
} from "@/utils/supabase-pagination";

describe("utils/supabase-pagination", () => {
  it("classifies transient network errors vs permanent database errors", () => {
    assert.equal(isLikelyTransientFetchError("TypeError: fetch failed"), true);
    assert.equal(isLikelyTransientFetchError("Socket hang up during read"), true);
    assert.equal(isLikelyTransientFetchError("upstream 503 unavailable"), true);
    assert.equal(
      isLikelyTransientFetchError("column does not exist (42703)"),
      false,
    );
  });

  it("chunks arrays cleanly across empty and non-multiple lengths", () => {
    assert.deepEqual(chunkArray([], 5), []);
    assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunkArray(["a", "b"], 0), [["a"], ["b"]]);
  });

  it("preserves original input index ordering in mapWithConcurrency", async () => {
    assert.deepEqual(await mapWithConcurrency([], 4, async (x) => x), []);
    const delays = [30, 5, 20, 1, 15];
    const out = await mapWithConcurrency(delays, 2, async (ms, idx) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `${idx}:${ms}`;
    });
    assert.deepEqual(out, ["0:30", "1:5", "2:20", "3:1", "4:15"]);
  });

  it("paginates fetchAllRows across multiple pages and retries transient errors", async () => {
    const dataset = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }));
    let calls = 0;

    const rows = await fetchAllRows<{ id: number }>({
      contextLabel: "test items",
      pageSize: 3,
      retryAttempts: 3,
      retryBaseDelayMs: 0,
      runQuery: async (from, to) => {
        calls += 1;
        if (calls === 1) {
          return { data: null, error: { message: "fetch failed transiently" } };
        }
        return { data: dataset.slice(from, to + 1), error: null };
      },
    });

    assert.equal(rows.length, 7);
    assert.deepEqual(
      rows.map((r) => r.id),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.equal(calls, 4); // 1 transient failure + 3 pages (3 + 3 + 1)
  });

  it("throws immediately on permanent fetchAllRows errors and handles null data", async () => {
    const empty = await fetchAllRows<{ id: number }>({
      contextLabel: "empty table",
      runQuery: async () => ({ data: null, error: null }),
    });
    assert.deepEqual(empty, []);

    let attempts = 0;
    await assert.rejects(
      () =>
        fetchAllRows({
          contextLabel: "broken query",
          retryAttempts: 3,
          retryBaseDelayMs: 0,
          runQuery: async () => {
            attempts += 1;
            return { data: null, error: { message: "permission denied" } };
          },
        }),
      /Unable to load broken query: permission denied/,
    );
    assert.equal(attempts, 1);
  });

  it("deduplicates IDs and splits oversized transient chunks recursively in fetchRowsByIdChunks", async () => {
    assert.deepEqual(
      await fetchRowsByIdChunks({
        ids: [],
        contextLabel: "none",
        runQuery: async () => ({ data: [], error: null }),
      }),
      [],
    );

    const rows = await fetchRowsByIdChunks<number, { id: number; page: number }>({
      ids: [1, 2, 2, 3, 4, 4, 5],
      contextLabel: "adaptive chunks",
      chunkSize: 4,
      pageSize: 2,
      concurrency: 2,
      retryAttempts: 2,
      retryBaseDelayMs: 0,
      runQuery: async (chunk, from, to) => {
        // Simulate URL-too-long / timeout whenever chunk length > 2
        if (chunk.length > 2) {
          return { data: null, error: { message: "network timed out" } };
        }
        const slice = chunk
          .slice(from, to + 1)
          .map((id) => ({ id, page: from }));
        return { data: slice, error: null };
      },
    });

    assert.deepEqual(
      rows.map((r) => r.id).sort((a, b) => a - b),
      [1, 2, 3, 4, 5],
    );

    await assert.rejects(
      () =>
        fetchRowsByIdChunks({
          ids: [10],
          contextLabel: "single bad id",
          retryAttempts: 2,
          retryBaseDelayMs: 1,
          runQuery: async () => ({
            data: null,
            error: { message: "econnreset" },
          }),
        }),
      /Unable to load single bad id: econnreset/,
    );
  });

  it("computes fetchExactCount and sumExactCountsByIdChunks accurately", async () => {
    let tries = 0;
    const count = await fetchExactCount({
      contextLabel: "votes",
      retryAttempts: 2,
      retryBaseDelayMs: 0,
      runQuery: async () => {
        tries += 1;
        if (tries === 1) {
          return { count: null, error: { message: "failed to fetch" } };
        }
        return { count: 42, error: null };
      },
    });
    assert.equal(count, 42);

    const nullCount = await fetchExactCount({
      contextLabel: "null count",
      runQuery: async () => ({ count: null, error: null }),
    });
    assert.equal(nullCount, 0);

    await assert.rejects(
      () =>
        fetchExactCount({
          contextLabel: "denied count",
          runQuery: async () => ({
            count: null,
            error: { message: "syntax error" },
          }),
        }),
      /Unable to count denied count: syntax error/,
    );

    assert.equal(
      await sumExactCountsByIdChunks({
        ids: [],
        contextLabel: "empty ids",
        runQuery: async () => ({ count: 99, error: null }),
      }),
      0,
    );

    const summed = await sumExactCountsByIdChunks({
      ids: [1, 2, 2, 3, 4, 5],
      chunkSize: 2,
      concurrency: 2,
      contextLabel: "chunked sum",
      runQuery: async (chunk) => ({
        count: chunk.reduce((acc, v) => acc + v * 10, 0),
        error: null,
      }),
    });
    assert.equal(summed, (1 + 2 + 3 + 4 + 5) * 10);
  });

  it("retries transient probe errors in fetchHasAnyRow without paginating", async () => {
    let probeCalls = 0;
    const hit = await fetchHasAnyRow({
      contextLabel: "nav probe",
      retryAttempts: 2,
      retryBaseDelayMs: 0,
      runQuery: async () => {
        probeCalls += 1;
        if (probeCalls === 1) {
          return { data: null, error: { message: "fetch failed" } };
        }
        return { data: [{ id: 1 }], error: null };
      },
    });
    assert.equal(hit, true);
    assert.equal(probeCalls, 2);

    const miss = await fetchHasAnyRow({
      contextLabel: "empty probe",
      runQuery: async () => ({ data: [], error: null }),
    });
    assert.equal(miss, false);

    await assert.rejects(
      () =>
        fetchHasAnyRow({
          contextLabel: "bad probe",
          runQuery: async () => ({
            data: null,
            error: { message: "invalid syntax" },
          }),
        }),
      /Unable to probe bad probe: invalid syntax/,
    );
  });
});
