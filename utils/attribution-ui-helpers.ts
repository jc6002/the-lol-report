import type { AppSelectOption } from "@/utils/app-select-helpers";
import type { AttributionLeaderboardRow } from "@/utils/attribution-stats";
import type { StudyExposureMode } from "@/utils/study-exposure-adapter";
import type {
  StudyCatalogEntry,
  StudyLifecycleStatus,
  StudySearchResponse,
} from "@/utils/study-lineage-loader";

export type StudySubNavTab = "attribution" | "demographics" | "head-to-head";

export type AttributionGroupBy = "flavor" | "model" | "pipeline";

export type HubWorkspaceTab = "studies" | "flavors" | "models";
export type HubStudyScope = "all" | "scored" | "benchmarks";
export type HubStatusFilter = "all" | StudyLifecycleStatus;
export type HubFormatFilter = "all" | "Swipe" | "Likert" | "Rating scale";
export type HubSortMode =
  | "newest_scored"
  | "newest"
  | "most_flavors"
  | "most_votes"
  | "highest_positive_rate"
  | "most_runs"
  | "highest_completion"
  | "most_captions";

export type SearchSectionId =
  | "studies"
  | "flavors"
  | "models"
  | "reports"
  | "flavors_untested"
  | "models_untested";

export type FlatSearchItem = {
  key: string;
  section: SearchSectionId;
  href: string | null;
  codeBadge: string | null;
  primaryLabel: string;
  secondaryLabel: string | null;
  rightMeta: string;
};

export type LatencyScatterPoint = {
  key: string;
  label: string;
  exposures: number;
  positive: number;
  captionCount: number;
  positiveRatePct: number;
  ciLowPct: number;
  ciHighPct: number;
  medianChainSeconds: number;
};

export type LeaderboardSortKey =
  | "label"
  | "captionCount"
  | "exposures"
  | "ciLow"
  | "meanLiftPp"
  | "medianChainSeconds"
  | "medianDwellMs";

export type LeaderboardSortDirection = "asc" | "desc";

export type ResolvedUrlEntityFocus = {
  matchedKey: string | null;
  matchedLabel: string | null;
  missingEntityKind: "flavor" | "model" | null;
};

export type SearchHttpClassification = "ok" | "unauthorized" | "offline";

export type RichStudySearchResponse = {
  query?: string;
  studies: Array<
    StudySearchResponse["studies"][number] & {
      formatDisplayLabel?: "Swipe" | "Rating scale";
      flavorCount?: number;
      modelCount?: number;
      voterCount?: number;
      exposureCount?: number;
      positiveRate?: number | null;
      isBenchmark?: boolean;
    }
  >;
  flavors: Array<
    StudySearchResponse["flavors"][number] & {
      exposures?: number;
      positiveRate?: number | null;
    }
  >;
  models: Array<
    StudySearchResponse["models"][number] & {
      exposures?: number;
      positiveRate?: number | null;
      primaryRole?: "synthesis" | "pipeline_step" | null;
    }
  >;
  reports: StudySearchResponse["reports"];
};

export type ResolvedSearchModalState = {
  trimmedQuery: string;
  isEmptyQuery: boolean;
  isPendingQuery: boolean;
  activePayload: RichStudySearchResponse | null;
  allowEnterSelection: boolean;
};

export type FilterableStudyDirectoryRow = StudyCatalogEntry & {
  flavorCount?: number;
  modelCount?: number;
  flavorSlugs?: readonly string[];
  modelNames?: readonly string[];
  voterCount?: number;
  exposureCount?: number;
  positiveRate?: number | null;
  ciLow?: number | null;
  sharedImagePairCount?: number;
  formatDisplayLabel?: "Swipe" | "Rating scale";
};

export type StudySwitcherSummaryLike = {
  id: number;
  slug: string | null;
  description: string | null;
  title?: string;
  formatDisplayLabel?: "Swipe" | "Rating scale";
  flavorCount?: number;
  modelCount?: number;
  voterCount?: number;
  exposureCount?: number;
  positiveRate?: number | null;
  flavorSlugs?: readonly string[];
  modelNames?: readonly string[];
};

