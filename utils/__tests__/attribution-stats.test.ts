import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  abbreviateSurveyQuestion,
  buildAttributionLeaderboards,
  buildCaptionMetricsAndHistogram,
  buildDemographicCohortMatrices,
  canonicalizeDemographicResponses,
  computeMedian,
  computeSameImageMetrics,
  computeWilsonConfidenceInterval,
  selectHeadlineTasteGap,
  UNATTRIBUTED_BUCKET_LABEL,
  type CaptionLineageInfo,
  type CohortTasteGapRow,
  type RawDemographicMappingRow,
  type RawDemographicUserResponseRow,
} from "@/utils/attribution-stats";
import type { UnifiedExposure } from "@/utils/study-exposure-adapter";

const makeLineage = (
  partial: Partial<CaptionLineageInfo> & { captionId: string },
): CaptionLineageInfo => ({
  captionId: partial.captionId,
  content: partial.content ?? `Caption ${partial.captionId}`,
  imageId: partial.imageId ?? null,
  imageUrl: partial.imageUrl ?? null,
  imageDescription: partial.imageDescription ?? null,
  attributionSource: partial.attributionSource ?? "direct_fk",
  flavorId: partial.flavorId ?? null,
  flavorSlug: partial.flavorSlug ?? null,
  flavorDescription: partial.flavorDescription ?? null,
  flavorStepCount: partial.flavorStepCount ?? 0,
  terminalModelId: partial.terminalModelId ?? null,
  terminalModelName: partial.terminalModelName ?? null,
  terminalProviderModelId: partial.terminalProviderModelId ?? null,
  terminalProviderName: partial.terminalProviderName ?? null,
  pipelineSignature: partial.pipelineSignature ?? null,
  pipelineSteps: partial.pipelineSteps ?? [],
  chainLatencySeconds: partial.chainLatencySeconds ?? null,
});

