import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AttributionLeaderboardRow } from "@/utils/attribution-stats";
import {
  buildClassicStudyReportOptions,
  buildLatencyScatterPoints,
  buildStudioTabHref,
  classifySearchHttpResponse,
  extractCustomStudyDescription,
  filterAndSortLeaderboardRows,
  filterAndSortStudyDirectory,
  type FilterableStudyDirectoryRow,
  flattenSearchResponse,
  formatChainSecondsLabel,
  formatCompactCount,
  formatDwellDurationLabel,
  formatFriendlyStudyTitle,
  formatHubPercent,
  formatLifecycleStatusLabel,
  formatSignedLiftPp,
  formatStudyHeaderLabel,
  formatStudySwitcherOption,
  getDefaultLeaderboardSortDirection,
  getFirstQueryParam,
  getLiftToneClassName,
  isTruthyFlagParam,
  parsePositiveStudyId,
  resolveHubWorkspaceTab,
  resolveInitialGroupBy,
  resolveSearchModalState,
  resolveUrlEntityFocus,
  type RichStudySearchResponse,
} from "@/utils/attribution-ui-helpers";

const makeCatalogRow = (
  overrides: Partial<FilterableStudyDirectoryRow> & { id: number; title: string },
): FilterableStudyDirectoryRow => ({
  id: overrides.id,
  slug: overrides.slug ?? overrides.title,
  title: overrides.title,
  description: overrides.description ?? null,
  start_datetime_utc: overrides.start_datetime_utc ?? "2026-10-01T00:00:00Z",
  end_datetime_utc: overrides.end_datetime_utc ?? "2026-10-05T00:00:00Z",
  created_datetime_utc:
    overrides.created_datetime_utc ?? "2026-10-01T00:00:00Z",
  is_hidden: overrides.is_hidden ?? false,
  is_private: overrides.is_private ?? false,
  status: overrides.status ?? "closed",
  exposureMode: overrides.exposureMode ?? "swipe_navigation",
  isTransitionalLikert: overrides.isTransitionalLikert ?? false,
  formatLabel: overrides.formatLabel ?? "Swipe",
  formatDisplayLabel:
    overrides.formatDisplayLabel ??
    ((overrides.formatLabel ?? "Swipe") === "Swipe" ? "Swipe" : "Rating scale"),
  detailHref: overrides.detailHref ?? `/study/${overrides.id}/new-style-report`,
  captionCount: overrides.captionCount ?? 40,
  participationsStarted: overrides.participationsStarted ?? 100,
  participationsEnded: overrides.participationsEnded ?? 70,
  completionRate:
    overrides.completionRate !== undefined ? overrides.completionRate : 0.7,
  medianRunMinutes:
    overrides.medianRunMinutes !== undefined ? overrides.medianRunMinutes : 3.5,
  flavorCount: overrides.flavorCount,
  modelCount: overrides.modelCount,
  flavorSlugs: overrides.flavorSlugs,
  modelNames: overrides.modelNames,
  voterCount: overrides.voterCount,
  exposureCount: overrides.exposureCount,
  positiveRate: overrides.positiveRate,
  ciLow: overrides.ciLow,
  sharedImagePairCount: overrides.sharedImagePairCount,
});

const makeLeaderboardRow = (
  overrides: Partial<AttributionLeaderboardRow> & {
    key: string;
    label: string;
  },
): AttributionLeaderboardRow => ({
  key: overrides.key,
  kind: overrides.kind ?? "flavor",
  isUnattributed: overrides.isUnattributed ?? false,
  flavorId: overrides.flavorId ?? null,
  modelId: overrides.modelId ?? null,
  label: overrides.label,
  subtitle: overrides.subtitle ?? null,
  stepCount: overrides.stepCount ?? 3,
  dominantModelLabel: overrides.dominantModelLabel ?? null,
  pipelineSteps: overrides.pipelineSteps ?? [],
  flavorCount: overrides.flavorCount ?? 1,
  captionCount: overrides.captionCount ?? 10,
  exposures: overrides.exposures ?? 100,
  positive: overrides.positive ?? 40,
  rate: overrides.rate !== undefined ? overrides.rate : 0.4,
  ciLow: overrides.ciLow !== undefined ? overrides.ciLow : 0.31,
  ciHigh: overrides.ciHigh !== undefined ? overrides.ciHigh : 0.49,
  sharedImageCount: overrides.sharedImageCount ?? 0,
  imageBaselineMean: overrides.imageBaselineMean ?? null,
  meanLift: overrides.meanLift ?? null,
  meanLiftPp: overrides.meanLiftPp !== undefined ? overrides.meanLiftPp : null,
  pairWins: overrides.pairWins ?? 0,
  pairLosses: overrides.pairLosses ?? 0,
  pairTies: overrides.pairTies ?? 0,
  pairWinRate: overrides.pairWinRate ?? null,
  medianChainSeconds:
    overrides.medianChainSeconds !== undefined
      ? overrides.medianChainSeconds
      : 4.2,
  medianDwellMs:
    overrides.medianDwellMs !== undefined ? overrides.medianDwellMs : 1850,
});