const SHORT_MONTH_NAMES = [
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

const PRESERVED_UPPERCASE_TOKENS: ReadonlyMap<string, string> = new Map([
  ["ai", "AI"],
  ["gpt", "GPT"],
  ["llm", "LLM"],
  ["qa", "QA"],
  ["ui", "UI"],
  ["ux", "UX"],
  ["id", "ID"],
]);

const QUICK_STUDY_BOILERPLATE_PREFIX = "created with quick study";

const titleCaseSlugPhrase = (rawPhrase: string): string => {
  const words = rawPhrase
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  return words
    .map((word) => {
      const lower = word.toLowerCase();
      const acronym = PRESERVED_UPPERCASE_TOKENS.get(lower);
      if (acronym) {
        return acronym;
      }
      if (/^v\d+$/i.test(word)) {
        return word.toUpperCase();
      }
      if (/^\d/.test(word)) {
        return lower;
      }
      return `${word.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
};

const formatMonthDayLabel = (monthNum: number, dayNum: number): string | null => {
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    return null;
  }
  return `${SHORT_MONTH_NAMES[monthNum - 1]} ${dayNum}`;
};

export function extractCustomStudyDescription(
  description: string | null | undefined,
  currentTitle?: string,
): string | null {
  const trimmed = description?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toLowerCase().startsWith(QUICK_STUDY_BOILERPLATE_PREFIX)) {
    return null;
  }
  if (
    currentTitle &&
    trimmed.toLowerCase() === currentTitle.trim().toLowerCase()
  ) {
    return null;
  }
  return trimmed;
}

export function formatFriendlyStudyTitle(study: {
  id: number;
  slug: string | null;
  description: string | null;
}): string {
  const slug = study.slug?.trim() ?? "";
  if (slug.length === 0) {
    const customDesc = extractCustomStudyDescription(study.description);
    const fallbackDesc = study.description?.trim();
    return customDesc ?? (fallbackDesc || `Study ${study.id}`);
  }

  // ISO date slugs such as "2026-04-17" or "2026-04-21-extra-credit".
  const isoMatch = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:-(.+))?$/.exec(
    slug,
  );
  if (isoMatch) {
    const year = isoMatch[1];
    const monthDay = formatMonthDayLabel(
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
    const remainder = isoMatch[4]?.trim() ?? "";
    const dateLabel = monthDay ? `${monthDay}, ${year}` : `${year}-${isoMatch[2]}-${isoMatch[3]}`;
    if (remainder.length === 0) {
      return dateLabel;
    }
    return `${titleCaseSlugPhrase(remainder)} · ${dateLabel}`;
  }

  // Quick-study month-day slugs such as "10-10-22-captions-multi-person-scene-sad-girl-4"
  // or "10-12--0--first-day-intern-energy" or bare "09-27c".
  const mmddMatch = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:([a-z])|(?:--?\d+--?|-)(.+))?$/i.exec(
    slug,
  );
  if (mmddMatch) {
    const monthDay = formatMonthDayLabel(
      Number(mmddMatch[1]),
      Number(mmddMatch[2]),
    );
    const letterSuffix = mmddMatch[3];
    const rawRest = mmddMatch[4]?.trim() ?? "";
    if (rawRest.length === 0) {
      if (monthDay) {
        return letterSuffix ? `${monthDay} (${letterSuffix})` : monthDay;
      }
      return slug;
    }
    const stripped = rawRest.replace(/^(?:\d+-)?captions-/i, "");
    const phrase = titleCaseSlugPhrase(stripped.length > 0 ? stripped : rawRest);
    return monthDay ? `${phrase} · ${monthDay}` : phrase;
  }

  const cleaned = titleCaseSlugPhrase(slug);
  return cleaned.length > 0 ? cleaned : slug;
}

export function formatCompactCount(count: number): string {
  if (!Number.isFinite(count)) {
    return "0";
  }
  const abs = Math.abs(count);
  if (abs >= 1_000_000) {
    const scaled = count / 1_000_000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    const scaled = count / 1_000;
    return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return Math.round(count).toLocaleString();
}

export function resolveHubWorkspaceTab(
  rawTab?: string,
  flavorParam?: string,
  modelParam?: string,
): HubWorkspaceTab {
  const normalized = rawTab?.trim().toLowerCase();
  if (
    normalized === "studies" ||
    normalized === "flavors" ||
    normalized === "models"
  ) {
    return normalized;
  }
  if (flavorParam?.trim()) {
    return "flavors";
  }
  if (modelParam?.trim()) {
    return "models";
  }
  return "studies";
}

export function classifySearchHttpResponse(meta: {
  status: number;
  ok: boolean;
  redirected: boolean;
  type?: string;
  url?: string;
  contentType?: string | null;
}): SearchHttpClassification {
  if (
    meta.type === "opaqueredirect" ||
    meta.status === 401 ||
    meta.status === 403 ||
    meta.redirected
  ) {
    return "unauthorized";
  }

  if (meta.url) {
    try {
      const parsed = new URL(meta.url, "http://localhost");
      if (parsed.pathname === "/login" || parsed.pathname.startsWith("/login/")) {
        return "unauthorized";
      }
    } catch {
      // Ignore malformed candidate URL and inspect status/content-type below.
    }
  }

  if (!meta.ok) {
    return "offline";
  }

  const normalizedType = (meta.contentType ?? "").toLowerCase();
  if (!normalizedType.includes("application/json")) {
    return "offline";
  }

  return "ok";
}

export function resolveSearchModalState({
  searchQuery,
  remoteResults,
  searchError,
  initialSearch,
}: {
  searchQuery: string;
  remoteResults: { query: string; response: RichStudySearchResponse } | null;
  searchError: "offline" | "unauthorized" | null;
  initialSearch: RichStudySearchResponse;
}): ResolvedSearchModalState {
  const trimmedQuery = searchQuery.trim();
  if (trimmedQuery.length === 0) {
    return {
      trimmedQuery: "",
      isEmptyQuery: true,
      isPendingQuery: false,
      activePayload: initialSearch,
      allowEnterSelection: true,
    };
  }

  if (searchError !== null) {
    return {
      trimmedQuery,
      isEmptyQuery: false,
      isPendingQuery: false,
      activePayload: null,
      allowEnterSelection: false,
    };
  }

  // Strictly block stale default items (#123) or previous-query items whenever
  // the resolved network response does not match the current trimmed input.
  if (remoteResults === null || remoteResults.query !== trimmedQuery) {
    return {
      trimmedQuery,
      isEmptyQuery: false,
      isPendingQuery: true,
      activePayload: null,
      allowEnterSelection: false,
    };
  }

  return {
    trimmedQuery,
    isEmptyQuery: false,
    isPendingQuery: false,
    activePayload: remoteResults.response,
    allowEnterSelection: true,
  };
}

export function parsePositiveStudyId(rawId: string): number | null {
  const trimmed = rawId.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export function isTruthyFlagParam(
  rawValue: string | string[] | undefined,
): boolean {
  const first = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (!first) {
    return false;
  }
  const normalized = first.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function getFirstQueryParam(
  rawValue: string | string[] | undefined,
): string | undefined {
  const first = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  return typeof first === "string" ? first : undefined;
}

export function formatLifecycleStatusLabel(
  status: StudyLifecycleStatus,
): string {
  switch (status) {
    case "active":
      return "Active";
    case "scheduled":
      return "Scheduled";
    case "closed":
      return "Closed";
  }
}

export function formatHubPercent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) {
    return "—";
  }
  return `${(rate * 100).toFixed(1)}%`;
}

export const formatRatePercent = formatHubPercent;

const formatSearchStudyRightMeta = (
  study: RichStudySearchResponse["studies"][number],
): string => {
  const formatName =
    study.formatDisplayLabel ??
    (study.formatLabel === "Likert" ? "Rating scale" : study.formatLabel);

  if (study.exposureCount !== undefined) {
    if (study.exposureCount <= 0) {
      return `${formatName} · 0 votes`;
    }
    const parts: string[] = [];
    if (study.flavorCount !== undefined && study.flavorCount > 0) {
      parts.push(
        `${study.flavorCount} ${study.flavorCount === 1 ? "flavor" : "flavors"}`,
      );
    }
    if (study.voterCount !== undefined && study.voterCount > 0) {
      parts.push(
        `${formatCompactCount(study.voterCount)} ${study.voterCount === 1 ? "voter" : "voters"}`,
      );
    }
    if (study.positiveRate !== null && study.positiveRate !== undefined) {
      parts.push(formatHubPercent(study.positiveRate));
    }
    if (parts.length > 0) {
      return parts.join(" · ");
    }
  }

  return `${formatLifecycleStatusLabel(study.status)} · ${formatName}`;
};

export function flattenSearchResponse(
  response: RichStudySearchResponse,
  isEmptyQuery: boolean,
): Array<{
  section: SearchSectionId;
  heading: string;
  items: FlatSearchItem[];
}> {
  const evaluatedFlavors = response.flavors.filter(
    (flavor) => flavor.studyCount > 0 && flavor.href !== null,
  );
  const untestedFlavors = response.flavors.filter(
    (flavor) => flavor.studyCount <= 0 || flavor.href === null,
  );

  const evaluatedModels = response.models.filter(
    (model) => model.studyCount > 0 && model.href !== null,
  );
  const untestedModels = response.models.filter(
    (model) => model.studyCount <= 0 || model.href === null,
  );

  const groups: Array<{
    section: SearchSectionId;
    heading: string;
    items: FlatSearchItem[];
  }> = [
    {
      section: "studies",
      heading: isEmptyQuery ? "Featured & Scored Studies" : "Studies",
      items: response.studies.map((study) => ({
        key: `study-${study.id}`,
        section: "studies",
        href: study.href,
        codeBadge: `#${study.id}`,
        primaryLabel: study.title,
        secondaryLabel: study.isBenchmark ? "Benchmark" : null,
        rightMeta: formatSearchStudyRightMeta(study),
      })),
    },
    {
      section: "flavors",
      heading: "Prompt Flavors",
      items: evaluatedFlavors.map((flavor) => {
        const countLabel = `${flavor.studyCount} ${flavor.studyCount === 1 ? "study" : "studies"}`;
        const rateSuffix =
          flavor.positiveRate !== null && flavor.positiveRate !== undefined
            ? ` · ${formatHubPercent(flavor.positiveRate)}`
            : flavor.latestStudyId !== null
              ? ` · Latest #${flavor.latestStudyId}`
              : "";
        return {
          key: `flavor-${flavor.id}`,
          section: "flavors",
          href: flavor.href,
          codeBadge: null,
          primaryLabel: flavor.slug,
          secondaryLabel: flavor.description,
          rightMeta: `${countLabel}${rateSuffix}`,
        };
      }),
    },
    {
      section: "models",
      heading: "Models",
      items: evaluatedModels.map((model) => {
        const countLabel = `${model.studyCount} ${model.studyCount === 1 ? "study" : "studies"}`;
        const rateSuffix =
          model.positiveRate !== null && model.positiveRate !== undefined
            ? ` · ${formatHubPercent(model.positiveRate)}`
            : model.latestStudyId !== null
              ? ` · Latest #${model.latestStudyId}`
              : "";
        return {
          key: `model-${model.id}`,
          section: "models",
          href: model.href,
          codeBadge: null,
          primaryLabel: model.name,
          secondaryLabel: model.providerModelId,
          rightMeta: `${model.providerName} · ${countLabel}${rateSuffix}`,
        };
      }),
    },
    {
      section: "reports",
      heading: isEmptyQuery ? "Leaderboards & Views" : "Views & Reports",
      items: response.reports.map((report) => ({
        key: `report-${report.href}`,
        section: "reports",
        href: report.href,
        codeBadge: null,
        primaryLabel: report.label,
        secondaryLabel: null,
        rightMeta: report.href.startsWith("/reports/") ? "Classic" : "View",
      })),
    },
    {
      section: "flavors_untested",
      heading: "Not Yet Evaluated · Prompt Flavors",
      items: untestedFlavors.map((flavor) => ({
        key: `flavor-${flavor.id}`,
        section: "flavors_untested",
        href: null,
        codeBadge: null,
        primaryLabel: flavor.slug,
        secondaryLabel: flavor.description,
        rightMeta: "0 study runs",
      })),
    },
    {
      section: "models_untested",
      heading: "Not Yet Evaluated · Models",
      items: untestedModels.map((model) => ({
        key: `model-${model.id}`,
        section: "models_untested",
        href: null,
        codeBadge: null,
        primaryLabel: model.name,
        secondaryLabel: model.providerModelId,
        rightMeta: `${model.providerName} · 0 study runs`,
      })),
    },
  ];

  return groups.filter((group) => group.items.length > 0);
}

