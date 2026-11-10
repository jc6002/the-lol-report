import Link from "next/link";
import { notFound } from "next/navigation";

import { DemographicCohortHeatmap } from "@/components/demographic-cohort-heatmap";
import { StudyExportToolbar } from "@/components/study-export-toolbar";
import { StudySubNav } from "@/components/study-sub-nav";
import { TopNavbar } from "@/components/top-navbar";
import {
  buildStudyExportPayload,
  formatSurveyedVoterSummary,
} from "@/utils/attribution-export";
import {
  abbreviateSurveyQuestion,
  MIN_COHORT_VOTERS,
  selectHeadlineTasteGap,
} from "@/utils/attribution-stats";
import {
  getFirstQueryParam,
  isTruthyFlagParam,
  parsePositiveStudyId,
} from "@/utils/attribution-ui-helpers";
import { getCachedStudyAttributionBundle } from "@/utils/study-lineage-loader";

type StudyDemographicsPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    excludeHighRisk?: string | string[];
    question?: string | string[];
    metric?: string | string[];
    cols?: string | string[];
    flavor?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

export default async function StudyDemographicsPage({
  params,
  searchParams,
}: StudyDemographicsPageProps) {
  const { id } = await params;
  const studyId = parsePositiveStudyId(id);
  if (studyId === null) {
    notFound();
  }

  const query = searchParams ? await searchParams : {};
  const excludeHighRisk = isTruthyFlagParam(query.excludeHighRisk);
  const initialQuestionParam = getFirstQueryParam(query.question) ?? null;
  const initialMetricParam = getFirstQueryParam(query.metric) ?? null;
  const initialColsParam = getFirstQueryParam(query.cols) ?? null;
  const initialFlavorParam = getFirstQueryParam(query.flavor) ?? null;
  const bundle = await getCachedStudyAttributionBundle(
    studyId,
    excludeHighRisk,
  );
  if (!bundle) {
    notFound();
  }

  const {
    demographics,
    exposureBundle,
    studyRateCi,
    leaderboards,
    captionMetrics,
  } = bundle;
  const topGap = selectHeadlineTasteGap(demographics.tasteGaps);
  const surveyedSummary = formatSurveyedVoterSummary(
    demographics.surveyedVoterCount,
    demographics.studyVoterCount,
  );
  const unsurveyedCount = Math.max(
    0,
    demographics.studyVoterCount - demographics.surveyedVoterCount,
  );
  const hasComplementaryUnsurveyed =
    unsurveyedCount >= 1 && unsurveyedCount < MIN_COHORT_VOTERS;
  const surveyedSubtitle =
    demographics.surveyedVoterCount >= MIN_COHORT_VOTERS &&
    demographics.studyVoterCount > 0
      ? hasComplementaryUnsurveyed
        ? `≥ ${(
            (Math.max(
              0,
              demographics.studyVoterCount - (MIN_COHORT_VOTERS - 1),
            ) /
              demographics.studyVoterCount) *
            100
          ).toFixed(1)}% survey coverage · n varies by question`
        : `${(
            (demographics.surveyedVoterCount / demographics.studyVoterCount) *
            100
          ).toFixed(1)}% survey coverage · n varies by question`
      : surveyedSummary.subtitle;

  const questionsWithSignal = demographics.questions.filter(
    (q) => q.visibleSegmentCount >= 2,
  ).length;

  const showCohortMatrix =
    demographics.surveyedVoterCount >= MIN_COHORT_VOTERS &&
    demographics.totalVisibleSegments > 0;

  const overallSampleCaptions = (captionMetrics ?? [])
    .filter((item) => item.exposures > 0 && item.rate !== null)
    .slice(0, 3);
  const exportPayload = buildStudyExportPayload(bundle);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNavbar />
      <main className="page-shell flex-1 p-3 text-foreground sm:p-6">
        <section className="app-panel mx-auto w-full max-w-7xl space-y-4 rounded-2xl p-4 sm:space-y-5 sm:p-6">
          <StudySubNav
            study={bundle.study}
            studies={bundle.studies}
            activeTab="demographics"
            exposureMode={exposureBundle.mode}
            isTransitionalLikert={exposureBundle.isTransitionalLikert}
            excludeHighRisk={bundle.excludeHighRisk}
            highRiskVoterCount={exposureBundle.highRiskVoterCount}
            actions={<StudyExportToolbar payload={exportPayload} />}
          />

          <section className="grid grid-cols-2 gap-2.5 tabular-nums sm:gap-3 xl:grid-cols-4">
            <article className="app-card app-stat-card-teal flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
              <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                Surveyed Voters
              </p>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                  {surveyedSummary.primary}
                </p>
              </div>
              <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                {surveyedSubtitle}
              </p>
            </article>

            <article className="app-card app-stat-card-sky flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
              <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                Visible Segments
              </p>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                  {demographics.totalVisibleSegments.toLocaleString()}
                </p>
              </div>
              <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                k ≥ {MIN_COHORT_VOTERS} floor ·{" "}
                {demographics.totalMaskedSegments.toLocaleString()} masked
              </p>
            </article>

            <article className="app-card app-stat-card-amber flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
              <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                Widest Taste Gap
              </p>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                  {topGap ? `+${topGap.spreadPp.toFixed(1)} pp` : "—"}
                </p>
              </div>
              {topGap ? (
                <div className="mt-1 space-y-0.5 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                  <p className="break-words text-foreground">
                    <span className="font-semibold">
                      {topGap.questionLabel ??
                        abbreviateSurveyQuestion(topGap.questionText)}
                      :
                    </span>{" "}
                    {topGap.highAnswerLabel} (
                    {topGap.coarsenVoters
                      ? `n≥${MIN_COHORT_VOTERS}`
                      : `n=${topGap.highVoters.toLocaleString()}`}
                    ) vs. {topGap.lowAnswerLabel} (
                    {topGap.coarsenVoters
                      ? `n≥${MIN_COHORT_VOTERS}`
                      : `n=${topGap.lowVoters.toLocaleString()}`}
                    )
                  </p>
                  {demographics.flavorColumns.length > 1 ? (
                    <p className="app-muted break-words font-mono text-[11px]">
                      {topGap.flavorSlug}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                  Need ≥ 2 segments with n ≥ {MIN_COHORT_VOTERS}
                </p>
              )}
            </article>

            <article className="app-card app-stat-card-rose flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
              <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                Questions w/ Signal
              </p>
              <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                <p className="truncate text-xl leading-7 font-semibold sm:text-2xl sm:leading-8">
                  {questionsWithSignal.toLocaleString()} /{" "}
                  {demographics.questions.length.toLocaleString()}
                </p>
              </div>
              <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                ≥ 2 visible cohorts
                {bundle.excludeHighRisk
                  ? ` · ${exposureBundle.excludedVoterCount.toLocaleString()} rushed excluded`
                  : exposureBundle.highRiskVoterCount > 0
                    ? ` · ${exposureBundle.highRiskVoterCount.toLocaleString()} rushed included`
                    : ""}
              </p>
            </article>
          </section>

          {showCohortMatrix ? (
            <DemographicCohortHeatmap
              key={`${bundle.study.id}|${initialQuestionParam ?? ""}|${initialMetricParam ?? ""}|${initialColsParam ?? ""}|${initialFlavorParam ?? ""}`}
              studyId={bundle.study.id}
              studyRate={studyRateCi.rate}
              exposureUnitLabel={exposureBundle.exposureUnitLabel}
              excludeHighRisk={bundle.excludeHighRisk}
              demographics={demographics}
              flavorRows={leaderboards.flavors}
              overallSampleCaptions={overallSampleCaptions}
              initialQuestionParam={initialQuestionParam}
              initialMetricParam={initialMetricParam}
              initialColsParam={initialColsParam}
              initialFlavorParam={initialFlavorParam}
            />
          ) : (
            <article className="app-card space-y-3 rounded-xl p-6 text-sm">
              <p className="app-muted">
                {demographics.surveyedVoterCount < MIN_COHORT_VOTERS
                  ? `Fewer than ${MIN_COHORT_VOTERS} surveyed voters participated in this study, so cohort breakdowns are hidden to protect participant privacy.`
                  : `No individual answer segment reached k ≥ ${MIN_COHORT_VOTERS} surveyed voters in this study, so cohort breakdowns are hidden to protect participant privacy.`}
              </p>
              {bundle.excludeHighRisk &&
              exposureBundle.excludedVoterCount > 0 ? (
                <Link
                  href={`/study/${bundle.study.id}/demographics`}
                  className="app-button inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  Include all raters
                </Link>
              ) : null}
            </article>
          )}
        </section>
      </main>
    </div>
  );
}