describe("utils/attribution-stats", () => {
  it("computes exact medians and bounded Wilson 95% confidence intervals", () => {
    assert.equal(computeMedian([]), null);
    assert.equal(computeMedian([9]), 9);
    assert.equal(computeMedian([10, 2, 6]), 6);
    assert.equal(computeMedian([10, 2, 6, 8]), 7);

    assert.deepEqual(computeWilsonConfidenceInterval(0, 0), {
      rate: null,
      low: null,
      high: null,
    });

    const zeroCi = computeWilsonConfidenceInterval(0, 50);
    assert.equal(zeroCi.rate, 0);
    assert.equal(zeroCi.low, 0);
    assert.ok((zeroCi.high ?? 0) > 0 && (zeroCi.high ?? 0) < 0.1);

    const fullCi = computeWilsonConfidenceInterval(50, 50);
    assert.equal(fullCi.rate, 1);
    assert.equal(fullCi.high, 1);
    assert.ok((fullCi.low ?? 0) > 0.9);

    // 2/2 (100%) MUST have a lower Wilson bound than 140/200 (70%)
    const smallSample = computeWilsonConfidenceInterval(2, 2);
    const largeSample = computeWilsonConfidenceInterval(140, 200);
    assert.ok((smallSample.low ?? 1) < (largeSample.low ?? 0));
  });

  it("canonicalizes duplicate and superseded demographic_user_responses cleanly", () => {
    const mappings: RawDemographicMappingRow[] = [
      { id: 10, question_id: 4, answer_id: 16, display_order: 1, is_deleted: false },
      { id: 11, question_id: 4, answer_id: 12, display_order: 2, is_deleted: false },
      { id: 12, question_id: 5, answer_id: 46, display_order: 1, is_deleted: false },
      { id: 13, question_id: 6, answer_id: 99, display_order: 1, is_deleted: true },
    ];
    const mappingsById = new Map(mappings.map((m) => [m.id, m]));

    const responses: RawDemographicUserResponseRow[] = [
      // Same-answer double-click duplicate (id 769 / 770)
      {
        id: 769,
        user_id: "u_dup",
        answer_question_mapping_id: 12,
        created_datetime_utc: "2026-09-22T10:00:01+00:00",
        modified_datetime_utc: "2026-09-22T10:00:01+00:00",
      },
      {
        id: 770,
        user_id: "u_dup",
        answer_question_mapping_id: 12,
        created_datetime_utc: "2026-09-22T10:00:01+00:00",
        modified_datetime_utc: "2026-09-22T10:00:01+00:00",
      },
      // Superseded survey retake on Q4: Graduate (16) -> SEAS (12) 3 days later
      {
        id: 596,
        user_id: "u_retake",
        answer_question_mapping_id: 10,
        created_datetime_utc: "2026-09-22T12:00:00+00:00",
        modified_datetime_utc: "2026-09-22T12:00:00+00:00",
      },
      {
        id: 984,
        user_id: "u_retake",
        answer_question_mapping_id: 11,
        created_datetime_utc: "2026-09-25T08:00:00+00:00",
        modified_datetime_utc: "2026-09-25T08:00:00+00:00",
      },
      // Deleted mapping ignored
      {
        id: 999,
        user_id: "u_retake",
        answer_question_mapping_id: 13,
        created_datetime_utc: "2026-09-25T08:00:00+00:00",
        modified_datetime_utc: null,
      },
    ];

    const canonical = canonicalizeDemographicResponses({
      responses,
      mappingsById,
    });
    assert.equal(canonical.get("u_dup")?.get(5)?.answerId, 46);
    assert.equal(canonical.get("u_retake")?.get(4)?.answerId, 12);
    assert.equal(canonical.get("u_retake")?.has(6), false);
  });

  it("computes mean-centered same-image lift, pair wins/ties, and Fubini-exact leaderboards", () => {
    const captionsById = new Map<string, CaptionLineageInfo>([
      [
        "c1",
        makeLineage({
          captionId: "c1",
          imageId: "img1",
          flavorId: 1,
          flavorSlug: "gigachad",
          flavorStepCount: 3,
          terminalModelId: 10,
          terminalModelName: "Gemini 2.5 Pro",
          terminalProviderModelId: "gemini-2.5-pro",
          terminalProviderName: "Google",
          pipelineSignature: "Gemini 2.5 Flash → Gemini 2.5 Pro",
          pipelineSteps: ["Gemini 2.5 Flash", "Gemini 2.5 Pro"],
          chainLatencySeconds: 4.5,
        }),
      ],
      [
        "c2",
        makeLineage({
          captionId: "c2",
          imageId: "img1",
          flavorId: 2,
          flavorSlug: "generic",
          flavorStepCount: 1,
          terminalModelId: 20,
          terminalModelName: "GPT-4o",
          terminalProviderModelId: "gpt-4o",
          terminalProviderName: "OpenAI",
          pipelineSignature: "GPT-4o",
          pipelineSteps: ["GPT-4o"],
          chainLatencySeconds: 1.5,
        }),
      ],
      // Second shared image produces an exact tie between flavor 1 and flavor 2
      [
        "c3",
        makeLineage({
          captionId: "c3",
          imageId: "img2",
          flavorId: 1,
          flavorSlug: "gigachad",
          flavorStepCount: 3,
          terminalModelId: 20,
          terminalModelName: "GPT-4o",
          pipelineSignature: "GPT-4o",
          pipelineSteps: ["GPT-4o"],
          chainLatencySeconds: 5.5,
        }),
      ],
      [
        "c4",
        makeLineage({
          captionId: "c4",
          imageId: "img2",
          flavorId: 2,
          flavorSlug: "generic",
          flavorStepCount: 1,
          terminalModelId: 20,
          terminalModelName: "GPT-4o",
          pipelineSignature: "GPT-4o",
          pipelineSteps: ["GPT-4o"],
          chainLatencySeconds: 2.5,
        }),
      ],
      // Single-caption image with unattributed caption
      [
        "c5",
        makeLineage({
          captionId: "c5",
          imageId: "img3",
          attributionSource: "unattributed",
        }),
      ],
      // Structural shared image with 0 exposures
      ["c6", makeLineage({ captionId: "c6", imageId: "img4", flavorId: 1, flavorSlug: "gigachad" })],
      ["c7", makeLineage({ captionId: "c7", imageId: "img4", flavorId: 2, flavorSlug: "generic" })],
      // Single-flavor multi-caption images: MUST NOT produce tautological 0.0 pp lift or dilute flavor 1's cross-flavor lift!
      ["c8", makeLineage({ captionId: "c8", imageId: "img5", flavorId: 1, flavorSlug: "gigachad", chainLatencySeconds: 5 })],
      ["c9", makeLineage({ captionId: "c9", imageId: "img5", flavorId: 1, flavorSlug: "gigachad", chainLatencySeconds: 5 })],
      ["c10", makeLineage({ captionId: "c10", imageId: "img6", flavorId: 3, flavorSlug: "solo-flavor", terminalModelId: 20, terminalModelName: "GPT-4o", pipelineSignature: "GPT-4o", pipelineSteps: ["GPT-4o"] })],
      ["c11", makeLineage({ captionId: "c11", imageId: "img6", flavorId: 3, flavorSlug: "solo-flavor", terminalModelId: 20, terminalModelName: "GPT-4o", pipelineSignature: "GPT-4o", pipelineSteps: ["GPT-4o"] })],
    ]);

    const exposures: UnifiedExposure[] = [];
    const pushExp = (captionId: string, total: number, pos: number) => {
      for (let i = 0; i < total; i += 1) {
        exposures.push({
          profileId: `u${i}`,
          mappingId: 1,
          captionId,
          isPositive: i < pos,
          dwellMs: 2000,
          firstSeenUtc: "2026-10-01T00:00:00+00:00",
          firstEventId: exposures.length + 1,
        });
      }
    };

    // img1: c1 = 8/10 (80%), c2 = 2/10 (20%) -> image mean 50%, c1 lift +30pp, c2 lift -30pp
    pushExp("c1", 10, 8);
    pushExp("c2", 10, 2);
    // img2: c3 = 5/10 (50%), c4 = 5/10 (50%) -> tie, lift 0pp each
    pushExp("c3", 10, 5);
    pushExp("c4", 10, 5);
    // img3 (unattributed): c5 = 9/10 (90%) -> highest raw rate but MUST stay pinned at bottom!
    pushExp("c5", 10, 9);
    // img5 (single-flavor gigachad vs gigachad): 9/10 vs 1/10 -> must NOT dilute flavor 1's +15pp lift!
    pushExp("c8", 10, 9);
    pushExp("c9", 10, 1);
    // img6 (single-flavor solo-flavor vs solo-flavor): must keep sharedImageCount=0 & meanLiftPp=null!
    pushExp("c10", 10, 4);
    pushExp("c11", 10, 2);

    const mappedCaptionIds = [
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
      "c8",
      "c9",
      "c10",
      "c11",
    ];
    const sameImage = computeSameImageMetrics({
      mappedCaptionIds,
      captionsById,
      exposures,
    });

    assert.equal(sameImage.structuralSharedImageCount, 5); // img1, img2, img4, img5, img6
    assert.equal(sameImage.evaluatedSharedImageCount, 4); // img1, img2, img5, img6
    assert.equal(sameImage.crossFlavorSharedImageCount, 2); // strictly img1 and img2!
    assert.equal(sameImage.maxImageSpreadPp, 80); // img5 has 90% - 10% = 80pp punchline variance

    const f1Lift = sameImage.liftByFlavorKey.get("flavor:1");
    const f2Lift = sameImage.liftByFlavorKey.get("flavor:2");
    assert.equal(f1Lift?.sharedImageCount, 2); // NOT 3!
    assert.equal(f1Lift?.meanLiftPp, 15); // mean of +30 and 0, NOT diluted by img5!
    assert.equal(f2Lift?.meanLiftPp, -15);
    assert.equal(f1Lift?.pairWins, 1);
    assert.equal(f1Lift?.pairTies, 1);
    assert.equal(f1Lift?.pairLosses, 0);
    assert.equal(sameImage.liftByFlavorKey.has("flavor:3"), false);

    const boards = buildAttributionLeaderboards({
      mappedCaptionIds,
      captionsById,
      exposures,
      sameImage,
    });

    const soloRow = boards.flavors.find((r) => r.flavorId === 3);
    assert.equal(soloRow?.sharedImageCount, 0);
    assert.equal(soloRow?.meanLiftPp, null);

    // Fubini reconciliation check across all 3 leaderboards
    for (const rows of [boards.flavors, boards.models, boards.pipelines]) {
      assert.equal(
        rows.reduce((sum, r) => sum + r.exposures, 0),
        exposures.length,
      );
      assert.equal(
        rows.reduce((sum, r) => sum + r.positive, 0),
        45,
      );
      assert.equal(
        rows.reduce((sum, r) => sum + r.captionCount, 0),
        mappedCaptionIds.length,
      );
      assert.equal(rows[rows.length - 1].label, UNATTRIBUTED_BUCKET_LABEL);
    }

    assert.equal(boards.flavors[0].label, "gigachad");
    assert.equal(boards.flavors[0].dominantModelLabel, "Gemini 2.5 Pro (+1)");
    assert.equal(boards.flavors[0].medianChainSeconds, 5); // median of [4.5, 5.5]
  });

  it("enforces strict k >= 5 cohort & cell privacy masking with zero leaked counts", () => {
    const captionsById = new Map<string, CaptionLineageInfo>([
      ["cA", makeLineage({ captionId: "cA", flavorId: 1, flavorSlug: "alpha" })],
      ["cB", makeLineage({ captionId: "cB", flavorId: 2, flavorSlug: "beta" })],
    ]);

    const exposures: UnifiedExposure[] = [];
    const responses: RawDemographicUserResponseRow[] = [];
    let respId = 1;

    // 6 Undergrad voters (answer 1): all 6 see alpha, only 3 see beta (cell suppression test!)
    for (let i = 0; i < 6; i += 1) {
      const uid = `undergrad_${i}`;
      responses.push({
        id: respId++,
        user_id: uid,
        answer_question_mapping_id: 101,
        created_datetime_utc: "2026-10-01T00:00:00+00:00",
        modified_datetime_utc: null,
      });
      exposures.push({
        profileId: uid,
        mappingId: 1,
        captionId: "cA",
        isPositive: i < 5, // 5/6 = 83.3%
        dwellMs: 1000,
        firstSeenUtc: "t",
        firstEventId: respId,
      });
      if (i < 3) {
        exposures.push({
          profileId: uid,
          mappingId: 2,
          captionId: "cB",
          isPositive: true,
          dwellMs: 1000,
          firstSeenUtc: "t",
          firstEventId: respId + 100,
        });
      }
    }

    // 5 Grad voters (answer 2): all 5 see alpha (1/5 = 20%) and beta (2/5 = 40%)
    for (let i = 0; i < 5; i += 1) {
      const uid = `grad_${i}`;
      responses.push({
        id: respId++,
        user_id: uid,
        answer_question_mapping_id: 102,
        created_datetime_utc: "2026-10-01T00:00:00+00:00",
        modified_datetime_utc: null,
      });
      exposures.push({
        profileId: uid,
        mappingId: 1,
        captionId: "cA",
        isPositive: i < 1,
        dwellMs: 1000,
        firstSeenUtc: "t",
        firstEventId: respId,
      });
      exposures.push({
        profileId: uid,
        mappingId: 2,
        captionId: "cB",
        isPositive: i < 2,
        dwellMs: 1000,
        firstSeenUtc: "t",
        firstEventId: respId + 200,
      });
    }

    // 3 Alumni voters (answer 3): small segment < 5 -> pooled & masked
    for (let i = 0; i < 3; i += 1) {
      const uid = `alum_${i}`;
      responses.push({
        id: respId++,
        user_id: uid,
        answer_question_mapping_id: 103,
        created_datetime_utc: "2026-10-01T00:00:00+00:00",
        modified_datetime_utc: null,
      });
      exposures.push({
        profileId: uid,
        mappingId: 1,
        captionId: "cA",
        isPositive: true,
        dwellMs: 1000,
        firstSeenUtc: "t",
        firstEventId: respId,
      });
    }

    // Double-click duplicate on undergrad_0 must not inflate alpha exposures above 6!
    responses.push({
      id: respId++,
      user_id: "undergrad_0",
      answer_question_mapping_id: 101,
      created_datetime_utc: "2026-10-01T00:00:02+00:00",
      modified_datetime_utc: "2026-10-01T00:00:02+00:00",
    });

    // 5 Unsurveyed voters
    for (let i = 0; i < 5; i += 1) {
      exposures.push({
        profileId: `anon_${i}`,
        mappingId: 1,
        captionId: "cA",
        isPositive: false,
        dwellMs: 1000,
        firstSeenUtc: "t",
        firstEventId: 900 + i,
      });
    }

    const boards = buildAttributionLeaderboards({
      mappedCaptionIds: ["cA", "cB"],
      captionsById,
      exposures,
    });

    const matrix = buildDemographicCohortMatrices({
      exposures,
      captionsById,
      flavorRows: boards.flavors,
      questions: [{ id: 4, question: "School?" }],
      answers: [
        { id: 1, answer: "Undergrad" },
        { id: 2, answer: "Grad" },
        { id: 3, answer: "Alumni" },
      ],
      mappings: [
        { id: 101, question_id: 4, answer_id: 1, display_order: 1, is_deleted: false },
        { id: 102, question_id: 4, answer_id: 2, display_order: 2, is_deleted: false },
        { id: 103, question_id: 4, answer_id: 3, display_order: 3, is_deleted: false },
      ],
      responses,
    });

    assert.equal(matrix.studyVoterCount, 19);
    assert.equal(matrix.surveyedVoterCount, 14);
    assert.equal(matrix.totalVisibleSegments, 2);
    assert.equal(matrix.totalMaskedSegments, 1);

    const q = matrix.questions[0];
    assert.deepEqual(
      q.rows.map((r) => r.label),
      [
        "Undergrad",
        "Grad",
        "Small cohorts (n < 5)",
        "No survey response on file",
      ],
    );

    const undergradRow = q.rows[0];
    const gradRow = q.rows[1];
    const undergradAlpha = undergradRow.cellsByFlavorKey["flavor:1"];
    assert.equal(undergradAlpha.status, "visible");
    if (undergradAlpha.status === "visible") {
      assert.equal(undergradAlpha.exposures, 6); // not 7 despite duplicate response row
      assert.equal(undergradAlpha.distinctVoters, 6);
    }

    // Cell with n=3 voters inside visible n=6 cohort MUST carry zero numeric keys!
    const undergradBeta = undergradRow.cellsByFlavorKey["flavor:2"];
    assert.deepEqual(undergradBeta, { status: "suppressed" });
    assert.deepEqual(Object.keys(undergradBeta), ["status"]);

    // Complementary column suppression: on flavor:2 (total 8 voters = 3 Undergrad + 5 Grad),
    // leaving Grad (n=5) visible would let ColumnTotal(8) - Grad(5) = 3 reveal Undergrad's 3 voters!
    const gradBeta = gradRow.cellsByFlavorKey["flavor:2"];
    assert.deepEqual(gradBeta, {
      status: "suppressed",
      reason: "complementary",
    });

    // Masked pool row with only 3 pooled voters MUST hide distinctVoters (null) & suppress cells
    const maskedRow = q.rows[2];
    assert.equal(maskedRow.distinctVoters, null);
    assert.equal(maskedRow.pooledOptionCount, 1);
    assert.deepEqual(maskedRow.overallCell, { status: "suppressed" });

    // Unsurveyed row has 0 exposures on beta -> "empty"; on alpha (total 19 voters, 3 Alumni hidden),
    // unsurveyed (n=5) is preferred first for complementary suppression so Undergrad vs Grad stays visible!
    const unsurveyedRow = q.rows[3];
    assert.deepEqual(unsurveyedRow.cellsByFlavorKey["flavor:2"], {
      status: "empty",
    });
    assert.deepEqual(unsurveyedRow.cellsByFlavorKey["flavor:1"], {
      status: "suppressed",
      reason: "complementary",
    });

    // Taste gap found strictly between Undergrad (83.33%) and Grad (20%) on alpha (+63.33pp)
    assert.equal(matrix.tasteGaps.length, 1);
    assert.equal(matrix.tasteGaps[0].flavorSlug, "alpha");
    assert.equal(matrix.tasteGaps[0].questionLabel, "School");
    assert.equal(matrix.tasteGaps[0].highAnswerLabel, "Undergrad");
    assert.equal(matrix.tasteGaps[0].lowAnswerLabel, "Grad");
    assert.equal(matrix.tasteGaps[0].coarsenVoters, true);
    assert.ok(Math.abs(matrix.tasteGaps[0].spreadPp - 63.3333) < 0.01);

    // Regression for Study #20 Q2/Q5 geometry: when unsurveyed (n=50) >> Computer Science (n=14)
    // with 3 pooled small-cohort voters + 1 question skipper (18 surveyed total),
    // rowMaskPriority MUST suppress unsurveyed (prio 0) rather than Computer Science (prio 2),
    // and set coarsenVoterCounts + hideUnsurveyedCount so 18 - 14 = 4 cannot isolate small cohorts!
    const q5Exposures = [];
    const q5Responses = [];
    let q5Id = 1;
    // 14 CS voters (answer 1)
    for (let i = 0; i < 14; i += 1) {
      const uid = `cs_${i}`;
      q5Responses.push(
        {
          id: q5Id++,
          user_id: uid,
          answer_question_mapping_id: 201,
          created_datetime_utc: "2026-10-01T00:00:00Z",
          modified_datetime_utc: null,
        },
        {
          id: q5Id++,
          user_id: uid,
          answer_question_mapping_id: 301,
          created_datetime_utc: "2026-10-01T00:00:00Z",
          modified_datetime_utc: null,
        },
      );
      q5Exposures.push({
        profileId: uid,
        mappingId: 1,
        captionId: "cA",
        isPositive: i < 7,
        dwellMs: 1200,
        firstSeenUtc: "t",
        firstEventId: q5Id,
      });
    }
    // 3 Math voters (< 5 -> pooled on Q5, answered Q2)
    for (let i = 0; i < 3; i += 1) {
      const uid = `math_${i}`;
      q5Responses.push(
        {
          id: q5Id++,
          user_id: uid,
          answer_question_mapping_id: 202,
          created_datetime_utc: "2026-10-01T00:00:00Z",
          modified_datetime_utc: null,
        },
        {
          id: q5Id++,
          user_id: uid,
          answer_question_mapping_id: 302,
          created_datetime_utc: "2026-10-01T00:00:00Z",
          modified_datetime_utc: null,
        },
      );
      q5Exposures.push({
        profileId: uid,
        mappingId: 1,
        captionId: "cA",
        isPositive: false,
        dwellMs: 1200,
        firstSeenUtc: "t",
        firstEventId: q5Id,
      });
    }
    // 1 surveyed voter who answered Q10 (id 99) only and skipped both Q5 and Q2
    q5Responses.push({
      id: q5Id++,
      user_id: "skipper_0",
      answer_question_mapping_id: 401,
      created_datetime_utc: "2026-10-01T00:00:00Z",
      modified_datetime_utc: null,
    });
    q5Exposures.push({
      profileId: "skipper_0",
      mappingId: 1,
      captionId: "cA",
      isPositive: true,
      dwellMs: 1200,
      firstSeenUtc: "t",
      firstEventId: q5Id++,
    });
    // 49 unsurveyed voters -> 50 total unsurveyed on Q5 & Q2 (>> 14 CS voters!)
    for (let i = 0; i < 49; i += 1) {
      q5Exposures.push({
        profileId: `u_unsurv_${i}`,
        mappingId: 1,
        captionId: "cA",
        isPositive: i % 2 === 0,
        dwellMs: 1200,
        firstSeenUtc: "t",
        firstEventId: 5000 + i,
      });
    }

    const q5Boards = buildAttributionLeaderboards({
      mappedCaptionIds: ["cA"],
      captionsById,
      exposures: q5Exposures,
    });
    const q5Matrix = buildDemographicCohortMatrices({
      exposures: q5Exposures,
      captionsById,
      flavorRows: q5Boards.flavors,
      questions: [
        { id: 2, question: "Are you currently living on campus?" },
        { id: 5, question: "What is your major?" },
        { id: 99, question: "Anchor?" },
      ],
      answers: [
        { id: 11, answer: "Computer Science" },
        { id: 12, answer: "Mathematics" },
        { id: 21, answer: "Yes" },
        { id: 22, answer: "No" },
        { id: 31, answer: "Anchored" },
      ],
      mappings: [
        { id: 201, question_id: 5, answer_id: 11, display_order: 1, is_deleted: false },
        { id: 202, question_id: 5, answer_id: 12, display_order: 2, is_deleted: false },
        { id: 301, question_id: 2, answer_id: 21, display_order: 1, is_deleted: false },
        { id: 302, question_id: 2, answer_id: 22, display_order: 2, is_deleted: false },
        { id: 401, question_id: 99, answer_id: 31, display_order: 1, is_deleted: false },
      ],
      responses: q5Responses,
    });

    const majorQ = q5Matrix.questions.find((item) => item.questionId === 5)!;
    const csRow = majorQ.rows.find((r) => r.label === "Computer Science")!;
    const majorUnsurvRow = majorQ.rows.find((r) => r.rowKind === "unsurveyed")!;
    assert.equal(csRow.overallCell.status, "visible");
    assert.equal(csRow.cellsByFlavorKey["flavor:1"]?.status, "visible");
    assert.deepEqual(majorUnsurvRow.overallCell, {
      status: "suppressed",
      reason: "complementary",
    });
    assert.equal(majorQ.visibleSegmentCount, 1);
    assert.equal(majorQ.coarsenVoterCounts, true);
    assert.equal(majorQ.hideUnsurveyedCount, true);
  });

  it("abbreviates survey questions cleanly and prioritizes solid-sample headline taste gaps", () => {
    assert.equal(abbreviateSurveyQuestion("   "), "Survey question");
    assert.equal(
      abbreviateSurveyQuestion("What is your graduation year?"),
      "Graduation year",
    );
    assert.equal(
      abbreviateSurveyQuestion("Are you currently living on campus?"),
      "Living on campus",
    );
    assert.equal(
      abbreviateSurveyQuestion("Are you a transfer student?"),
      "Transfer student",
    );
    assert.equal(
      abbreviateSurveyQuestion("Which school are you associated with?"),
      "School",
    );
    assert.equal(abbreviateSurveyQuestion("What is your major?"), "Major");
    assert.equal(
      abbreviateSurveyQuestion(
        "Are you or have you ever been an undergraduate student at Columbia?",
      ),
      "Columbia undergrad",
    );
    assert.equal(
      abbreviateSurveyQuestion("Which dining hall are you associated with?"),
      "Dining hall",
    );
    assert.equal(
      abbreviateSurveyQuestion("What are your favorite comedians?"),
      "Favorite comedians",
    );
    assert.equal(
      abbreviateSurveyQuestion("Do you read campus satire?"),
      "Read campus satire",
    );
    assert.equal(abbreviateSurveyQuestion("???"), "???");

    assert.equal(selectHeadlineTasteGap([]), null);

    const noisyGap: CohortTasteGapRow = {
      questionId: 5,
      questionText: "What is your major?",
      questionLabel: "Major",
      flavorId: 1,
      flavorKey: "flavor:1",
      flavorSlug: "alpha",
      highAnswerLabel: "Physics",
      highRate: 0.65,
      highVoters: 6,
      lowAnswerLabel: "History",
      lowRate: 0.3,
      lowVoters: 8,
      spreadPp: 35,
    };
    const solidGap: CohortTasteGapRow = {
      ...noisyGap,
      questionId: 2,
      questionText: "Are you currently living on campus?",
      questionLabel: "Living on campus",
      highAnswerLabel: "No",
      highVoters: 24,
      lowAnswerLabel: "Yes",
      lowVoters: 18,
      spreadPp: 22.5,
    };

    assert.equal(
      selectHeadlineTasteGap([noisyGap, solidGap])?.questionLabel,
      "Living on campus",
    );
    assert.equal(selectHeadlineTasteGap([noisyGap])?.questionLabel, "Major");
  });

  it("partitions caption rates into exact half-open histogram buckets and selects disjoint top/bottom drilldown captions", () => {
    const rateTargets: Array<[string, number, number]> = [
      ["b0-zero", 10, 0], // 0.0 -> [0, 0.2)
      ["b0-high", 1000, 199], // 0.199 -> [0, 0.2)
      ["b1-edge", 10, 2], // 0.2 -> [0.2, 0.4)
      ["b1-high", 1000, 399], // 0.399 -> [0.2, 0.4)
      ["b2-edge", 10, 4], // 0.4 -> [0.4, 0.6)
      ["b3-edge", 10, 6], // 0.6 -> [0.6, 0.8)
      ["b4-edge", 10, 8], // 0.8 -> [0.8, 1.0]
      ["b4-full", 10, 10], // 1.0 -> [0.8, 1.0]
      ["unrated-1", 0, 0],
      ["unrated-2", 0, 0],
    ];

    const captionsById = new Map<string, CaptionLineageInfo>();
    const exposures: UnifiedExposure[] = [];
    for (const [id, exp, pos] of rateTargets) {
      captionsById.set(
        id,
        makeLineage({
          captionId: id,
          content: `Joke ${id}`,
          flavorId: 7,
          flavorSlug: "bench-flavor",
          flavorDescription: "Full un-truncated flavor prompt instructions",
          flavorStepCount: 2,
          terminalModelId: 14,
          terminalModelName: "Gemini 2.5 Pro",
          terminalProviderName: "Google",
          pipelineSignature: "GPT-5 → Gemini 2.5 Pro",
          pipelineSteps: ["GPT-5", "Gemini 2.5 Pro"],
          pipelineStepDetails: [
            { stepOrder: 1, modelName: "GPT-5", providerName: "OpenAI" },
            {
              stepOrder: 2,
              modelName: "Gemini 2.5 Pro",
              providerName: "Google",
            },
          ],
        }),
      );
      for (let i = 0; i < exp; i += 1) {
        exposures.push({
          profileId: `u_${id}_${i}`,
          mappingId: 1,
          captionId: id,
          isPositive: i < pos,
          dwellMs: 1500,
          firstSeenUtc: "t",
          firstEventId: exposures.length + 1,
        });
      }
    }

    const mappedIds = rateTargets.map(([id]) => id);
    const { captionMetrics, captionRateHistogram } =
      buildCaptionMetricsAndHistogram({
        mappedCaptionIds: [...mappedIds, "b0-zero"], // duplicate ID handled cleanly
        captionsById,
        exposures,
      });

    assert.equal(captionMetrics.length, rateTargets.length);
    assert.equal(captionRateHistogram.scoredCaptionCount, 8);
    assert.equal(captionRateHistogram.unratedCaptionCount, 2);
    assert.deepEqual(
      captionRateHistogram.buckets.map((b) => b.captionCount),
      [2, 2, 1, 1, 2],
    );
    const bucketSum = captionRateHistogram.buckets.reduce(
      (sum, bucket) => sum + bucket.captionCount,
      0,
    );
    assert.equal(bucketSum, captionRateHistogram.scoredCaptionCount);
    assert.equal(
      bucketSum + captionRateHistogram.unratedCaptionCount,
      rateTargets.length,
    );

    // 8 scored captions -> top 3 highest, bottom 2 lowest, strictly disjoint
    const fullBoards = buildAttributionLeaderboards({
      mappedCaptionIds: mappedIds,
      captionsById,
      exposures,
    });
    const flavorRow = fullBoards.flavors[0];
    assert.equal(
      flavorRow.description,
      "Full un-truncated flavor prompt instructions",
    );
    assert.equal(flavorRow.pipelineStepDetails?.length, 2);
    assert.equal(flavorRow.topCaptions?.length, 3);
    assert.equal(flavorRow.bottomCaptions?.length, 2);
    assert.equal(flavorRow.topCaptions?.[0].captionId, "b4-full");
    assert.equal(flavorRow.bottomCaptions?.[0].captionId, "b0-zero");
    const topSet = new Set(flavorRow.topCaptions?.map((c) => c.captionId));
    for (const low of flavorRow.bottomCaptions ?? []) {
      assert.equal(topSet.has(low.captionId), false);
    }

    // 2 scored captions -> 1 top + 1 bottom (never leaves bottom empty)
    const twoCardBoards = buildAttributionLeaderboards({
      mappedCaptionIds: ["b4-full", "b0-zero"],
      captionsById,
      exposures: exposures.filter(
        (e) => e.captionId === "b4-full" || e.captionId === "b0-zero",
      ),
    });
    assert.equal(twoCardBoards.flavors[0].topCaptions?.length, 1);
    assert.equal(twoCardBoards.flavors[0].bottomCaptions?.length, 1);
    assert.equal(twoCardBoards.flavors[0].topCaptions?.[0].captionId, "b4-full");
    assert.equal(
      twoCardBoards.flavors[0].bottomCaptions?.[0].captionId,
      "b0-zero",
    );

    // 1 scored caption -> 1 top + 0 bottom
    const oneCardBoards = buildAttributionLeaderboards({
      mappedCaptionIds: ["b4-full"],
      captionsById,
      exposures: exposures.filter((e) => e.captionId === "b4-full"),
    });
    assert.equal(oneCardBoards.flavors[0].topCaptions?.length, 1);
    assert.equal(oneCardBoards.flavors[0].bottomCaptions?.length, 0);

    // 0-exposure staging study -> up to 4 staged captions in topCaptions, 0 bottom
    const stagedIds = ["unrated-1", "unrated-2", "b0-zero", "b1-edge", "b2-edge"];
    const stagedBoards = buildAttributionLeaderboards({
      mappedCaptionIds: stagedIds,
      captionsById,
      exposures: [],
    });
    assert.equal(stagedBoards.flavors[0].topCaptions?.length, 4);
    assert.equal(stagedBoards.flavors[0].bottomCaptions?.length, 0);

    // Tied top/bottom caption scores break ties deterministically by exposures DESC then captionId ASC,
    // missing lineage skips step details cleanly, and deferred step details backfill group pipeline metadata.
    const tieLineages = new Map<string, CaptionLineageInfo>([
      ["tie-top-a", makeLineage({ captionId: "tie-top-a", flavorId: 9, flavorSlug: "tie-flv" })],
      ["tie-top-b", makeLineage({ captionId: "tie-top-b", flavorId: 9, flavorSlug: "tie-flv", pipelineSteps: ["GPT-4o"] })],
      ["tie-top-c", makeLineage({ captionId: "tie-top-c", flavorId: 9, flavorSlug: "tie-flv" })],
      ["tie-low-10", makeLineage({ captionId: "tie-low-10", flavorId: 9, flavorSlug: "tie-flv" })],
      ["tie-low-20", makeLineage({ captionId: "tie-low-20", flavorId: 9, flavorSlug: "tie-flv" })],
      ["tie-low-20b", makeLineage({ captionId: "tie-low-20b", flavorId: 9, flavorSlug: "tie-flv" })],
    ]);
    const tieExposures: UnifiedExposure[] = [];
    const pushTie = (id: string, total: number, pos: number) => {
      for (let i = 0; i < total; i += 1) {
        tieExposures.push({
          profileId: `tu_${id}_${i}`,
          mappingId: 1,
          captionId: id,
          isPositive: i < pos,
          dwellMs: 1000,
          firstSeenUtc: "t",
          firstEventId: tieExposures.length + 1,
        });
      }
    };
    pushTie("tie-top-a", 10, 10);
    pushTie("tie-top-b", 10, 10);
    pushTie("tie-top-c", 10, 9);
    pushTie("tie-low-10", 10, 0);
    pushTie("tie-low-20", 20, 0);
    pushTie("tie-low-20b", 20, 0);
    pushTie("orphan-exp", 2, 1);

    const tieHist = buildCaptionMetricsAndHistogram({
      mappedCaptionIds: ["tie-top-b", "tie-top-a", "missing-lineage"],
      captionsById: tieLineages,
      exposures: tieExposures,
    });
    assert.deepEqual(
      tieHist.captionMetrics.map((c) => c.captionId),
      ["tie-top-a", "tie-top-b", "missing-lineage"],
    );

    const tieBoards = buildAttributionLeaderboards({
      mappedCaptionIds: [
        "tie-top-a",
        "tie-top-b",
        "tie-top-c",
        "tie-low-10",
        "tie-low-20b",
        "tie-low-20",
        "missing-lineage",
      ],
      captionsById: tieLineages,
      exposures: tieExposures,
    });
    const flv9 = tieBoards.flavors.find((r) => r.flavorId === 9);
    assert.deepEqual(flv9?.pipelineSteps, ["GPT-4o"]);
    assert.equal(flv9?.bottomCaptions?.[0]?.captionId, "tie-low-20");
    assert.equal(flv9?.bottomCaptions?.[1]?.captionId, "tie-low-20b");
  });
});