const matchesFormatFilter = (
  row: FilterableStudyDirectoryRow,
  formatFilter: HubFormatFilter,
): boolean => {
  if (formatFilter === "all") {
    return true;
  }
  if (formatFilter === "Swipe") {
    return row.formatLabel === "Swipe" || row.formatDisplayLabel === "Swipe";
  }
  return (
    row.formatLabel === "Likert" || row.formatDisplayLabel === "Rating scale"
  );
};

const getEffectiveExposureCount = (row: FilterableStudyDirectoryRow): number =>
  row.exposureCount ?? row.participationsStarted;

export function filterAndSortStudyDirectory<
  TRow extends FilterableStudyDirectoryRow = StudyCatalogEntry,
>({
  studies,
  searchQuery,
  statusFilter,
  formatFilter,
  sortMode,
  scopeFilter = "all",
}: {
  studies: readonly TRow[];
  searchQuery: string;
  statusFilter: HubStatusFilter;
  formatFilter: HubFormatFilter;
  sortMode: HubSortMode;
  scopeFilter?: HubStudyScope;
}): TRow[] {
  const trimmed = searchQuery.trim().toLowerCase();
  const hasExplicitIdPrefix = trimmed.startsWith("#");
  const numericTerm = hasExplicitIdPrefix ? trimmed.slice(1) : trimmed;

  const filtered = studies.filter((row) => {
    if (scopeFilter === "scored" && getEffectiveExposureCount(row) <= 0) {
      return false;
    }
    if (
      scopeFilter === "benchmarks" &&
      ((row.flavorCount ?? 0) < 2 || getEffectiveExposureCount(row) <= 0)
    ) {
      return false;
    }
    if (statusFilter !== "all" && row.status !== statusFilter) {
      return false;
    }
    if (!matchesFormatFilter(row, formatFilter)) {
      return false;
    }
    if (trimmed.length === 0) {
      return true;
    }
    if (hasExplicitIdPrefix) {
      return numericTerm.length > 0 && String(row.id) === numericTerm;
    }
    if (String(row.id) === numericTerm || String(row.id).includes(numericTerm)) {
      return true;
    }
    if (row.title.toLowerCase().includes(trimmed)) {
      return true;
    }
    if (row.slug?.toLowerCase().includes(trimmed)) {
      return true;
    }
    if (row.description?.toLowerCase().includes(trimmed)) {
      return true;
    }
    if (
      row.flavorSlugs?.some((slug) => slug.toLowerCase().includes(trimmed))
    ) {
      return true;
    }
    if (
      row.modelNames?.some((name) => name.toLowerCase().includes(trimmed))
    ) {
      return true;
    }
    return false;
  });

  filtered.sort((left, right) => {
    if (sortMode === "newest_scored") {
      const leftScored = getEffectiveExposureCount(left) > 0 ? 1 : 0;
      const rightScored = getEffectiveExposureCount(right) > 0 ? 1 : 0;
      if (leftScored !== rightScored) {
        return rightScored - leftScored;
      }
      return right.id - left.id;
    }

    if (sortMode === "most_flavors") {
      const leftScored = getEffectiveExposureCount(left) > 0 ? 1 : 0;
      const rightScored = getEffectiveExposureCount(right) > 0 ? 1 : 0;
      if (leftScored !== rightScored) {
        return rightScored - leftScored;
      }
      const leftFlavors = left.flavorCount ?? 0;
      const rightFlavors = right.flavorCount ?? 0;
      if (leftFlavors !== rightFlavors) {
        return rightFlavors - leftFlavors;
      }
      const leftPairs = left.sharedImagePairCount ?? 0;
      const rightPairs = right.sharedImagePairCount ?? 0;
      if (leftPairs !== rightPairs) {
        return rightPairs - leftPairs;
      }
      const leftExp = getEffectiveExposureCount(left);
      const rightExp = getEffectiveExposureCount(right);
      if (leftExp !== rightExp) {
        return rightExp - leftExp;
      }
    } else if (sortMode === "most_votes") {
      const leftExp = getEffectiveExposureCount(left);
      const rightExp = getEffectiveExposureCount(right);
      if (leftExp !== rightExp) {
        return rightExp - leftExp;
      }
      const leftVoters = left.voterCount ?? 0;
      const rightVoters = right.voterCount ?? 0;
      if (leftVoters !== rightVoters) {
        return rightVoters - leftVoters;
      }
    } else if (sortMode === "highest_positive_rate") {
      const leftLow = left.ciLow ?? left.positiveRate ?? -1;
      const rightLow = right.ciLow ?? right.positiveRate ?? -1;
      if (leftLow !== rightLow) {
        return rightLow - leftLow;
      }
      const leftRate = left.positiveRate ?? -1;
      const rightRate = right.positiveRate ?? -1;
      if (leftRate !== rightRate) {
        return rightRate - leftRate;
      }
    } else if (sortMode === "most_runs") {
      if (left.participationsStarted !== right.participationsStarted) {
        return right.participationsStarted - left.participationsStarted;
      }
      if (left.participationsEnded !== right.participationsEnded) {
        return right.participationsEnded - left.participationsEnded;
      }
    } else if (sortMode === "highest_completion") {
      const leftRate = left.completionRate ?? -1;
      const rightRate = right.completionRate ?? -1;
      if (leftRate !== rightRate) {
        return rightRate - leftRate;
      }
      if (left.participationsStarted !== right.participationsStarted) {
        return right.participationsStarted - left.participationsStarted;
      }
    } else if (sortMode === "most_captions") {
      if (left.captionCount !== right.captionCount) {
        return right.captionCount - left.captionCount;
      }
    }
    return right.id - left.id;
  });

  return filtered;
}

