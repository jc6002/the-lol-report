import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adaptStudyExposures,
  buildStudyParticipationFunnel,
  getSwipeEventMatchKey,
  resolveStudyExposureMode,
  type RawStudyNavigationRow,
  type RawStudyParticipationRow,
  type RawStudyVoteRow,
} from "@/utils/study-exposure-adapter";

describe("utils/study-exposure-adapter", () => {
  it("resolves exposure modes cleanly across legacy, transitional Likert (7..21), and swipe studies", () => {
    assert.deepEqual(
      resolveStudyExposureMode({
        studyId: 3,
        hasNavigationEvents: false,
        hasVoteEvents: true,
      }),
      {
        mode: "likert_votes",
        isTransitionalLikert: false,
        detailHref: "/study/3/study-detail",
        exposureUnitLabel: "votes",
      },
    );

    // Study 8: id >= 7 but 0 nav events and 23k Likert votes
    assert.deepEqual(
      resolveStudyExposureMode({
        studyId: 8,
        hasNavigationEvents: false,
        hasVoteEvents: true,
      }),
      {
        mode: "likert_votes",
        isTransitionalLikert: true,
        detailHref: "/study/8/study-detail",
        exposureUnitLabel: "votes",
      },
    );

    assert.deepEqual(
      resolveStudyExposureMode({
        studyId: 122,
        hasNavigationEvents: true,
        hasVoteEvents: true,
      }),
      {
        mode: "swipe_navigation",
        isTransitionalLikert: false,
        detailHref: "/study/122/new-style-report",
        exposureUnitLabel: "seen cards",
      },
    );

    // Empty swipe-era study (e.g. Study 123)
    assert.deepEqual(
      resolveStudyExposureMode({
        studyId: 123,
        hasNavigationEvents: false,
        hasVoteEvents: false,
      }),
      {
        mode: "swipe_navigation",
        isTransitionalLikert: false,
        detailHref: "/study/123/new-style-report",
        exposureUnitLabel: "seen cards",
      },
    );
  });

  it("matches new-style-report same-session exposure & like invariance strictly", () => {
    assert.equal(
      getSwipeEventMatchKey({
        profile_id: "u1",
        study_caption_mapping_id: 10,
        session_id: null,
      }),
      "u1|10|no-session",
    );

    const navRows: RawStudyNavigationRow[] = [
      // Duplicate view on same mapping: counts as 1 exposure; second view matches vote session
      {
        id: 1,
        profile_id: "u1",
        caption_id: "c1",
        study_caption_mapping_id: 100,
        time_to_next_caption_ms: 2000,
        session_id: "s1",
        created_datetime_utc: "2026-10-01T00:00:01+00:00",
      },
      {
        id: 2,
        profile_id: "u1",
        caption_id: "c1",
        study_caption_mapping_id: 100,
        time_to_next_caption_ms: 4000,
        session_id: "s2",
        created_datetime_utc: "2026-10-01T00:00:05+00:00",
      },
      // Mismatched session vote below must NOT make mapping 101 positive
      {
        id: 3,
        profile_id: "u1",
        caption_id: "c2",
        study_caption_mapping_id: 101,
        time_to_next_caption_ms: 3000,
        session_id: "s1",
        created_datetime_utc: "2026-10-01T00:00:10+00:00",
      },
      // Null mapping ignored cleanly
      {
        id: 4,
        profile_id: "u1",
        caption_id: "c3",
        study_caption_mapping_id: null,
        time_to_next_caption_ms: 1500,
        session_id: "s1",
        created_datetime_utc: "2026-10-01T00:00:12+00:00",
      },
    ];

    const voteRows: RawStudyVoteRow[] = [
      {
        id: 10,
        profile_id: "u1",
        caption_id: "c1",
        study_caption_mapping_id: 100,
        vote_value: "funny",
        time_to_vote_ms: 1200,
        session_id: "s2",
        created_datetime_utc: "2026-10-01T00:00:06+00:00",
      },
      // Mismatched session s999 vs s1
      {
        id: 11,
        profile_id: "u1",
        caption_id: "c2",
        study_caption_mapping_id: 101,
        vote_value: "funny",
        time_to_vote_ms: 900,
        session_id: "s999",
        created_datetime_utc: "2026-10-01T00:00:11+00:00",
      },
      // Orphan vote with zero nav events (like Study 22 pre-swipe votes)
      {
        id: 12,
        profile_id: "u2",
        caption_id: "c2",
        study_caption_mapping_id: 101,
        vote_value: "funny",
        time_to_vote_ms: 800,
        session_id: "s8",
        created_datetime_utc: "2026-10-01T00:00:15+00:00",
      },
      // Non-positive swipe vote row ("meh") MUST NOT be miscounted as a like
      {
        id: 13,
        profile_id: "u3",
        caption_id: "c1",
        study_caption_mapping_id: 100,
        vote_value: "meh",
        time_to_vote_ms: 950,
        session_id: "s9",
        created_datetime_utc: "2026-10-01T00:00:16+00:00",
      },
    ];

    const res = adaptStudyExposures({
      studyId: 22,
      voteRows,
      navigationRows: navRows,
    });

    assert.equal(res.mode, "swipe_navigation");
    // u1|100 (liked in s2) + u1|101 (cross-session liked in s999) + u2|101 (orphan positive recovered); u3 "meh" ignored!
    assert.equal(res.totalExposures, 3);
    assert.equal(res.totalPositive, 3);
    assert.equal(res.distinctVoters, 2);
    assert.equal(res.medianStudyDwellMs, 3000); // median of [2000, 3000, 4000]
    assert.equal(res.exposures[0].dwellMs, 3000); // median of [2000, 4000]
  });

  it("flags fast/monotone swipe raters while preserving thoughtful 0-like critics", () => {
    const navRows: RawStudyNavigationRow[] = [];
    const voteRows: RawStudyVoteRow[] = [];
    let nextId = 1;

    // u_careful_critic: 12 cards at 5000ms each, 0 likes -> MUST NOT be flagged
    // u_fast_skipper: 12 cards at 900ms each, 0 likes -> flagged (rapid_skip_all)
    // u_speed_clicker: 12 cards at 350ms each, 4 likes -> flagged (fast_swipe_cadence)
    // u_blind_liker: 10 cards at 2500ms each, 10 likes -> flagged (all_liked_monotone)
    // u_short: 4 cards at 200ms each -> <10 cards, NOT flagged
    const addSwipeUser = (
      userId: string,
      count: number,
      dwellMs: number,
      likedCount: number,
    ) => {
      for (let i = 0; i < count; i += 1) {
        const mappingId = 200 + i;
        navRows.push({
          id: nextId++,
          profile_id: userId,
          caption_id: `cap-${i}`,
          study_caption_mapping_id: mappingId,
          time_to_next_caption_ms: dwellMs,
          session_id: "sess",
          created_datetime_utc: `2026-10-02T00:00:${String(i).padStart(2, "0")}+00:00`,
        });
        if (i < likedCount) {
          voteRows.push({
            id: nextId++,
            profile_id: userId,
            caption_id: `cap-${i}`,
            study_caption_mapping_id: mappingId,
            vote_value: "funny",
            time_to_vote_ms: 500,
            session_id: "sess",
            created_datetime_utc: `2026-10-02T00:00:${String(i).padStart(2, "0")}+00:00`,
          });
        }
      }
    };

    addSwipeUser("u_careful_critic", 12, 5000, 0);
    addSwipeUser("u_fast_skipper", 12, 900, 0);
    addSwipeUser("u_speed_clicker", 12, 350, 4);
    addSwipeUser("u_blind_liker", 10, 2500, 10);
    addSwipeUser("u_short", 4, 200, 0);

    const unfiltered = adaptStudyExposures({
      studyId: 122,
      voteRows,
      navigationRows: navRows,
      excludeHighRisk: false,
    });
    assert.deepEqual(
      Array.from(unfiltered.highRiskProfileIds).sort(),
      ["u_blind_liker", "u_fast_skipper", "u_speed_clicker"],
    );
    assert.equal(unfiltered.excludedVoterCount, 0);
    assert.equal(unfiltered.totalExposures, 50);

    const filtered = adaptStudyExposures({
      studyId: 122,
      voteRows,
      navigationRows: navRows,
      excludeHighRisk: true,
    });
    assert.equal(filtered.excludedVoterCount, 3);
    assert.equal(filtered.totalExposures, 16); // u_careful_critic (12) + u_short (4)
    assert.equal(filtered.excludedExposureCount, 34);
  });

  it("handles untimed and timed Likert votes with exact Study 18 reconciliation and burst-gap detection", () => {
    const votes: RawStudyVoteRow[] = [];
    let nextId = 1;

    // u_burst_untimed: 10 untimed votes spaced 500ms apart with mixed votes -> flagged via fast_inter_vote_gap
    for (let i = 0; i < 10; i += 1) {
      const ms = String((i * 500) % 1000).padStart(3, "0");
      const sec = String(Math.floor((i * 500) / 1000)).padStart(2, "0");
      votes.push({
        id: nextId++,
        profile_id: "u_burst_untimed",
        caption_id: `c-${i}`,
        study_caption_mapping_id: i + 1,
        vote_value: i % 2 === 0 ? "funny" : "meh",
        time_to_vote_ms: null,
        session_id: null,
        created_datetime_utc: `2026-02-01T12:00:${sec}.${ms}+00:00`,
      });
    }

    // u_timed_fast: 10 timed votes at 300ms each with mixed votes -> flagged via fast_vote_time
    for (let i = 0; i < 10; i += 1) {
      votes.push({
        id: nextId++,
        profile_id: "u_timed_fast",
        caption_id: `c-${i}`,
        study_caption_mapping_id: i + 1,
        vote_value: i % 2 === 0 ? "very funny" : "not funny at all",
        time_to_vote_ms: 300,
        session_id: null,
        created_datetime_utc: `2026-02-01T13:${String(i).padStart(2, "0")}:00+00:00`,
      });
    }

    // u_monotone: 10 slow votes all negative -> flagged via monotone_polarity
    for (let i = 0; i < 10; i += 1) {
      votes.push({
        id: nextId++,
        profile_id: "u_monotone",
        caption_id: `c-${i}`,
        study_caption_mapping_id: i + 1,
        vote_value: "not very funny",
        time_to_vote_ms: 4000,
        session_id: null,
        created_datetime_utc: `2026-02-01T14:${String(i).padStart(2, "0")}:00+00:00`,
      });
    }

    // u_good: 10 slow mixed votes (5 timed, 5 untimed) -> NOT flagged
    for (let i = 0; i < 10; i += 1) {
      votes.push({
        id: nextId++,
        profile_id: "u_good",
        caption_id: `c-${i}`,
        study_caption_mapping_id: i + 1,
        vote_value: i < 4 ? "funny" : "didnt get it",
        time_to_vote_ms: i < 5 ? 3500 : null,
        session_id: null,
        created_datetime_utc: `2026-02-01T15:${String(i).padStart(2, "0")}:00+00:00`,
      });
    }

    const res = adaptStudyExposures({
      studyId: 18,
      voteRows: votes,
      navigationRows: [],
      excludeHighRisk: true,
    });

    assert.equal(res.mode, "likert_votes");
    assert.equal(res.isTransitionalLikert, true);
    assert.equal(res.reconciliation.timedVoteCount, 25);
    assert.equal(res.reconciliation.untimedVoteCount, 15);
    assert.equal(
      res.reconciliation.timedVoteCount + res.reconciliation.untimedVoteCount,
      res.allExposureCount,
    );
    assert.deepEqual(
      Array.from(res.highRiskProfileIds).sort(),
      ["u_burst_untimed", "u_monotone", "u_timed_fast"],
    );
    assert.equal(res.totalExposures, 10); // u_good only
    assert.equal(res.totalPositive, 4);
  });

  it("builds participation funnel stats and deck survival curves cleanly", () => {
    const emptyFunnel = buildStudyParticipationFunnel({
      participationRows: [],
      exposures: [],
    });
    assert.equal(emptyFunnel.completionRate, null);
    assert.equal(emptyFunnel.medianRunMinutes, null);
    assert.deepEqual(emptyFunnel.retentionCurve, []);

    const participations: RawStudyParticipationRow[] = [
      {
        profile_id: "u1",
        study_id: 122,
        started_at: "2026-10-10T10:00:00+00:00",
        ended_at: "2026-10-10T10:03:00+00:00", // 3 min
        completion_stats: null,
      },
      {
        profile_id: "u2",
        study_id: 122,
        started_at: "2026-10-10T10:00:00+00:00",
        ended_at: "2026-10-10T10:05:00+00:00", // 5 min
        completion_stats: null,
      },
      {
        profile_id: "u3",
        study_id: 122,
        started_at: "2026-10-10T10:00:00+00:00",
        ended_at: null,
        completion_stats: null,
      },
    ];

    // u1 saw 3 cards, u2 saw 2 cards, u3 saw 1 card
    const exposures = [
      { profileId: "u1", mappingId: 1, captionId: "c1", isPositive: true, dwellMs: 1000, firstSeenUtc: "t", firstEventId: 1 },
      { profileId: "u1", mappingId: 2, captionId: "c2", isPositive: false, dwellMs: 1000, firstSeenUtc: "t", firstEventId: 2 },
      { profileId: "u1", mappingId: 3, captionId: "c3", isPositive: true, dwellMs: 1000, firstSeenUtc: "t", firstEventId: 3 },
      { profileId: "u2", mappingId: 1, captionId: "c1", isPositive: false, dwellMs: 1000, firstSeenUtc: "t", firstEventId: 4 },
      { profileId: "u2", mappingId: 2, captionId: "c2", isPositive: true, dwellMs: 1000, firstSeenUtc: "t", firstEventId: 5 },
      { profileId: "u3", mappingId: 1, captionId: "c1", isPositive: false, dwellMs: 1000, firstSeenUtc: "t", firstEventId: 6 },
    ];

    const funnel = buildStudyParticipationFunnel({
      participationRows: participations,
      exposures,
    });
    assert.equal(funnel.participationsStarted, 3);
    assert.equal(funnel.participationsEnded, 2);
    assert.ok(Math.abs((funnel.completionRate ?? 0) - 2 / 3) < 1e-9);
    assert.equal(funnel.medianRunMinutes, 4);
    assert.deepEqual(funnel.retentionCurve, [
      { captionPosition: 1, activeUsers: 3, activeSharePct: 100, droppedUsers: 1 },
      { captionPosition: 2, activeUsers: 2, activeSharePct: 66.67, droppedUsers: 1 },
      { captionPosition: 3, activeUsers: 1, activeSharePct: 33.33, droppedUsers: 1 },
    ]);
  });

  it("eliminates duplicate-vote overflow cliffs (Study 20 #204 bug) and clamps depths to mappedCaptionCount", () => {
    // Reproduce Study 20 shape: 3-card deck where u1 cast a duplicate vote on mapping 2
    // (4 raw exposures across 3 distinct mappings), and u2 encountered an orphan 4th mapping.
    const exposures = [
      { profileId: "u1", mappingId: 1, captionId: "c1", isPositive: true, dwellMs: 1200, firstSeenUtc: "t1", firstEventId: 1 },
      { profileId: "u1", mappingId: 2, captionId: "c2", isPositive: true, dwellMs: 1200, firstSeenUtc: "t2", firstEventId: 2 },
      { profileId: "u1", mappingId: 2, captionId: "c2", isPositive: true, dwellMs: 900, firstSeenUtc: "t3", firstEventId: 3 },
      { profileId: "u1", mappingId: 3, captionId: "c3", isPositive: false, dwellMs: 1100, firstSeenUtc: "t4", firstEventId: 4 },
      { profileId: "u2", mappingId: 1, captionId: "c1", isPositive: false, dwellMs: 1000, firstSeenUtc: "t1", firstEventId: 5 },
      { profileId: "u2", mappingId: 2, captionId: "c2", isPositive: true, dwellMs: 1000, firstSeenUtc: "t2", firstEventId: 6 },
      { profileId: "u2", mappingId: 3, captionId: "c3", isPositive: true, dwellMs: 1000, firstSeenUtc: "t3", firstEventId: 7 },
      { profileId: "u2", mappingId: 99, captionId: "c99", isPositive: false, dwellMs: 1000, firstSeenUtc: "t4", firstEventId: 8 },
    ];

    // Without mappedCaptionCount, duplicate mappingId=2 for u1 still collapses to depth 3 (not 4).
    const dedupedOnly = buildStudyParticipationFunnel({
      participationRows: [],
      exposures: exposures.filter((e) => e.profileId === "u1"),
    });
    assert.equal(dedupedOnly.retentionCurve.length, 3);
    assert.equal(dedupedOnly.retentionCurve[2]?.activeSharePct, 100);

    // With mappedCaptionCount=3, both u1 and u2 terminate cleanly at card #3 (100% active across 1..3, zero #4 cliff).
    const clamped = buildStudyParticipationFunnel({
      participationRows: [],
      exposures,
      mappedCaptionCount: 3,
    });
    assert.deepEqual(clamped.retentionCurve, [
      { captionPosition: 1, activeUsers: 2, activeSharePct: 100, droppedUsers: 0 },
      { captionPosition: 2, activeUsers: 2, activeSharePct: 100, droppedUsers: 0 },
      { captionPosition: 3, activeUsers: 2, activeSharePct: 100, droppedUsers: 2 },
    ]);
  });

  it("deduplicates duplicate Likert (profile_id, study_caption_mapping_id) votes keeping latest row and exempts deliberate multi-label raters from monotone_polarity", () => {
    const votes: RawStudyVoteRow[] = [];
    // u_deliberate_enthusiast: 10 slow votes (2500ms each) using 2 distinct positive labels ("funny" + "very funny")
    // plus an earlier duplicate vote on mapping 1 that was revised from "meh" -> "very funny".
    votes.push({
      id: 1,
      profile_id: "u_deliberate_enthusiast",
      caption_id: "c-0",
      study_caption_mapping_id: 1,
      vote_value: "meh",
      time_to_vote_ms: 2200,
      session_id: null,
      created_datetime_utc: "2026-04-17T10:00:00+00:00",
    });
    for (let i = 0; i < 10; i += 1) {
      votes.push({
        id: 10 + i,
        profile_id: "u_deliberate_enthusiast",
        caption_id: `c-${i}`,
        study_caption_mapping_id: i + 1,
        vote_value: i % 2 === 0 ? "very funny" : "funny",
        time_to_vote_ms: 2500,
        session_id: null,
        created_datetime_utc: `2026-04-17T10:01:${String(i * 4).padStart(2, "0")}+00:00`,
      });
    }

    const res = adaptStudyExposures({
      studyId: 20,
      voteRows: votes,
      navigationRows: [],
      excludeHighRisk: true,
    });
    // Deduped 11 raw rows -> 10 exposures, latest row on mapping 1 ("very funny") kept, and NOT flagged!
    assert.equal(res.allExposureCount, 10);
    assert.equal(res.highRiskVoterCount, 0);
    assert.equal(res.totalExposures, 10);
    assert.equal(res.totalPositive, 10);
  });
});
