import Link from "next/link";
import { notFound } from "next/navigation";

import { DemographicCohortHeatmap } from "@/components/demographic-cohort-heatmap";
import { StudySubNav } from "@/components/study-sub-nav";
import { TopNavbar } from "@/components/top-navbar";
import { formatSurveyedVoterSummary } from "@/utils/attribution-export";
import {
  abbreviateSurveyQuestion,
  MIN_COHORT_VOTERS,
  selectHeadlineTasteGap,
} from "@/utils/attribution-stats";
import {
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
  const surveyedSubtitle =
    demographics.surveyedVoterCount >= MIN_COHORT_VOTERS
      ? `${demographics.surveyedVoterCount.toLocaleString()} of ${demographics.studyVoterCount.toLocaleString()} scored voters have profile surveys · n per question reflects respondents to that question`
      : surveyedSummary.subtitle;

  const showCohortMatrix =
    demographics.surveyedVoterCount >= MIN_COHORT_VOTERS &&
    demographics.totalVisibleSegments > 0;

  const overallSampleCaptions = (captionMetrics ?? [])
    .filter((item) => item.exposures > 0 && item.rate !== null)
    .slice(0, 3);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNavbar />
      <main className="page-shell flex-1 p-4 text-foreground sm:p-6">
        <section className="app-panel mx-auto w-full max-w-7xl space-y-5 rounded-2xl p-5 sm:p-6">
          <StudySubNav
            study={bundle.study}
            studies={bundle.studies}
            activeTab="demographics"
            exposureMode={exposureBundle.mode}
            isTransitionalLikert={exposureBundle.isTransitionalLikert}
            excludeHighRisk={bundle.excludeHighRisk}
            highRiskVoterCount={exposureBundle.highRiskVoterCount}
          />

          <section className="grid gap-3 tabular-nums sm:grid-cols-2 xl:grid-cols-4">
            <article className="app-card app-stat-card-teal flex min-w-0 flex-col rounded-xl p-4">
              <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                Surveyed Voters
              </p>
              <div className="mt-2 flex min-h-8 min-w-0 items-center">
                <p className="truncate text-2xl leading-8 font-semibold">
                  {surveyedSummary.primary}
                </p>
              </div>
              <p className="app-muted mt-1.5 text-xs leading-5">
                {surveyedSubtitle}
              </p>
            </article>

            <article className="app-card app-stat-card-sky flex min-w-0 flex-col rounded-xl p-4">
              <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                Visible Segments
              </p>
              <div className="mt-2 flex min-h-8 min-w-0 items-center">
                <p className="truncate text-2xl leading-8 font-semibold">
                  {demographics.totalVisibleSegments.toLocaleString()}
                </p>
              </div>
              <p className="app-muted mt-1.5 text-xs leading-5">
                k ≥ {MIN_COHORT_VOTERS} voter floor ·{" "}
                {demographics.totalMaskedSegments.toLocaleString()} small
                segment
                {demographics.totalMaskedSegments === 1 ? "" : "s"} masked
              </p>
            </article>

            <article className="app-card app-stat-card-amber flex min-w-0 flex-col rounded-xl p-4">
              <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                Widest Taste Gap
              </p>
              <div className="mt-2 flex min-h-8 min-w-0 items-center">
                <p className="truncate text-2xl leading-8 font-semibold">
                  {topGap ? `+${topGap.spreadPp.toFixed(1)} pp` : "—"}
                </p>
              </div>
              {topGap ? (
                <div className="mt-1.5 space-y-0.5 text-xs leading-5">
                  <p className="break-words text-foreground">
                    <span className="font-semibold">
                      {topGap.questionLabel ??
                        abbreviateSurveyQuestion(topGap.questionText)}
                      :
                    </span>{" "}
                    {topGap.highAnswerLabel} (n=
                    {topGap.highVoters.toLocaleString()}) vs.{" "}
                    {topGap.lowAnswerLabel} (n=
                    {topGap.lowVoters.toLocaleString()})
                  </p>
                  {demographics.flavorColumns.length > 1 ? (
                    <p className="app-muted break-words font-mono text-[11px]">
                      {topGap.flavorSlug}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="app-muted mt-1.5 text-xs leading-5">
                  Need ≥ 2 segments with n ≥ {MIN_COHORT_VOTERS}
                </p>
              )}
            </article>

            <article className="app-card app-stat-card-rose flex min-w-0 flex-col rounded-xl p-4">
              <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                Quality Filter
              </p>
              <div className="mt-2 flex min-h-8 min-w-0 items-center">
                <p className="truncate text-lg leading-7 font-semibold sm:text-xl sm:leading-7">
                  {bundle.excludeHighRisk
                    ? "Rushed excluded"
                    : "All raters included"}
                </p>
              </div>
              <p className="app-muted mt-1.5 text-xs leading-5">
                {bundle.excludeHighRisk
                  ? `${exposureBundle.excludedVoterCount.toLocaleString()} high-risk voter${exposureBundle.excludedVoterCount === 1 ? "" : "s"} removed`
                  : `${exposureBundle.highRiskVoterCount.toLocaleString()} high-risk voter${exposureBundle.highRiskVoterCount === 1 ? "" : "s"} detected`}
              </p>
            </article>
          </section>

          {showCohortMatrix ? (
            <DemographicCohortHeatmap
              studyId={bundle.study.id}
              studyRate={studyRateCi.rate}
              exposureUnitLabel={exposureBundle.exposureUnitLabel}
              excludeHighRisk={bundle.excludeHighRisk}
              demographics={demographics}
              flavorRows={leaderboards.flavors}
              overallSampleCaptions={overallSampleCaptions}
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