export function formatStudyHeaderLabel(study: {
  id: number;
  slug: string | null;
  description: string | null;
}): string {
  const friendly = formatFriendlyStudyTitle(study);
  if (friendly === `Study ${study.id}`) {
    return friendly;
  }
  return `#${study.id} · ${friendly}`;
}

export function formatStudySwitcherOption(
  study: StudySwitcherSummaryLike,
): AppSelectOption<string> {
  const title = study.title ?? formatFriendlyStudyTitle(study);
  const baseLabel =
    title === `Study ${study.id}` ? title : `#${study.id} · ${title}`;

  let metaSuffix = "";
  if (study.exposureCount !== undefined) {
    if (study.exposureCount <= 0) {
      metaSuffix = " (0 votes)";
    } else {
      const metaParts: string[] = [];
      if (study.flavorCount !== undefined && study.flavorCount > 0) {
        metaParts.push(
          `${study.flavorCount} ${study.flavorCount === 1 ? "flavor" : "flavors"}`,
        );
      }
      if (study.voterCount !== undefined && study.voterCount > 0) {
        metaParts.push(
          `${formatCompactCount(study.voterCount)} ${study.voterCount === 1 ? "voter" : "voters"}`,
        );
      }
      if (metaParts.length > 0) {
        metaSuffix = ` (${metaParts.join(" · ")})`;
      }
    }
  }

  const searchTokens: string[] = [`#${study.id}`];
  if (study.slug) {
    searchTokens.push(study.slug);
  }
  if (study.description) {
    searchTokens.push(study.description);
  }
  if (study.formatDisplayLabel) {
    searchTokens.push(study.formatDisplayLabel);
  }
  if (study.flavorCount !== undefined) {
    searchTokens.push(
      `${study.flavorCount} ${study.flavorCount === 1 ? "flavor" : "flavors"}`,
    );
  }
  if (study.flavorSlugs) {
    searchTokens.push(...study.flavorSlugs);
  }
  if (study.modelNames) {
    searchTokens.push(...study.modelNames);
  }

  return {
    value: String(study.id),
    label: `${baseLabel}${metaSuffix}`,
    searchText: searchTokens.join(" "),
  };
}