describe("URL, friendly title, workspace tab, and Classic Reports helpers", () => {
  it("parses strictly positive integer study IDs and rejects invalid segments", () => {
    assert.equal(parsePositiveStudyId("1"), 1);
    assert.equal(parsePositiveStudyId(" 122 "), 122);
    assert.equal(parsePositiveStudyId("0"), null);
    assert.equal(parsePositiveStudyId("-5"), null);
    assert.equal(parsePositiveStudyId("122abc"), null);
    assert.equal(parsePositiveStudyId("01"), null);
    assert.equal(parsePositiveStudyId(""), null);
    assert.equal(parsePositiveStudyId("999999999999999999999"), null);
  });

  it("extracts truthy query flags, first query params, and workspace tab selection", () => {
    assert.equal(isTruthyFlagParam("1"), true);
    assert.equal(isTruthyFlagParam("true"), true);
    assert.equal(isTruthyFlagParam([" TRUE ", "0"]), true);
    assert.equal(isTruthyFlagParam("0"), false);
    assert.equal(isTruthyFlagParam("false"), false);
    assert.equal(isTruthyFlagParam(undefined), false);

    assert.equal(getFirstQueryParam("flavor"), "flavor");
    assert.equal(getFirstQueryParam(["a", "b"]), "a");
    assert.equal(getFirstQueryParam([]), undefined);
    assert.equal(getFirstQueryParam(undefined), undefined);

    assert.equal(resolveHubWorkspaceTab("flavors"), "flavors");
    assert.equal(resolveHubWorkspaceTab("MODELS"), "models");
    assert.equal(resolveHubWorkspaceTab("studies", "x", "y"), "studies");
    assert.equal(resolveHubWorkspaceTab(undefined, "roast"), "flavors");
    assert.equal(resolveHubWorkspaceTab(undefined, undefined, "14"), "models");
    assert.equal(resolveHubWorkspaceTab("unknown"), "studies");
  });

  it("formats friendly study titles, custom descriptions, compact counts, and switcher options", () => {
    assert.equal(
      formatFriendlyStudyTitle({ id: 20, slug: "2026-04-17", description: null }),
      "Apr 17, 2026",
    );
    assert.equal(
      formatFriendlyStudyTitle({
        id: 21,
        slug: "2026-04-21-extra-credit",
        description: null,
      }),
      "Extra Credit · Apr 21, 2026",
    );
    assert.equal(
      formatFriendlyStudyTitle({
        id: 122,
        slug: "10-10-22-captions-multi-person-scene-sad-girl-4",
        description: "Created with Quick Study (captions with images).",
      }),
      "Multi Person Scene Sad Girl 4 · Oct 10",
    );
    assert.equal(
      formatFriendlyStudyTitle({
        id: 123,
        slug: "10-12--0--first-day-intern-energy",
        description: null,
      }),
      "First Day Intern Energy · Oct 12",
    );
    assert.equal(
      formatFriendlyStudyTitle({ id: 105, slug: "09-27c", description: null }),
      "Sep 27 (c)",
    );
    assert.equal(
      formatFriendlyStudyTitle({ id: 102, slug: "09-27", description: null }),
      "Sep 27",
    );
    assert.equal(
      formatFriendlyStudyTitle({
        id: 40,
        slug: "v2-gpt-llm-study",
        description: null,
      }),
      "V2 GPT LLM Study",
    );
    assert.equal(
      formatStudyHeaderLabel({
        id: 8,
        slug: "   ",
        description: "Transitional deck",
      }),
      "#8 · Transitional deck",
    );
    assert.equal(
      formatStudyHeaderLabel({ id: 3, slug: null, description: null }),
      "Study 3",
    );

    assert.equal(
      extractCustomStudyDescription(
        "Created with Quick Study (image + caption pairs).",
      ),
      null,
    );
    assert.equal(extractCustomStudyDescription("   "), null);
    assert.equal(
      extractCustomStudyDescription("Apr 17, 2026", "Apr 17, 2026"),
      null,
    );
    assert.equal(
      extractCustomStudyDescription("Extra credit alignment run", "Apr 17"),
      "Extra credit alignment run",
    );

    assert.equal(formatCompactCount(Number.NaN), "0");
    assert.equal(formatCompactCount(942), "942");
    assert.equal(formatCompactCount(32_493), "32.5k");
    assert.equal(formatCompactCount(366_864), "367k");
    assert.equal(formatCompactCount(1_250_000), "1.3M");
    assert.equal(formatCompactCount(12_400_000), "12M");

    const enrichedOpt = formatStudySwitcherOption({
      id: 20,
      slug: "2026-04-17",
      description: "Flagship",
      flavorCount: 5,
      voterCount: 167,
      exposureCount: 32493,
      flavorSlugs: ["flavor-simple-match"],
      modelNames: ["Gemini 2.5 Pro"],
    });
    assert.equal(
      enrichedOpt.label,
      "#20 · Apr 17, 2026 (5 flavors · 167 voters)",
    );
    assert.ok(enrichedOpt.searchText?.includes("flavor-simple-match"));
    assert.ok(enrichedOpt.searchText?.includes("Gemini 2.5 Pro"));

    const zeroVoteOpt = formatStudySwitcherOption({
      id: 123,
      slug: "10-12--0--first-day-intern-energy",
      description: null,
      exposureCount: 0,
    });
    assert.equal(
      zeroVoteOpt.label,
      "#123 · First Day Intern Energy · Oct 12 (0 votes)",
    );

    assert.equal(
      buildStudioTabHref(22, "attribution", false),
      "/study/22/attribution",
    );
    assert.equal(
      buildStudioTabHref(22, "demographics", true),
      "/study/22/demographics?excludeHighRisk=1",
    );
  });

  it("gates Classic Reports Swipe Report strictly on exposureMode === swipe_navigation (never studyId >= 7)", () => {
    // Transitional Likert study #20 (studyId >= 7, mode likert_votes) MUST NOT include new-style-report!
    const likert20Opts = buildClassicStudyReportOptions({
      studyId: 20,
      exposureMode: "likert_votes",
    });
    assert.equal(likert20Opts[0].value, "/study/20/study-detail");
    assert.equal(
      likert20Opts.some((opt) => opt.value.endsWith("/new-style-report")),
      false,
    );
    assert.equal(likert20Opts.length, 5);

    const swipe122Opts = buildClassicStudyReportOptions({
      studyId: 122,
      exposureMode: "swipe_navigation",
    });
    assert.equal(
      swipe122Opts.some(
        (opt) => opt.value === "/study/122/new-style-report",
      ),
      true,
    );
    assert.equal(swipe122Opts.length, 6);
  });
});

