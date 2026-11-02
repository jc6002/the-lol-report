import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAttributionLeaderboards,
  buildDemographicCohortMatrices,
  computeSameImageMetrics,
  computeWilsonConfidenceInterval,
  UNATTRIBUTED_BUCKET_KEY,
  UNATTRIBUTED_BUCKET_LABEL,
  type AttributionLeaderboardRow,
  type CaptionLineageInfo,
  type SameImageComparisonGroup,
} from "@/utils/attribution-stats";
import {
  buildHeadToHeadFlavorHref,
  buildStudyAttributionCsv,
  buildStudyExportPayload,
  buildStudyResearchBriefMarkdown,
  encodeCsvCell,
  formatChainSeconds,
  formatQuestionRespondentLabel,
  formatSignedPp,
  formatStudioRate,
  formatSurveyedVoterSummary,
  getCohortRowVoterSubtitle,
  getDefaultLiftSortDirection,
  getHeatmapTintClassName,
  getStudyAttributionCsvFilename,
  getStudyResearchBriefFilename,
  hasSuppressedCohortPool,
  matchFlavorRowByParam,
  resolveSameImageGroupPair,
  sanitizeCsvText,
  sortResolvedGroupPairs,
  sortSameImageLiftRows,
} from "@/utils/attribution-export";
import type { AdaptedStudyExposures } from "@/utils/study-exposure-adapter";
import type { StudyAttributionBundle } from "@/utils/study-lineage-loader";

const makeFlavorRow = (
  overrides: Partial<AttributionLeaderboardRow> & {
    key: string;
    label: string;
  },
): AttributionLeaderboardRow => ({
  kind: "flavor",
  isUnattributed: false,
  flavorId: 1,
  modelId: null,
  subtitle: null,
  stepCount: 2,
  dominantModelLabel: "Gemini 2.5 Pro",
  pipelineSteps: ["Gemini 2.5 Flash", "Gemini 2.5 Pro"],
  flavorCount: 1,
  captionCount: 10,
  exposures: 100,
  positive: 35,
  rate: 0.35,
  ciLow: 0.2636,
  ciHigh: 0.4475,
  sharedImageCount: 5,
  imageBaselineMean: 0.25,
  meanLift: 0.1,
  meanLiftPp: 10,
  pairWins: 4,
  pairLosses: 1,
  pairTies: 0,
  pairWinRate: 0.8,
  medianChainSeconds: 4.82,
  medianDwellMs: 3200,
  ...overrides,
});