export function buildClassicStudyReportOptions({
  studyId,
  exposureMode,
}: {
  studyId: number;
  exposureMode: StudyExposureMode;
}): AppSelectOption<string>[] {
  const options: AppSelectOption<string>[] = [
    { value: `/study/${studyId}/study-detail`, label: "Study Detail" },
  ];

  // Strictly gate Swipe Report on resolved exposureMode === "swipe_navigation"
  // (never studyId >= 7) so transitional Likert studies #7..#21 never expose
  // the 0-user / n/a legacy swipe report route.
  if (exposureMode === "swipe_navigation") {
    options.push({
      value: `/study/${studyId}/new-style-report`,
      label: "Swipe Report",
    });
  }

  options.push(
    { value: `/study/${studyId}/engagement-risk`, label: "Engagement Risk" },
    { value: `/study/${studyId}/vote-timing`, label: "Vote Timing" },
    { value: `/study/${studyId}/user-upvote-rate`, label: "Upvote by User" },
    { value: `/study/${studyId}/selected-user-report`, label: "Selected Users" },
  );

  return options;
}

export function buildStudioTabHref(
  studyId: number,
  tab: StudySubNavTab,
  excludeHighRisk: boolean,
  flavorParam?: string | null,
): string {
  const base = `/study/${studyId}/${tab}`;
  const params = new URLSearchParams();
  const trimmedFlavor = flavorParam?.trim();
  if (trimmedFlavor) {
    params.set("flavor", trimmedFlavor);
  }
  if (excludeHighRisk) {
    params.set("excludeHighRisk", "1");
  }
  const query = params.toString();
  return query.length > 0 ? `${base}?${query}` : base;
}