describe("Top navbar Cmd+K search state guard & flattener", () => {
  it("classifies direct 401/403, proxy 307->/login HTML redirects, offline errors, and valid JSON responses", () => {
    assert.equal(
      classifySearchHttpResponse({
        status: 401,
        ok: false,
        redirected: false,
        contentType: "application/json",
      }),
      "unauthorized",
    );
    assert.equal(
      classifySearchHttpResponse({
        status: 403,
        ok: false,
        redirected: false,
        contentType: "application/json",
      }),
      "unauthorized",
    );
    assert.equal(
      classifySearchHttpResponse({
        status: 0,
        ok: false,
        redirected: false,
        type: "opaqueredirect",
      }),
      "unauthorized",
    );
    assert.equal(
      classifySearchHttpResponse({
        status: 200,
        ok: true,
        redirected: true,
        url: "http://127.0.0.1:3007/login?error=superadmin_required",
        contentType: "text/html; charset=utf-8",
      }),
      "unauthorized",
    );
    assert.equal(
      classifySearchHttpResponse({
        status: 200,
        ok: true,
        redirected: false,
        url: "http://127.0.0.1:3007/login",
        contentType: "text/html",
      }),
      "unauthorized",
    );
    assert.equal(
      classifySearchHttpResponse({
        status: 502,
        ok: false,
        redirected: false,
        url: ":::invalid-url:::",
        contentType: "text/html",
      }),
      "offline",
    );
    assert.equal(
      classifySearchHttpResponse({
        status: 200,
        ok: true,
        redirected: false,
        url: "http://127.0.0.1:3007/api/study-search?q=sad",
        contentType: "text/html; charset=utf-8",
      }),
      "offline",
    );
    assert.equal(
      classifySearchHttpResponse({
        status: 200,
        ok: true,
        redirected: false,
        url: "http://127.0.0.1:3007/api/study-search?q=sad",
        contentType: "application/json; charset=utf-8",
      }),
      "ok",
    );
  });

  it("blocks stale default items (#123) and Enter selection whenever search query is in-flight or mismatched", () => {
    const initialSearch: RichStudySearchResponse = {
      studies: [
        {
          id: 20,
          title: "Apr 17, 2026",
          slug: "2026-04-17",
          status: "closed",
          formatLabel: "Likert",
          href: "/study/20/attribution",
        },
      ],
      flavors: [],
      models: [],
      reports: [],
    };
    const resolvedGemini: RichStudySearchResponse = {
      query: "Gemini",
      studies: [],
      flavors: [],
      models: [
        {
          id: 14,
          name: "Gemini 2.5 Flash",
          providerModelId: "gemini-2.5-flash",
          providerName: "Google",
          studyCount: 12,
          latestStudyId: 122,
          href: "/?tab=models&model=14",
        },
      ],
      reports: [],
    };

    const emptyState = resolveSearchModalState({
      searchQuery: "   ",
      remoteResults: null,
      searchError: null,
      initialSearch,
    });
    assert.equal(emptyState.isEmptyQuery, true);
    assert.equal(emptyState.allowEnterSelection, true);
    assert.equal(emptyState.activePayload, initialSearch);

    // Typed "Gemini" while fetch has not resolved yet -> MUST NOT expose initialSearch!
    const inFlightState = resolveSearchModalState({
      searchQuery: "Gemini",
      remoteResults: null,
      searchError: null,
      initialSearch,
    });
    assert.equal(inFlightState.isPendingQuery, true);
    assert.equal(inFlightState.allowEnterSelection, false);
    assert.equal(inFlightState.activePayload, null);

    // User keeps typing "Gemini 2.5" while old "Gemini" response sits in state -> still pending!
    const staleMismatchState = resolveSearchModalState({
      searchQuery: "Gemini 2.5",
      remoteResults: { query: "Gemini", response: resolvedGemini },
      searchError: null,
      initialSearch,
    });
    assert.equal(staleMismatchState.isPendingQuery, true);
    assert.equal(staleMismatchState.allowEnterSelection, false);
    assert.equal(staleMismatchState.activePayload, null);

    // Error state disables Enter selection and spinner.
    const errState = resolveSearchModalState({
      searchQuery: "Gemini",
      remoteResults: null,
      searchError: "offline",
      initialSearch,
    });
    assert.equal(errState.isPendingQuery, false);
    assert.equal(errState.allowEnterSelection, false);
    assert.equal(errState.activePayload, null);

    // Exact resolved query enables Enter cleanly.
    const matchedState = resolveSearchModalState({
      searchQuery: " Gemini ",
      remoteResults: { query: "Gemini", response: resolvedGemini },
      searchError: null,
      initialSearch,
    });
    assert.equal(matchedState.isPendingQuery, false);
    assert.equal(matchedState.allowEnterSelection, true);
    assert.equal(matchedState.activePayload, resolvedGemini);
  });

  it("formats rich counts and separates 0-study-run flavors & models into muted bottom subgroups", () => {
    const response: RichStudySearchResponse = {
      studies: [
        {
          id: 20,
          title: "Apr 17, 2026",
          slug: "2026-04-17",
          status: "closed",
          formatLabel: "Likert",
          formatDisplayLabel: "Rating scale",
          flavorCount: 5,
          voterCount: 167,
          exposureCount: 32493,
          positiveRate: 0.395,
          isBenchmark: true,
          href: "/study/20/attribution",
        },
        {
          id: 123,
          title: "First Day Intern Energy",
          slug: "123",
          status: "closed",
          formatLabel: "Swipe",
          exposureCount: 0,
          href: "/study/123/attribution",
        },
      ],
      flavors: [
        {
          id: 10,
          slug: "flavor-simple-match",
          description: "desc",
          studyCount: 4,
          latestStudyId: 20,
          positiveRate: 0.477,
          href: "/?tab=flavors&flavor=flavor-simple-match",
        },
        {
          id: 11,
          slug: "unused-flavor",
          description: null,
          studyCount: 0,
          latestStudyId: null,
          href: null,
        },
      ],
      models: [
        {
          id: 5,
          name: "Gemini 2.5 Pro",
          providerModelId: "gemini-2.5-pro",
          providerName: "Google",
          studyCount: 4,
          latestStudyId: 122,
          positiveRate: 0.412,
          href: "/?tab=models&model=5",
        },
        {
          id: 6,
          name: "Idle Model",
          providerModelId: "idle-v1",
          providerName: "OpenAI",
          studyCount: 0,
          latestStudyId: null,
          href: null,
        },
      ],
      reports: [
        { label: "Global Prompt Flavors Leaderboard", href: "/?tab=flavors" },
        { label: "Study-to-Study Comparison", href: "/reports/study-comparison" },
      ],
    };

    assert.equal(formatLifecycleStatusLabel("closed"), "Closed");

    const groups = flattenSearchResponse(response, false);
    assert.deepEqual(
      groups.map((g) => g.section),
      [
        "studies",
        "flavors",
        "models",
        "reports",
        "flavors_untested",
        "models_untested",
      ],
    );
    assert.equal(groups[0].items[0].secondaryLabel, "Benchmark");
    assert.equal(groups[0].items[0].rightMeta, "5 flavors · 167 voters · 39.5%");
    assert.equal(groups[0].items[1].rightMeta, "Swipe · 0 votes");
    assert.equal(groups[1].items[0].rightMeta, "4 studies · 47.7%");
    assert.equal(groups[2].items[0].rightMeta, "Google · 4 studies · 41.2%");
    assert.equal(groups[3].items[0].rightMeta, "View");
    assert.equal(groups[3].items[1].rightMeta, "Classic");
    assert.equal(groups[4].items[0].href, null);
    assert.equal(groups[4].items[0].rightMeta, "0 study runs");
    assert.equal(groups[5].items[0].href, null);
    assert.equal(groups[5].items[0].rightMeta, "OpenAI · 0 study runs");

    const emptyGroups = flattenSearchResponse(
      { studies: response.studies.slice(0, 1), flavors: [], models: [], reports: response.reports },
      true,
    );
    assert.deepEqual(
      emptyGroups.map((g) => g.heading),
      ["Featured & Scored Studies", "Leaderboards & Views"],
    );
  });
});