const makeSampleBundle = (
  overrides?: Partial<StudyAttributionBundle>,
): StudyAttributionBundle => {
  const exposureBundle: AdaptedStudyExposures = {
    studyId: 84,
    mode: "swipe_navigation",
    isTransitionalLikert: false,
    detailHref: "/study/84/new-style-report",
    exposureUnitLabel: "seen cards",
    exposures: [],
    allExposureCount: 500,
    allPositiveCount: 140,
    totalExposures: 500,
    totalPositive: 140,
    distinctVoters: 42,
    medianStudyDwellMs: 3100,
    highRiskProfileIds: new Set(["risky-1", "risky-2"]),
    highRiskVoterCount: 2,
    excludedVoterCount: 0,
    excludedExposureCount: 0,
    userDiagnostics: new Map(),
    reconciliation: {
      rawNavigationEventCount: 520,
      rawVoteEventCount: 145,
      timedVoteCount: 0,
      untimedVoteCount: 0,
    },
  };

  const flavorA = makeFlavorRow({
    key: "flavor:11",
    flavorId: 11,
    label: "gigachad-power-reversal",
    dominantModelLabel: "Gemini 2.5 Pro",
    captionCount: 8,
    exposures: 250,
    positive: 90,
    rate: 0.36,
    ciLow: 0.303,
    ciHigh: 0.4212,
    sharedImageCount: 4,
    meanLiftPp: 9.64,
    medianChainSeconds: 4.84,
  });

  const flavorB = makeFlavorRow({
    key: "flavor:12",
    flavorId: 12,
    label: "generic-one-shot",
    dominantModelLabel: "GPT-4o Mini",
    captionCount: 8,
    exposures: 200,
    positive: 35,
    rate: 0.175,
    ciLow: 0.1286,
    ciHigh: 0.2336,
    sharedImageCount: 4,
    meanLiftPp: -8.86,
    medianChainSeconds: 0.03,
  });

  const unattributed = makeFlavorRow({
    key: UNATTRIBUTED_BUCKET_KEY,
    kind: "unattributed",
    isUnattributed: true,
    flavorId: null,
    label: UNATTRIBUTED_BUCKET_LABEL,
    dominantModelLabel: null,
    captionCount: 2,
    exposures: 50,
    positive: 15,
    rate: 0.3,
    ciLow: 0.191,
    ciHigh: 0.4375,
    sharedImageCount: 0,
    meanLift: null,
    meanLiftPp: null,
    pairWins: 0,
    pairLosses: 0,
    pairTies: 0,
    pairWinRate: null,
    medianChainSeconds: null,
  });

  return {
    study: {
      id: 84,
      slug: "fall-campus-finals-pack",
      description: "Fall campus study",
      start_datetime_utc: "2026-10-14T09:00:00Z",
      end_datetime_utc: "2026-10-21T23:59:00Z",
      created_datetime_utc: "2026-10-13T12:00:00Z",
      is_hidden: false,
      is_private: false,
    },
    studies: [],
    excludeHighRisk: false,
    mappedCaptionCount: 18,
    unattributedCaptionCount: 2,
    metadataAttributedCaptionCount: 0,
    studyRateCi: computeWilsonConfidenceInterval(140, 500),
    exposureBundle,
    participationFunnel: {
      participationsStarted: 50,
      participationsEnded: 41,
      completionRate: 0.82,
      medianRunMinutes: 4.2,
      distinctVoters: 42,
      judgedAtLeastOneCount: 42,
      retentionCurve: [],
    },
    captionsById: new Map<string, CaptionLineageInfo>(),
    leaderboards: {
      flavors: [flavorA, flavorB, unattributed],
      models: [],
      pipelines: [],
    },
    headToHead: {
      structuralSharedImageCount: 4,
      evaluatedSharedImageCount: 4,
      crossFlavorSharedImageCount: 4,
      comparableCaptionCount: 8,
      maxImageSpreadPp: 26.5,
      groups: [
        {
          imageId: "img-1",
          imageUrl: "https://cdn.example.com/1.jpg",
          imageDescription: "Student | library at 2 AM\nwith laptop",
          totalExposures: 120,
          imageMeanRate: 0.2515,
          spreadPp: 26.5,
          captions: [
            {
              captionId: "cap-1",
              captionText: 'Calling a nap "brain compilation" | bold move',
              flavorId: 11,
              flavorKey: "flavor:11",
              flavorSlug: "gigachad-power-reversal",
              terminalModelLabel: "Gemini 2.5 Pro",
              exposures: 60,
              positive: 23,
              rate: 0.384,
              ciLow: 0.271,
              ciHigh: 0.51,
              liftPp: 13.25,
            },
            {
              captionId: "cap-2",
              captionText: "When Monday hits hard again",
              flavorId: 12,
              flavorKey: "flavor:12",
              flavorSlug: "generic-one-shot",
              terminalModelLabel: "GPT-4o Mini",
              exposures: 60,
              positive: 7,
              rate: 0.119,
              ciLow: 0.059,
              ciHigh: 0.225,
              liftPp: -13.25,
            },
          ],
        },
      ],
    },
    demographics: {
      studyVoterCount: 42,
      surveyedVoterCount: 38,
      totalVisibleSegments: 3,
      totalMaskedSegments: 2,
      flavorColumns: [],
      questions: [],
      tasteGaps: [
        {
          questionId: 4,
          questionText: "Which school are you associated with?",
          flavorId: 11,
          flavorKey: "flavor:11",
          flavorSlug: "gigachad-power-reversal",
          highAnswerLabel: "Undergraduate",
          highRate: 0.412,
          highVoters: 22,
          lowAnswerLabel: "Graduate | PhD",
          lowRate: 0.27,
          lowVoters: 11,
          spreadPp: 14.2,
        },
      ],
    },
    ...overrides,
  };
};