export function formatChainSecondsLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "—";
  }
  if (seconds > 0 && seconds < 0.05) {
    return "<0.1s";
  }
  return `${seconds.toFixed(1)}s`;
}

export function buildLatencyScatterPoints(
  rows: readonly AttributionLeaderboardRow[],
): LatencyScatterPoint[] {
  const points: LatencyScatterPoint[] = [];
  for (const row of rows) {
    if (
      row.isUnattributed ||
      row.exposures <= 0 ||
      row.rate === null ||
      row.ciLow === null ||
      row.ciHigh === null ||
      row.medianChainSeconds === null
    ) {
      continue;
    }
    points.push({
      key: row.key,
      label: row.label,
      exposures: row.exposures,
      positive: row.positive,
      captionCount: row.captionCount,
      positiveRatePct: Number((row.rate * 100).toFixed(2)),
      ciLowPct: Number((row.ciLow * 100).toFixed(2)),
      ciHighPct: Number((row.ciHigh * 100).toFixed(2)),
      medianChainSeconds: row.medianChainSeconds,
    });
  }
  return points;
}

export function resolveInitialGroupBy(
  groupByParam?: string,
  flavorParam?: string,
  modelParam?: string,
): AttributionGroupBy {
  const normalized = groupByParam?.trim().toLowerCase();
  if (
    normalized === "flavor" ||
    normalized === "model" ||
    normalized === "pipeline"
  ) {
    return normalized;
  }
  if (!flavorParam?.trim() && modelParam?.trim()) {
    return "model";
  }
  return "flavor";
}