describe("Executive Study Hub filter and sort helpers", () => {
  const sampleStudies: FilterableStudyDirectoryRow[] = [
    makeCatalogRow({
      id: 3,
      title: "legacy-study",
      description: "Early six-point captions",
      status: "closed",
      formatLabel: "Likert",
      captionCount: 200,
      participationsStarted: 0,
      participationsEnded: 0,
      completionRate: null,
      flavorCount: 3,
      sharedImagePairCount: 20,
      exposureCount: 55_000,
      voterCount: 150,
      positiveRate: 0.35,
      ciLow: 0.34,
      flavorSlugs: ["flavor-classic"],
      modelNames: ["GPT-4o"],
    }),
    makeCatalogRow({
      id: 20,
      title: "Apr 17, 2026",
      slug: "2026-04-17",
      status: "closed",
      formatLabel: "Likert",
      captionCount: 203,
      participationsStarted: 0,
      participationsEnded: 0,
      completionRate: null,
      flavorCount: 5,
      sharedImagePairCount: 41,
      exposureCount: 32_493,
      voterCount: 167,
      positiveRate: 0.395,
      ciLow: 0.388,
      flavorSlugs: ["flavor-simple-match", "flavor-inside-my-head"],
      modelNames: ["Gemini 2.5 Pro", "GPT 5"],
    }),
    makeCatalogRow({
      id: 122,
      title: "Sad Girl Pack",
      slug: "10-10-22-sad-girl",
      status: "active",
      formatLabel: "Swipe",
      captionCount: 80,
      participationsStarted: 120,
      participationsEnded: 108,
      completionRate: 0.9,
      flavorCount: 1,
      exposureCount: 3_929,
      voterCount: 180,
      positiveRate: 0.36,
      ciLow: 0.345,
      flavorSlugs: ["multi-person-scene-SAD-GIRL-4"],
      modelNames: ["GPT 5 Mini"],
    }),
    makeCatalogRow({
      id: 123,
      title: "Intern Staging Stub",
      slug: "10-12--0--first-day-intern-energy",
      status: "closed",
      formatLabel: "Swipe",
      captionCount: 126,
      participationsStarted: 0,
      participationsEnded: 0,
      completionRate: null,
      flavorCount: 1,
      exposureCount: 0,
      voterCount: 0,
      positiveRate: null,
      ciLow: null,
      flavorSlugs: ["first-day-intern-energy"],
      modelNames: ["GPT 5"],
    }),
  ];

  it("formats percentages with em-dash fallback for null completion", () => {
    assert.equal(formatHubPercent(null), "—");
    assert.equal(formatHubPercent(Number.NaN), "—");
    assert.equal(formatHubPercent(0.8442), "84.4%");
  });

  it("matches flavor slugs, model names, raw slugs, scope chips, Rating scale format, and all sort modes", () => {
    // Unified search catches model names ("Gemini") and flavor slugs ("simple-match")
    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "Gemini",
        statusFilter: "all",
        formatFilter: "all",
        sortMode: "newest_scored",
      }).map((r) => r.id),
      [20],
    );

    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "simple-match",
        statusFilter: "all",
        formatFilter: "Rating scale",
        sortMode: "newest_scored",
      }).map((r) => r.id),
      [20],
    );

    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "10-10-22",
        statusFilter: "all",
        formatFilter: "all",
        sortMode: "newest_scored",
      }).map((r) => r.id),
      [122],
    );

    // newest_scored places scored studies first (#122, #20, #3) ahead of 0-vote #123
    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "",
        statusFilter: "all",
        formatFilter: "all",
        sortMode: "newest_scored",
      }).map((r) => r.id),
      [122, 20, 3, 123],
    );

    // scopeFilter="scored" drops 0-vote #123; scopeFilter="benchmarks" keeps >= 2 flavors scored
    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "",
        scopeFilter: "scored",
        statusFilter: "all",
        formatFilter: "all",
        sortMode: "newest",
      }).map((r) => r.id),
      [122, 20, 3],
    );
    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "",
        scopeFilter: "benchmarks",
        statusFilter: "all",
        formatFilter: "all",
        sortMode: "most_flavors",
      }).map((r) => r.id),
      [20, 3],
    );

    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "",
        statusFilter: "all",
        formatFilter: "all",
        sortMode: "most_votes",
      }).map((r) => r.id),
      [3, 20, 122, 123],
    );

    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "",
        statusFilter: "all",
        formatFilter: "all",
        sortMode: "highest_positive_rate",
      }).map((r) => r.id),
      [20, 122, 3, 123],
    );

    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "#20",
        statusFilter: "all",
        formatFilter: "all",
        sortMode: "newest",
      }).map((r) => r.id),
      [20],
    );

    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "",
        statusFilter: "active",
        formatFilter: "Swipe",
        sortMode: "highest_completion",
      }).map((r) => r.id),
      [122],
    );

    assert.deepEqual(
      filterAndSortStudyDirectory({
        studies: sampleStudies,
        searchQuery: "",
        statusFilter: "all",
        formatFilter: "all",
        sortMode: "most_captions",
      }).map((r) => r.id),
      [20, 3, 123, 122],
    );
  });
});

