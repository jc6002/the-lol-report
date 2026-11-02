export const DEFAULT_QUERY_PAGE_SIZE = 1000;
export const DEFAULT_QUERY_CHUNK_SIZE = 120;
export const DEFAULT_QUERY_CONCURRENCY = 4;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 150;
const MIN_SPLIT_CHUNK_SIZE = 1;

export type SupabaseListResult<TRow> = {
  data: TRow[] | null;
  error: { message: string } | null;
};

export type SupabaseCountResult = {
  count: number | null;
  error: { message: string } | null;
};

const sleep = (ms: number): Promise<void> => {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const isLikelyTransientFetchError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("timed out") ||
    normalized.includes("econnreset") ||
    normalized.includes("socket hang up") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504")
  );
};

export function chunkArray<T>(
  items: readonly T[],
  chunkSize = DEFAULT_QUERY_CHUNK_SIZE,
): T[][] {
  if (items.length === 0) {
    return [];
  }
  const safeSize = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

export async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }
  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export async function fetchAllRows<TRow>({
  contextLabel,
  pageSize = DEFAULT_QUERY_PAGE_SIZE,
  retryAttempts = DEFAULT_RETRY_ATTEMPTS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  runQuery,
}: {
  contextLabel: string;
  pageSize?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  runQuery: (from: number, to: number) => PromiseLike<SupabaseListResult<TRow>>;
}): Promise<TRow[]> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const maxAttempts = Math.max(1, Math.floor(retryAttempts));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const rows: TRow[] = [];
      let from = 0;

      while (true) {
        const to = from + safePageSize - 1;
        const { data, error } = await runQuery(from, to);
        if (error) {
          throw new Error(error.message);
        }

        const pageRows = data ?? [];
        rows.push(...pageRows);
        if (pageRows.length < safePageSize) {
          return rows;
        }
        from += safePageSize;
      }
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

export async function fetchRowsByIdChunks<
  TId extends string | number,
  TRow,
>({
  ids,
  contextLabel,
  chunkSize = DEFAULT_QUERY_CHUNK_SIZE,
  pageSize = DEFAULT_QUERY_PAGE_SIZE,
  concurrency = DEFAULT_QUERY_CONCURRENCY,
  retryAttempts = DEFAULT_RETRY_ATTEMPTS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  runQuery,
}: {
  ids: readonly TId[];
  contextLabel: string;
  chunkSize?: number;
  pageSize?: number;
  concurrency?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  runQuery: (
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

  const fetchChunk = async (chunk: TId[]): Promise<TRow[]> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const chunkRows: TRow[] = [];
        let from = 0;

        while (true) {
          const to = from + safePageSize - 1;
          const { data, error } = await runQuery(chunk, from, to);
          if (error) {
            throw new Error(error.message);
          }

          const pageRows = data ?? [];
          chunkRows.push(...pageRows);
          if (pageRows.length < safePageSize) {
            return chunkRows;
          }
          from += safePageSize;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown query error";
        const transient = isLikelyTransientFetchError(message);
        if (transient && attempt < maxAttempts) {
          await sleep(retryBaseDelayMs * attempt);
          continue;
        }
        if (transient && chunk.length > MIN_SPLIT_CHUNK_SIZE) {
          const midpoint = Math.ceil(chunk.length / 2);
          const left = await fetchChunk(chunk.slice(0, midpoint));
          const right = await fetchChunk(chunk.slice(midpoint));
          return [...left, ...right];
        }
        throw new Error(`Unable to load ${contextLabel}: ${message}`);
      }
    }

    throw new Error(`Unable to load ${contextLabel}: exhausted retries`);
  };

  const chunks = chunkArray(uniqueIds, chunkSize);
  const perChunkRows = await mapWithConcurrency(chunks, concurrency, (chunk) =>
    fetchChunk(chunk),
  );
  return perChunkRows.flat();
}

export async function fetchExactCount({
  contextLabel,
  retryAttempts = DEFAULT_RETRY_ATTEMPTS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  runQuery,
}: {
  contextLabel: string;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  runQuery: () => PromiseLike<SupabaseCountResult>;
}): Promise<number> {
  const maxAttempts = Math.max(1, Math.floor(retryAttempts));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { count, error } = await runQuery();
      if (error) {
        throw new Error(error.message);
      }
      return count ?? 0;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown count query error";
      if (isLikelyTransientFetchError(message) && attempt < maxAttempts) {
        await sleep(retryBaseDelayMs * attempt);
        continue;
      }
      throw new Error(`Unable to count ${contextLabel}: ${message}`);
    }
  }

  throw new Error(`Unable to count ${contextLabel}: exhausted retries`);
}

export async function fetchHasAnyRow<TRow = unknown>({
  contextLabel,
  retryAttempts = DEFAULT_RETRY_ATTEMPTS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  runQuery,
}: {
  contextLabel: string;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  runQuery: () => PromiseLike<SupabaseListResult<TRow>>;
}): Promise<boolean> {
  const maxAttempts = Math.max(1, Math.floor(retryAttempts));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { data, error } = await runQuery();
      if (error) {
        throw new Error(error.message);
      }
      return (data ?? []).length > 0;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown probe query error";
      if (isLikelyTransientFetchError(message) && attempt < maxAttempts) {
        await sleep(retryBaseDelayMs * attempt);
        continue;
      }
      throw new Error(`Unable to probe ${contextLabel}: ${message}`);
    }
  }

  throw new Error(`Unable to probe ${contextLabel}: exhausted retries`);
}

export async function sumExactCountsByIdChunks<TId extends string | number>({
  ids,
  contextLabel,
  chunkSize = DEFAULT_QUERY_CHUNK_SIZE,
  concurrency = DEFAULT_QUERY_CONCURRENCY,
  retryAttempts = DEFAULT_RETRY_ATTEMPTS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  runQuery,
}: {
  ids: readonly TId[];
  contextLabel: string;
  chunkSize?: number;
  concurrency?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  runQuery: (chunk: TId[]) => PromiseLike<SupabaseCountResult>;
}): Promise<number> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return 0;
  }

  const chunks = chunkArray(uniqueIds, chunkSize);
  const counts = await mapWithConcurrency(chunks, concurrency, (chunk) =>
    fetchExactCount({
      contextLabel,
      retryAttempts,
      retryBaseDelayMs,
      runQuery: () => runQuery(chunk),
    }),
  );
  return counts.reduce((sum, value) => sum + value, 0);
}