export function resolveUrlEntityFocus({
  flavorParam,
  modelParam,
  flavors,
  models,
}: {
  flavorParam?: string;
  modelParam?: string;
  flavors: readonly AttributionLeaderboardRow[];
  models: readonly AttributionLeaderboardRow[];
}): ResolvedUrlEntityFocus {
  const trimmedFlavor = flavorParam?.trim();
  if (trimmedFlavor) {
    const lower = trimmedFlavor.toLowerCase();
    const matched = flavors.find(
      (row) =>
        !row.isUnattributed &&
        (String(row.flavorId) === trimmedFlavor ||
          row.label.toLowerCase() === lower),
    );
    if (matched) {
      return {
        matchedKey: matched.key,
        matchedLabel: matched.label,
        missingEntityKind: null,
      };
    }
    return {
      matchedKey: null,
      matchedLabel: null,
      missingEntityKind: "flavor",
    };
  }

  const trimmedModel = modelParam?.trim();
  if (trimmedModel) {
    const lower = trimmedModel.toLowerCase();
    const matched = models.find(
      (row) =>
        !row.isUnattributed &&
        (String(row.modelId) === trimmedModel ||
          row.label.toLowerCase() === lower),
    );
    if (matched) {
      return {
        matchedKey: matched.key,
        matchedLabel: matched.label,
        missingEntityKind: null,
      };
    }
    return {
      matchedKey: null,
      matchedLabel: null,
      missingEntityKind: "model",
    };
  }

  return {
    matchedKey: null,
    matchedLabel: null,
    missingEntityKind: null,
  };
}

export function formatSignedLiftPp(liftPp: number | null): string {
  if (liftPp === null || !Number.isFinite(liftPp)) {
    return "—";
  }
  const rounded = Number(liftPp.toFixed(1));
  if (rounded >= 0) {
    return `+${Math.abs(rounded).toFixed(1)} pp`;
  }
  return `-${Math.abs(rounded).toFixed(1)} pp`;
}