describe("attribution-export", () => {
  it("neutralizes spreadsheet formula triggers and quotes RFC 4180 special characters", () => {
    assert.equal(sanitizeCsvText(""), "");
    assert.equal(sanitizeCsvText("normal-slug"), "normal-slug");
    assert.equal(sanitizeCsvText("=SUM(A1:A5)"), "'=SUM(A1:A5)");
    assert.equal(sanitizeCsvText("+1+2"), "'+1+2");
    assert.equal(sanitizeCsvText("-malicious"), "'-malicious");
    assert.equal(sanitizeCsvText("@cmd"), "'@cmd");
    assert.equal(sanitizeCsvText("\t=1"), "'\t=1");
    assert.equal(sanitizeCsvText("\r=1"), "'\r=1");
    assert.equal(sanitizeCsvText("\n=1"), "'\n=1");
    assert.equal(sanitizeCsvText('  =HYPERLINK("http://x")'), '\'  =HYPERLINK("http://x")');

    assert.equal(encodeCsvCell(null, "text"), "");
    assert.equal(encodeCsvCell(undefined, "number"), "");
    assert.equal(encodeCsvCell("", "text"), "");
    assert.equal(encodeCsvCell(Number.NaN, "number"), "");
    assert.equal(encodeCsvCell(-10.5, "number"), "-10.5");
    assert.equal(encodeCsvCell("12.25", "number"), "12.25");
    assert.equal(encodeCsvCell(42, "number"), "42");
    assert.equal(encodeCsvCell("-bad-flavor", "text"), "\"'-bad-flavor\"");
    assert.equal(
      encodeCsvCell('=1+1,"quoted"', "text"),
      "\"'=1+1,\"\"quoted\"\"\"",
    );
    assert.equal(encodeCsvCell("hello, world", "text"), '"hello, world"');
    assert.equal(encodeCsvCell(" padded ", "text"), '" padded "');
  });

  it("serializes complete study attribution CSV with exact headers and formula escaping", () => {
    const base = makeSampleBundle();
    const dangerousFlavor = makeFlavorRow({
      key: "flavor:99",
      flavorId: 99,
      label: "=CMD|' /C calc'!A0",
      dominantModelLabel: "@evil-model",
      meanLiftPp: -4.256,
      medianChainSeconds: 1.5,
    });
    const bundle = makeSampleBundle({
      study: {
        ...base.study,
        slug: "+injected-study",
      },
      leaderboards: {
        ...base.leaderboards,
        flavors: [dangerousFlavor, ...base.leaderboards.flavors],
      },
    });

    const csv = buildStudyAttributionCsv(bundle);
    const lines = csv.trimEnd().split("\r\n");

    assert.equal(
      lines[0],
      "study_id,study_slug,era_format,rater_filter,flavor_slug,terminal_model,captions,exposures,positive_count,positive_rate,wilson_95_low,wilson_95_high,shared_images,mean_same_image_lift_pp,median_chain_seconds",
    );
    assert.equal(lines.length, 5);
    assert.match(
      lines[1],
      /^84,"'\+injected-study",Swipe,all_raters,"'=CMD\|' \/C calc'!A0","'@evil-model",/,
    );
    assert.match(lines[1], /,-4\.26,1\.5$/);
    assert.match(
      lines[4],
      /Unattributed \/ Manual,Unattributed,2,50,15,0\.3,0\.191,0\.4375,0,,$/,
    );
  });

  it("renders plain-English Markdown research brief with pipe escaping and rich sections", () => {
    const payload = buildStudyExportPayload(makeSampleBundle());

    assert.equal(payload.csvFilename, getStudyAttributionCsvFilename(84));
    assert.equal(payload.briefFilename, getStudyResearchBriefFilename(84));
    assert.match(
      payload.briefMarkdown,
      /^# Study #84 Research Brief — fall-campus-finals-pack/m,
    );
    assert.match(payload.briefMarkdown, /Swipe card views/);
    assert.match(
      payload.briefMarkdown,
      /All raters included \(2 high-risk voters detected\)/,
    );
    assert.match(
      payload.briefMarkdown,
      /Completion funnel:\*\* 82\.0% \(41 of 50 started runs finished/,
    );
    assert.match(payload.briefMarkdown, /<0\.1s/);
    assert.match(payload.briefMarkdown, /Graduate \\\| PhD/);
    assert.match(payload.briefMarkdown, /Student \\\| library at 2 AM with laptop/);
    assert.match(payload.briefMarkdown, /Winner \(`gigachad-power-reversal` · 38\.4%/);
    assert.match(payload.briefMarkdown, /Lowest \(`generic-one-shot` · 11\.9%/);
  });

  it("handles Likert fallbacks, high-risk filter labels, large flavor trimming, and k>=5 privacy masking", () => {
    const captionsById = new Map<string, CaptionLineageInfo>([
      [
        "c1",
        {
          captionId: "c1",
          content: "Same flavor card A",
          imageId: "img-same",
          imageUrl: null,
          imageDescription: null,
          attributionSource: "direct_fk",
          flavorId: 1,
          flavorSlug: "alpha-flavor",
          flavorDescription: null,
          flavorStepCount: 1,
          terminalModelId: 1,
          terminalModelName: "GPT-5",
          terminalProviderModelId: "gpt-5",
          terminalProviderName: "OpenAI",
          pipelineSignature: "GPT-5",
          pipelineSteps: ["GPT-5"],
          chainLatencySeconds: 0,
        },
      ],
      [
        "c2",
        {
          captionId: "c2",
          content: "Same flavor card B",
          imageId: "img-same",
          imageUrl: null,
          imageDescription: null,
          attributionSource: "direct_fk",
          flavorId: 1,
          flavorSlug: "alpha-flavor",
          flavorDescription: null,
          flavorStepCount: 1,
          terminalModelId: 1,
          terminalModelName: "GPT-5",
          terminalProviderModelId: "gpt-5",
          terminalProviderName: "OpenAI",
          pipelineSignature: "GPT-5",
          pipelineSteps: ["GPT-5"],
          chainLatencySeconds: 0,
        },
      ],
    ]);

    const exposures = [
      {
        profileId: "u1",
        mappingId: 1,
        captionId: "c1",
        isPositive: true,
        dwellMs: null,
        firstSeenUtc: "2026-01-01T00:00:00Z",
        firstEventId: 1,
      },
      {
        profileId: "u2",
        mappingId: 1,
        captionId: "c1",
        isPositive: false,
        dwellMs: null,
        firstSeenUtc: "2026-01-01T00:00:00Z",
        firstEventId: 2,
      },
      {
        profileId: "u3",
        mappingId: 2,
        captionId: "c2",
        isPositive: false,
        dwellMs: null,
        firstSeenUtc: "2026-01-01T00:00:00Z",
        firstEventId: 3,
      },
    ];

    const sameImage = computeSameImageMetrics({
      mappedCaptionIds: ["c1", "c2"],
      captionsById,
      exposures,
    });
    const leaderboards = buildAttributionLeaderboards({
      mappedCaptionIds: ["c1", "c2"],
      captionsById,
      exposures,
      sameImage,
    });
    const demographics = buildDemographicCohortMatrices({
      exposures,
      captionsById,
      flavorRows: leaderboards.flavors,
      questions: [{ id: 1, question: "Secret Cohort Question?" }],
      answers: [{ id: 10, answer: "Tiny Secret Segment" }],
      mappings: [
        {
          id: 100,
          question_id: 1,
          answer_id: 10,
          display_order: 1,
          is_deleted: false,
        },
      ],
      responses: [
        {
          id: 1,
          user_id: "u1",
          answer_question_mapping_id: 100,
          created_datetime_utc: "2026-01-01T00:00:00Z",
          modified_datetime_utc: null,
        },
        {
          id: 2,
          user_id: "u2",
          answer_question_mapping_id: 100,
          created_datetime_utc: "2026-01-01T00:00:00Z",
          modified_datetime_utc: null,
        },
        {
          id: 3,
          user_id: "u3",
          answer_question_mapping_id: 100,
          created_datetime_utc: "2026-01-01T00:00:00Z",
          modified_datetime_utc: null,
        },
      ],
    });

    const twelveFlavors = Array.from({ length: 12 }, (_, idx) =>
      makeFlavorRow({
        key: `flavor:${idx + 1}`,
        flavorId: idx + 1,
        label: `flavor-${idx + 1}`,
        dominantModelLabel: null,
        rate: null,
        ciLow: null,
        ciHigh: null,
        meanLiftPp: idx === 0 ? 0 : null,
        medianChainSeconds: idx === 0 ? 0 : null,
      }),
    );

    const likertBundle = makeSampleBundle({
      study: {
        id: 4,
        slug: null,
        description: "Legacy description title",
        start_datetime_utc: "not-a-date",
        end_datetime_utc: null,
        created_datetime_utc: "2026-02-01T00:00:00Z",
        is_hidden: false,
        is_private: false,
      },
      excludeHighRisk: true,
      studyRateCi: { rate: null, low: null, high: null },
      exposureBundle: {
        ...makeSampleBundle().exposureBundle,
        studyId: 4,
        mode: "likert_votes",
        exposureUnitLabel: "votes",
        distinctVoters: 1,
        highRiskVoterCount: 1,
        excludedVoterCount: 1,
      },
      participationFunnel: {
        participationsStarted: 0,
        participationsEnded: 0,
        completionRate: null,
        medianRunMinutes: null,
        distinctVoters: 1,
        judgedAtLeastOneCount: 1,
        retentionCurve: [],
      },
      leaderboards: {
        flavors: twelveFlavors,
        models: [],
        pipelines: [],
      },
      headToHead: {
        structuralSharedImageCount: 1,
        evaluatedSharedImageCount: 1,
        crossFlavorSharedImageCount: 0,
        comparableCaptionCount: 2,
        maxImageSpreadPp: 100,
        groups: sameImage.groups,
      },
      demographics,
    });

    const brief = buildStudyResearchBriefMarkdown(likertBundle);
    assert.ok(!brief.includes("Tiny Secret Segment"));
    assert.match(brief, /Masked \(< 5 surveyed across 3 study voters\)/);
    assert.ok(!brief.includes("2 of 3 study voters"));
    assert.match(
      brief,
      /No multi-segment demographic taste gaps meet the k >= 5/,
    );
    assert.match(brief, /6-point Likert votes/);
    assert.match(brief, /1 voter removed/);
    assert.match(brief, /not-a-date to Open/);
    assert.match(brief, /0\.0 pp/);
    assert.match(brief, /0\.0s/);
    assert.ok(!brief.includes("`flavor-6`"));
    assert.match(brief, /Shared prompt image/);

    const csv = buildStudyAttributionCsv(likertBundle);
    assert.match(csv, /4,Legacy description title,Likert,exclude_high_risk/);

    const emptyBundle = makeSampleBundle({
      study: {
        id: 9,
        slug: null,
        description: null,
        start_datetime_utc: null,
        end_datetime_utc: null,
        created_datetime_utc: "2026-03-01T00:00:00Z",
        is_hidden: false,
        is_private: false,
      },
      mappedCaptionCount: 1,
      leaderboards: { flavors: [], models: [], pipelines: [] },
      headToHead: {
        structuralSharedImageCount: 1,
        evaluatedSharedImageCount: 0,
        crossFlavorSharedImageCount: 0,
        comparableCaptionCount: 2,
        maxImageSpreadPp: 0,
        groups: [
          {
            imageId: "unevaluated",
            imageUrl: null,
            imageDescription: null,
            totalExposures: 0,
            imageMeanRate: null,
            spreadPp: 0,
            captions: [],
          },
        ],
      },
    });
    const emptyBrief = buildStudyResearchBriefMarkdown(emptyBundle);
    assert.match(emptyBrief, /study-9/);
    assert.match(emptyBrief, /1 mapped caption \(1 shared prompt image\)/);
    assert.match(emptyBrief, /No captions are mapped to this study\./);
    assert.match(emptyBrief, /No evaluated multi-caption prompt images/);
  });

  it("formats heatmap tints, URLs, and cohort subtitles across all ranges", () => {
    assert.equal(formatStudioRate(null), "—");
    assert.equal(formatStudioRate(Number.NaN), "—");
    assert.equal(formatStudioRate(0.248), "24.8%");
    assert.equal(formatSignedPp(null), "—");
    assert.equal(formatSignedPp(0), "0.0 pp");
    assert.equal(formatSignedPp(3.24), "+3.2 pp");
    assert.equal(formatSignedPp(-4.56), "-4.6 pp");
    assert.equal(formatChainSeconds(null), "—");
    assert.equal(formatChainSeconds(0.02), "<0.1s");
    assert.equal(formatChainSeconds(4.84), "4.8s");

    assert.equal(getHeatmapTintClassName(-10), "bg-rose-500/22");
    assert.equal(getHeatmapTintClassName(-8), "bg-rose-500/22");
    assert.equal(getHeatmapTintClassName(-4), "bg-rose-500/10");
    assert.equal(getHeatmapTintClassName(0), "bg-transparent");
    assert.equal(getHeatmapTintClassName(2), "bg-transparent");
    assert.equal(getHeatmapTintClassName(5), "bg-teal-500/12");
    assert.equal(getHeatmapTintClassName(8), "bg-teal-500/24");

    assert.equal(
      buildHeadToHeadFlavorHref(84, null, false),
      "/study/84/head-to-head",
    );
    assert.equal(
      buildHeadToHeadFlavorHref(84, 11, true),
      "/study/84/head-to-head?flavor=11&excludeHighRisk=1",
    );

    assert.equal(
      getCohortRowVoterSubtitle({
        rowKey: "r1",
        rowKind: "masked_pool",
        answerId: null,
        label: "Masked small segments (n < 5)",
        pooledOptionCount: 1,
        distinctVoters: null,
        overallCell: { status: "suppressed" },
        cellsByFlavorKey: {},
      }),
      "1 option",
    );
    assert.equal(
      getCohortRowVoterSubtitle({
        rowKey: "r2",
        rowKind: "masked_pool",
        answerId: null,
        label: "Masked small segments (n < 5)",
        pooledOptionCount: 3,
        distinctVoters: 6,
        overallCell: { status: "suppressed" },
        cellsByFlavorKey: {},
      }),
      "3 options · n=6 voters",
    );
    assert.equal(
      getCohortRowVoterSubtitle({
        rowKey: "r3",
        rowKind: "answer",
        answerId: 5,
        label: "SEAS",
        pooledOptionCount: 0,
        distinctVoters: 18,
        overallCell: { status: "empty" },
        cellsByFlavorKey: {},
      }),
      "n=18 voters",
    );
    assert.equal(
      getCohortRowVoterSubtitle({
        rowKey: "r4",
        rowKind: "unsurveyed",
        answerId: null,
        label: "No survey response on file",
        pooledOptionCount: 0,
        distinctVoters: null,
        overallCell: { status: "empty" },
        cellsByFlavorKey: {},
      }),
      "",
    );
    assert.equal(
      getCohortRowVoterSubtitle(
        {
          rowKey: "r5",
          rowKind: "unsurveyed",
          answerId: null,
          label: "No survey response on file",
          pooledOptionCount: 0,
          distinctVoters: 163,
          overallCell: { status: "empty" },
          cellsByFlavorKey: {},
        },
        false,
      ),
      "n=163 voters",
    );
    assert.equal(
      getCohortRowVoterSubtitle(
        {
          rowKey: "r5",
          rowKind: "unsurveyed",
          answerId: null,
          label: "No survey response on file",
          pooledOptionCount: 0,
          distinctVoters: 163,
          overallCell: { status: "empty" },
          cellsByFlavorKey: {},
        },
        true,
      ),
      "",
    );

    assert.deepEqual(formatSurveyedVoterSummary(0, 0), {
      primary: "0 / 0",
      subtitle: "— with demographic responses",
    });
    assert.deepEqual(formatSurveyedVoterSummary(0, 40), {
      primary: "0 / 40",
      subtitle: "0.0% with demographic responses",
    });
    assert.deepEqual(formatSurveyedVoterSummary(3, 45), {
      primary: "< 5 surveyed",
      subtitle: "45 study voters · masked below k ≥ 5",
    });
    assert.deepEqual(formatSurveyedVoterSummary(1, 1), {
      primary: "< 5 surveyed",
      subtitle: "1 study voter · masked below k ≥ 5",
    });
    assert.deepEqual(formatSurveyedVoterSummary(185, 194), {
      primary: "185 / 194",
      subtitle: "95.4% with demographic responses",
    });

    const baseQuestion = {
      questionId: 3,
      questionText: "Primary platform",
      surveyedRespondentCount: 0,
      unsurveyedVoterCount: 10,
      visibleSegmentCount: 0,
      maskedSegmentCount: 0,
      rows: [],
    };
    assert.equal(formatQuestionRespondentLabel(baseQuestion), "n=0");
    assert.equal(
      formatQuestionRespondentLabel({
        ...baseQuestion,
        surveyedRespondentCount: 4,
      }),
      "n < 5",
    );

    const study4Q3Shape = {
      ...baseQuestion,
      surveyedRespondentCount: 16,
      unsurveyedVoterCount: 163,
      visibleSegmentCount: 2,
      maskedSegmentCount: 2,
      rows: [
        {
          rowKey: "q3-a1",
          rowKind: "answer" as const,
          answerId: 1,
          label: "Instagram",
          pooledOptionCount: 0,
          distinctVoters: 7,
          overallCell: { status: "empty" as const },
          cellsByFlavorKey: {},
        },
        {
          rowKey: "q3-a2",
          rowKind: "answer" as const,
          answerId: 2,
          label: "TikTok",
          pooledOptionCount: 0,
          distinctVoters: 5,
          overallCell: { status: "empty" as const },
          cellsByFlavorKey: {},
        },
        {
          rowKey: "q3-masked",
          rowKind: "masked_pool" as const,
          answerId: null,
          label: "Masked small segments (n < 5)",
          pooledOptionCount: 2,
          distinctVoters: null,
          overallCell: { status: "suppressed" as const },
          cellsByFlavorKey: {},
        },
        {
          rowKey: "q3-unsurveyed",
          rowKind: "unsurveyed" as const,
          answerId: null,
          label: "No survey response on file",
          pooledOptionCount: 0,
          distinctVoters: 163,
          overallCell: { status: "empty" as const },
          cellsByFlavorKey: {},
        },
      ],
    };
    assert.equal(hasSuppressedCohortPool(study4Q3Shape), true);
    assert.equal(formatQuestionRespondentLabel(study4Q3Shape), "n≥12");

    const largePooledQuestion = {
      ...study4Q3Shape,
      surveyedRespondentCount: 18,
      rows: study4Q3Shape.rows.map((r) =>
        r.rowKind === "masked_pool" ? { ...r, distinctVoters: 6 } : r,
      ),
    };
    assert.equal(hasSuppressedCohortPool(largePooledQuestion), false);
    assert.equal(formatQuestionRespondentLabel(largePooledQuestion), "n=18");
  });

  it("matches flavor params, sorts lift tables, and resolves same-image pairs across all filter combinations", () => {
    const rowA = makeFlavorRow({
      key: "flavor:1",
      flavorId: 1,
      label: "alpha-pov",
      sharedImageCount: 4,
      rate: 0.4,
      imageBaselineMean: 0.3,
      meanLiftPp: 10,
      pairWinRate: 0.75,
      exposures: 80,
    });
    const rowB = makeFlavorRow({
      key: "flavor:2",
      flavorId: 2,
      label: "beta-pov",
      sharedImageCount: 6,
      rate: null,
      imageBaselineMean: null,
      meanLiftPp: null,
      pairWinRate: null,
      exposures: 40,
    });
    const rowC = makeFlavorRow({
      key: "flavor:3",
      flavorId: 3,
      label: "gamma-pov",
      sharedImageCount: 4,
      rate: 0.4,
      imageBaselineMean: 0.3,
      meanLiftPp: 10,
      pairWinRate: 0.75,
      exposures: 90,
    });
    const rowD = makeFlavorRow({
      key: "flavor:4",
      flavorId: 4,
      label: "delta-pov",
      sharedImageCount: 4,
      rate: 0.4,
      imageBaselineMean: 0.3,
      meanLiftPp: 10,
      pairWinRate: 0.75,
      exposures: 90,
    });
    const unattr = makeFlavorRow({
      key: UNATTRIBUTED_BUCKET_KEY,
      kind: "unattributed",
      isUnattributed: true,
      flavorId: null,
      label: UNATTRIBUTED_BUCKET_LABEL,
    });
    const rows = [unattr, rowB, rowA, rowC, rowD];

    assert.equal(matchFlavorRowByParam(rows, null), null);
    assert.equal(matchFlavorRowByParam(rows, "   "), null);
    assert.equal(matchFlavorRowByParam(rows, "2")?.label, "beta-pov");
    assert.equal(matchFlavorRowByParam(rows, "ALPHA-POV")?.flavorId, 1);
    assert.equal(matchFlavorRowByParam(rows, "flavor:3")?.label, "gamma-pov");
    assert.equal(matchFlavorRowByParam(rows, UNATTRIBUTED_BUCKET_LABEL), null);
    assert.equal(matchFlavorRowByParam(rows, "missing"), null);

    assert.equal(getDefaultLiftSortDirection("label"), "asc");
    assert.equal(getDefaultLiftSortDirection("meanLiftPp"), "desc");

    for (const key of [
      "label",
      "sharedImageCount",
      "rate",
      "imageBaselineMean",
      "meanLiftPp",
      "pairWinRate",
    ] as const) {
      const descSorted = sortSameImageLiftRows(rows, key, "desc");
      assert.equal(descSorted[descSorted.length - 1].isUnattributed, true);
      const ascSorted = sortSameImageLiftRows(rows, key, "asc");
      assert.equal(ascSorted[ascSorted.length - 1].isUnattributed, true);
    }

    const groupMulti: SameImageComparisonGroup = {
      imageId: "img-a",
      imageUrl: "https://cdn.example.com/a.jpg",
      imageDescription: "Cat at keyboard",
      totalExposures: 90,
      imageMeanRate: 0.25,
      spreadPp: 30,
      captions: [
        {
          captionId: "c1",
          captionText: "Top A",
          flavorId: 1,
          flavorKey: "flavor:1",
          flavorSlug: "alpha-pov",
          terminalModelLabel: "GPT-5",
          exposures: 30,
          positive: 12,
          rate: 0.4,
          ciLow: 0.2,
          ciHigh: 0.6,
          liftPp: 15,
        },
        {
          captionId: "c2",
          captionText: "Second A",
          flavorId: 1,
          flavorKey: "flavor:1",
          flavorSlug: "alpha-pov",
          terminalModelLabel: "GPT-5",
          exposures: 30,
          positive: 9,
          rate: 0.3,
          ciLow: 0.15,
          ciHigh: 0.5,
          liftPp: 5,
        },
        {
          captionId: "c3",
          captionText: "Rival B",
          flavorId: 2,
          flavorKey: "flavor:2",
          flavorSlug: "beta-pov",
          terminalModelLabel: "Gemini 2.5 Pro",
          exposures: 30,
          positive: 3,
          rate: 0.1,
          ciLow: 0.03,
          ciHigh: 0.25,
          liftPp: -15,
        },
      ],
    };

    const singleCaptionGroup: SameImageComparisonGroup = {
      ...groupMulti,
      imageId: "img-single",
      captions: [groupMulti.captions[0]],
    };
    assert.equal(
      resolveSameImageGroupPair({
        group: singleCaptionGroup,
        flavorA: "all",
        flavorB: "all",
      }),
      null,
    );

    const allPair = resolveSameImageGroupPair({
      group: groupMulti,
      flavorA: "all",
      flavorB: "all",
    });
    assert.equal(allPair?.leftCard.captionId, "c1");
    assert.equal(allPair?.rightCard.captionId, "c3");
    assert.equal(allPair?.extraCards.length, 1);

    const onlyA = resolveSameImageGroupPair({
      group: groupMulti,
      flavorA: "flavor:1",
      flavorB: "all",
    });
    assert.equal(onlyA?.leftCard.captionId, "c1");
    assert.equal(onlyA?.rightCard.captionId, "c3");

    const onlyB = resolveSameImageGroupPair({
      group: groupMulti,
      flavorA: "all",
      flavorB: "flavor:2",
    });
    assert.equal(onlyB?.leftCard.captionId, "c1");
    assert.equal(onlyB?.rightCard.captionId, "c3");

    const sameFlavor = resolveSameImageGroupPair({
      group: groupMulti,
      flavorA: "flavor:1",
      flavorB: "flavor:1",
    });
    assert.equal(sameFlavor?.leftCard.captionId, "c1");
    assert.equal(sameFlavor?.rightCard.captionId, "c2");

    assert.equal(
      resolveSameImageGroupPair({
        group: groupMulti,
        flavorA: "flavor:2",
        flavorB: "flavor:2",
      }),
      null,
    );
    assert.equal(
      resolveSameImageGroupPair({
        group: groupMulti,
        flavorA: "flavor:999",
        flavorB: "all",
      }),
      null,
    );
    assert.equal(
      resolveSameImageGroupPair({
        group: groupMulti,
        flavorA: "all",
        flavorB: "flavor:999",
      }),
      null,
    );

    const directPair = resolveSameImageGroupPair({
      group: groupMulti,
      flavorA: "flavor:2",
      flavorB: "flavor:1",
    });
    assert.equal(directPair?.leftCard.captionId, "c3");
    assert.equal(directPair?.rightCard.captionId, "c1");

    // Verify single-flavor multi-caption fallback when onlyA / onlyB / all has no rival flavor.
    const sameFlavorOnlyGroup: SameImageComparisonGroup = {
      imageId: "img-b",
      imageUrl: null,
      imageDescription: null,
      totalExposures: 10,
      imageMeanRate: null,
      spreadPp: null,
      captions: [
        { ...groupMulti.captions[0], rate: null },
        { ...groupMulti.captions[1], rate: null },
      ],
    };
    const fbAll = resolveSameImageGroupPair({
      group: sameFlavorOnlyGroup,
      flavorA: "all",
      flavorB: "all",
    });
    const fbA = resolveSameImageGroupPair({
      group: sameFlavorOnlyGroup,
      flavorA: "flavor:1",
      flavorB: "all",
    });
    const fbB = resolveSameImageGroupPair({
      group: sameFlavorOnlyGroup,
      flavorA: "all",
      flavorB: "flavor:1",
    });
    assert.equal(fbAll?.rightCard.captionId, "c2");
    assert.equal(fbA?.rightCard.captionId, "c2");
    assert.equal(fbB?.leftCard.captionId, "c1");

    const sortedByGap = sortResolvedGroupPairs([fbAll!, allPair!], "gap");
    assert.equal(sortedByGap[0].group.imageId, "img-a");
    const sortedByWinner = sortResolvedGroupPairs([fbAll!, allPair!], "winner");
    assert.equal(sortedByWinner[0].group.imageId, "img-a");
    const sortedByExp = sortResolvedGroupPairs([fbAll!, allPair!], "exposures");
    assert.equal(sortedByExp[0].group.imageId, "img-a");
  });
});