describe("Attribution charts & leaderboard helpers", () => {
  const flavorA = makeLeaderboardRow({
    key: "flavor:1",
    flavorId: 1,
    label: "alpha-flavor",
    subtitle: "Dry observational wit",
    dominantModelLabel: "Mistral Large",
    captionCount: 12,
    exposures: 200,
    positive: 90,
    rate: 0.45,
    ciLow: 0.38,
    ciHigh: 0.52,
    sharedImageCount: 5,
    meanLiftPp: 8.24,
    medianChainSeconds: 5.4,
    medianDwellMs: 2400,
  });
  const flavorB = makeLeaderboardRow({
    key: "flavor:2",
    flavorId: 2,
    label: "beta-flavor",
    pipelineSteps: ["GPT-4o", "Gemini 2.5 Pro"],
    captionCount: 20,
    exposures: 150,
    positive: 45,
    rate: 0.3,
    ciLow: 0.23,
    ciHigh: 0.38,
    sharedImageCount: 5,
    meanLiftPp: -6.1,
    medianChainSeconds: null,
    medianDwellMs: null,
  });
  const unattributed = makeLeaderboardRow({
    key: "__unattributed__",
    kind: "unattributed",
    isUnattributed: true,
    label: "Unattributed / Manual",
    captionCount: 4,
    exposures: 500,
    positive: 400,
    rate: 0.8,
    ciLow: 0.76,
    ciHigh: 0.83,
    medianChainSeconds: null,
    medianDwellMs: 900,
  });

  it("formats chain latency, signed lift pp, tones, and dwell durations across edge cases", () => {
    assert.equal(formatChainSecondsLabel(null), "—");
    assert.equal(formatChainSecondsLabel(0.02), "<0.1s");
    assert.equal(formatChainSecondsLabel(0), "0.0s");
    assert.equal(formatChainSecondsLabel(3.84), "3.8s");

    assert.equal(formatSignedLiftPp(null), "—");
    assert.equal(formatSignedLiftPp(9.64), "+9.6 pp");
    assert.equal(formatSignedLiftPp(-4.18), "-4.2 pp");
    assert.equal(formatSignedLiftPp(-0.02), "+0.0 pp");

    assert.equal(getLiftToneClassName(null), "app-muted");
    assert.equal(
      getLiftToneClassName(2.1),
      "text-emerald-800 dark:text-emerald-300",
    );
    assert.equal(
      getLiftToneClassName(-1.2),
      "text-rose-800 dark:text-rose-300",
    );
    assert.equal(getLiftToneClassName(0.4), "text-foreground");

    assert.equal(formatDwellDurationLabel(null), "—");
    assert.equal(formatDwellDurationLabel(620), "620ms");
    assert.equal(formatDwellDurationLabel(2340), "2.3s");
    assert.equal(formatDwellDurationLabel(74_000), "1m 14s");
  });

  it("builds latency scatter points strictly from attributed timed rows with exposures", () => {
    const zeroExposureFlavor = makeLeaderboardRow({
      key: "flavor:3",
      flavorId: 3,
      label: "zero-exp",
      exposures: 0,
      positive: 0,
      rate: null,
      ciLow: null,
      ciHigh: null,
      medianChainSeconds: 2.0,
    });
    const points = buildLatencyScatterPoints([
      flavorA,
      flavorB,
      zeroExposureFlavor,
      unattributed,
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0].key, "flavor:1");
    assert.equal(points[0].positiveRatePct, 45);
    assert.equal(points[0].medianChainSeconds, 5.4);
  });

  it("resolves initial groupBy and URL entity focus including missing-entity notices", () => {
    assert.equal(resolveInitialGroupBy("pipeline"), "pipeline");
    assert.equal(resolveInitialGroupBy(undefined, undefined, "31"), "model");
    assert.equal(resolveInitialGroupBy("invalid", "1", "31"), "flavor");

    const modelRow = makeLeaderboardRow({
      key: "model:31",
      kind: "model",
      modelId: 31,
      label: "Mistral Large",
    });

    assert.deepEqual(
      resolveUrlEntityFocus({
        flavorParam: "1",
        flavors: [flavorA, unattributed],
        models: [modelRow],
      }),
      {
        matchedKey: "flavor:1",
        matchedLabel: "alpha-flavor",
        missingEntityKind: null,
      },
    );

    assert.deepEqual(
      resolveUrlEntityFocus({
        flavorParam: "99999",
        flavors: [flavorA],
        models: [modelRow],
      }),
      {
        matchedKey: null,
        matchedLabel: null,
        missingEntityKind: "flavor",
      },
    );

    assert.deepEqual(
      resolveUrlEntityFocus({
        modelParam: "mistral large",
        flavors: [flavorA],
        models: [modelRow],
      }),
      {
        matchedKey: "model:31",
        matchedLabel: "Mistral Large",
        missingEntityKind: null,
      },
    );

    assert.deepEqual(
      resolveUrlEntityFocus({
        modelParam: "999",
        flavors: [flavorA],
        models: [modelRow],
      }),
      {
        matchedKey: null,
        matchedLabel: null,
        missingEntityKind: "model",
      },
    );

    assert.deepEqual(
      resolveUrlEntityFocus({
        flavors: [flavorA],
        models: [modelRow],
      }),
      {
        matchedKey: null,
        matchedLabel: null,
        missingEntityKind: null,
      },
    );
  });

  it("sorts across all 7 leaderboard columns while pinning Unattributed last and nulls after values", () => {
    assert.equal(getDefaultLeaderboardSortDirection("label"), "asc");
    assert.equal(
      getDefaultLeaderboardSortDirection("medianChainSeconds"),
      "asc",
    );
    assert.equal(getDefaultLeaderboardSortDirection("medianDwellMs"), "asc");
    assert.equal(getDefaultLeaderboardSortDirection("ciLow"), "desc");

    const rows = [unattributed, flavorB, flavorA];

    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "",
        pinnedEntityKey: null,
        sortBy: "ciLow",
        sortDirection: "desc",
      }).map((r) => r.key),
      ["flavor:1", "flavor:2", "__unattributed__"],
    );

    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "",
        pinnedEntityKey: null,
        sortBy: "medianChainSeconds",
        sortDirection: "asc",
      }).map((r) => r.key),
      ["flavor:1", "flavor:2", "__unattributed__"],
    );

    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "",
        pinnedEntityKey: null,
        sortBy: "medianDwellMs",
        sortDirection: "asc",
      }).map((r) => r.key),
      ["flavor:1", "flavor:2", "__unattributed__"],
    );

    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "",
        pinnedEntityKey: null,
        sortBy: "meanLiftPp",
        sortDirection: "asc",
      }).map((r) => r.key),
      ["flavor:2", "flavor:1", "__unattributed__"],
    );

    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "",
        pinnedEntityKey: null,
        sortBy: "captionCount",
        sortDirection: "desc",
      }).map((r) => r.key),
      ["flavor:2", "flavor:1", "__unattributed__"],
    );

    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "",
        pinnedEntityKey: null,
        sortBy: "exposures",
        sortDirection: "asc",
      }).map((r) => r.key),
      ["flavor:2", "flavor:1", "__unattributed__"],
    );

    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "",
        pinnedEntityKey: null,
        sortBy: "label",
        sortDirection: "desc",
      }).map((r) => r.key),
      ["flavor:2", "flavor:1", "__unattributed__"],
    );

    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "observational",
        pinnedEntityKey: null,
        sortBy: "ciLow",
        sortDirection: "desc",
      }).map((r) => r.key),
      ["flavor:1"],
    );
    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "mistral",
        pinnedEntityKey: null,
        sortBy: "ciLow",
        sortDirection: "desc",
      }).map((r) => r.key),
      ["flavor:1"],
    );
    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "gemini 2.5",
        pinnedEntityKey: null,
        sortBy: "ciLow",
        sortDirection: "desc",
      }).map((r) => r.key),
      ["flavor:2"],
    );
    assert.deepEqual(
      filterAndSortLeaderboardRows({
        rows,
        searchQuery: "",
        pinnedEntityKey: "flavor:2",
        sortBy: "ciLow",
        sortDirection: "desc",
      }).map((r) => r.key),
      ["flavor:2"],
    );
  });
});