export function getLiftToneClassName(liftPp: number | null): string {
  if (liftPp === null || !Number.isFinite(liftPp)) {
    return "app-muted";
  }
  if (liftPp > 0.5) {
    return "text-emerald-800 dark:text-emerald-300";
  }
  if (liftPp < -0.5) {
    return "text-rose-800 dark:text-rose-300";
  }
  return "text-foreground";
}

export function formatDwellDurationLabel(dwellMs: number | null): string {
  if (dwellMs === null || !Number.isFinite(dwellMs)) {
    return "—";
  }
  if (dwellMs < 1_000) {
    return `${Math.round(dwellMs)}ms`;
  }
  if (dwellMs < 60_000) {
    return `${(dwellMs / 1_000).toFixed(1)}s`;
  }
  const totalSeconds = Math.round(dwellMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function getDefaultLeaderboardSortDirection(
  column: LeaderboardSortKey,
): LeaderboardSortDirection {
  switch (column) {
    case "label":
    case "medianChainSeconds":
    case "medianDwellMs":
      return "asc";
    default:
      return "desc";
  }
}

const compareNonNullWithDirection = (
  left: number | null,
  right: number | null,
  direction: LeaderboardSortDirection,
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
  if (left === right) {
    return 0;
  }
  return direction === "asc" ? left - right : right - left;
};

export function filterAndSortLeaderboardRows({
  rows,
  searchQuery,
  pinnedEntityKey,
  sortBy,
  sortDirection,
}: {
  rows: readonly AttributionLeaderboardRow[];
  searchQuery: string;
  pinnedEntityKey: string | null;
  sortBy: LeaderboardSortKey;
  sortDirection: LeaderboardSortDirection;
}): AttributionLeaderboardRow[] {
  const trimmed = searchQuery.trim().toLowerCase();

  const filtered = rows.filter((row) => {
    if (pinnedEntityKey !== null) {
      return row.key === pinnedEntityKey;
    }
    if (trimmed.length === 0) {
      return true;
    }
    if (row.label.toLowerCase().includes(trimmed)) {
      return true;
    }
    if (row.subtitle?.toLowerCase().includes(trimmed)) {
      return true;
    }
    if (row.dominantModelLabel?.toLowerCase().includes(trimmed)) {
      return true;
    }
    if (
      row.pipelineSteps.some((step) => step.toLowerCase().includes(trimmed))
    ) {
      return true;
    }
    return false;
  });

  return [...filtered].sort((left, right) => {
    if (left.isUnattributed !== right.isUnattributed) {
      return left.isUnattributed ? 1 : -1;
    }

    let cmp = 0;
    switch (sortBy) {
      case "label": {
        const raw = left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
        });
        cmp = sortDirection === "asc" ? raw : -raw;
        break;
      }
      case "captionCount":
        cmp =
          sortDirection === "asc"
            ? left.captionCount - right.captionCount
            : right.captionCount - left.captionCount;
        break;
      case "exposures":
        cmp =
          sortDirection === "asc"
            ? left.exposures - right.exposures
            : right.exposures - left.exposures;
        break;
      case "ciLow":
        cmp = compareNonNullWithDirection(
          left.ciLow,
          right.ciLow,
          sortDirection,
        );
        if (cmp === 0) {
          cmp = compareNonNullWithDirection(
            left.rate,
            right.rate,
            sortDirection,
          );
        }
        break;
      case "meanLiftPp":
        cmp = compareNonNullWithDirection(
          left.meanLiftPp,
          right.meanLiftPp,
          sortDirection,
        );
        break;
      case "medianChainSeconds":
        cmp = compareNonNullWithDirection(
          left.medianChainSeconds,
          right.medianChainSeconds,
          sortDirection,
        );
        break;
      case "medianDwellMs":
        cmp = compareNonNullWithDirection(
          left.medianDwellMs,
          right.medianDwellMs,
          sortDirection,
        );
        break;
    }

    if (cmp !== 0) {
      return cmp;
    }
    if (left.exposures !== right.exposures) {
      return right.exposures - left.exposures;
    }
    return left.label.localeCompare(right.label);
  });
}
