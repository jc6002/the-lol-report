import { notFound } from "next/navigation";

import { StudyAttributionLeaderboard } from "@/components/study-attribution-leaderboard";
import { StudyExportToolbar } from "@/components/study-export-toolbar";
import { StudySubNav } from "@/components/study-sub-nav";
import { TopNavbar } from "@/components/top-navbar";
import { buildStudyExportPayload } from "@/utils/attribution-export";
import {
  formatChainSecondsLabel,
  formatDwellDurationLabel,
  formatRatePercent,
  formatSignedLiftPp,
  getFirstQueryParam,
  isTruthyFlagParam,
  parsePositiveStudyId,
} from "@/utils/attribution-ui-helpers";
import { getCachedStudyAttributionBundle } from "@/utils/study-lineage-loader";

const formatCompactRunDuration = (minutes: number | null | undefined): string => {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) {
    return "n/a";
  }
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const secs = totalSeconds % 60;
  const totalMins = Math.floor(totalSeconds / 60);
  if (totalMins < 60) return secs > 0 ? `${totalMins}m ${secs}s` : `${totalMins}m`;
  const mins = totalMins % 60;
  const hrs = Math.floor(totalMins / 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
};

type StudyAttributionPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    excludeHighRisk?: string | string[];
    groupBy?: string | string[];
    flavor?: string | string[];
    model?: string | string[];
  }>;
};

export default async function StudyAttributionPage({
  params,
  searchParams,
}: StudyAttributionPageProps) {
  const { id } = await params;
  const studyId = parsePositiveStudyId(id);
  if (studyId === null) {
    notFound();
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const excludeHighRisk = isTruthyFlagParam(
    resolvedSearchParams.excludeHighRisk,
  );
  const initialGroupByParam = getFirstQueryParam(resolvedSearchParams.groupBy);
  const initialFlavorParam = getFirstQueryParam(resolvedSearchParams.flavor);
  const initialModelParam = getFirstQueryParam(resolvedSearchParams.model);

  const bundle = await getCachedStudyAttributionBundle(
    studyId,
    excludeHighRisk,
  );
  if (!bundle) {
    notFound();
  }

  const {
    study,
    studies,
    mappedCaptionCount,
    unattributedCaptionCount,
    studyRateCi,
    exposureBundle,
    participationFunnel,
    leaderboards,
    captionRateHistogram,
    captionMetrics,
  } = bundle;

  const attributedFlavors = leaderboards.flavors.filter(
    (row) => !row.isUnattributed,
  );
  const attributedModels = leaderboards.models.filter(
    (row) => !row.isUnattributed,
  );
  const evaluatedFlavors = attributedFlavors.filter((row) => row.exposures > 0);
  const isZeroVoteStagingStudy =
    mappedCaptionCount > 0 && exposureBundle.totalExposures === 0;
  const isSingleFlavorScoredStudy =
    !isZeroVoteStagingStudy && evaluatedFlavors.length <= 1;

  const topFlavor = evaluatedFlavors[0] ?? attributedFlavors[0];
  const topModel =
    attributedModels.find((row) => row.exposures > 0) ?? attributedModels[0];

  const studyRateKicker =
    exposureBundle.mode === "swipe_navigation"
      ? "Study Like Rate"
      : "Study Upvote Rate";

  const avgExposuresPerVoter =
    exposureBundle.distinctVoters > 0
      ? Math.round(exposureBundle.totalExposures / exposureBundle.distinctVoters)
      : 0;

  const stagedPreviewCaptions = isZeroVoteStagingStudy
    ? (captionMetrics ?? []).slice(0, 6)
    : [];
  const exportPayload = buildStudyExportPayload(bundle);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNavbar />
      <main className="page-shell flex-1 p-3 text-foreground sm:p-6">
        <section className="app-panel mx-auto w-full max-w-7xl space-y-4 rounded-2xl p-4 sm:space-y-5 sm:p-6">
          <StudySubNav
            study={study}
            studies={studies}
            activeTab="attribution"
            exposureMode={exposureBundle.mode}
            isTransitionalLikert={exposureBundle.isTransitionalLikert}
            excludeHighRisk={excludeHighRisk}
            highRiskVoterCount={exposureBundle.highRiskVoterCount}
            actions={<StudyExportToolbar payload={exportPayload} />}
          />

          {mappedCaptionCount === 0 ? (
            <div className="app-card rounded-xl p-6 text-center text-sm">
              No captions are linked to this study yet.
            </div>
          ) : isZeroVoteStagingStudy ? (
            <>
              <article className="app-card app-stat-card-teal rounded-xl p-4 sm:p-5">
                <p className="text-sm font-semibold text-foreground sm:text-base">
                  No participant votes collected yet ·{" "}
                  {mappedCaptionCount.toLocaleString()} caption
                  {mappedCaptionCount === 1 ? "" : "s"} staged across{" "}
                  {attributedFlavors.length.toLocaleString()} prompt flavor
                  {attributedFlavors.length === 1 ? "" : "s"}
                </p>
                <p className="app-muted mt-1.5 text-xs leading-5">
                  {topFlavor ? (
                    <>
                      Flavor{" "}
                      <span className="font-mono font-semibold text-foreground">
                        {topFlavor.label}
                      </span>
                      {topModel ? ` · Synthesis model ${topModel.label}` : ""}
                      {study.is_private ? " · Private staging study" : ""}
                    </>
                  ) : (
                    <>
                      {mappedCaptionCount.toLocaleString()} unlinked captions
                      staged for evaluation
                      {study.is_private ? " · Private staging study" : ""}
                    </>
                  )}
                  {study.description ? ` · ${study.description}` : ""}
                </p>
              </article>

              {stagedPreviewCaptions.length > 0 ? (
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {stagedPreviewCaptions.map((sample) => (
                    <article
                      key={sample.captionId}
                      className="app-card flex min-w-0 flex-col overflow-hidden rounded-xl"
                    >
                      {sample.imageUrl ? (
                        <div className="flex h-44 w-full items-center justify-center bg-white/45 p-2.5 dark:bg-slate-950/25">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={sample.imageUrl}
                            alt={sample.imageDescription ?? sample.captionText}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className="flex h-44 w-full items-center justify-center bg-white/45 p-4 text-xs dark:bg-slate-950/25">
                          <span className="app-muted">Image unavailable</span>
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col p-3.5">
                        <p className="break-words text-sm font-semibold leading-5 text-foreground">
                          {sample.captionText}
                        </p>
                        <div className="mt-auto pt-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2.5 text-xs dark:border-slate-700/60">
                            <span className="truncate font-mono font-medium text-foreground">
                              {sample.flavorSlug}
                            </span>
                            <span className="app-muted font-mono text-[11px]">
                              {sample.modelName}
                            </span>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}

              <StudyAttributionLeaderboard
                key={`${study.id}|staged|${initialGroupByParam ?? ""}|${initialFlavorParam ?? ""}|${initialModelParam ?? ""}`}
                studyId={study.id}
                excludeHighRisk={excludeHighRisk}
                leaderboards={leaderboards}
                funnel={participationFunnel}
                captionRateHistogram={captionRateHistogram}
                hideCharts
                studyPositiveRate={studyRateCi.rate}
                totalExposures={exposureBundle.totalExposures}
                totalPositive={exposureBundle.totalPositive}
                exposureUnitLabel={exposureBundle.exposureUnitLabel}
                unattributedCaptionCount={unattributedCaptionCount}
                initialGroupByParam={initialGroupByParam}
                initialFlavorParam={initialFlavorParam}
                initialModelParam={initialModelParam}
              />
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
                <article className="app-card app-stat-card-teal flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
                  <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                    Participants &amp; Completion
                  </p>
                  {participationFunnel.participationsStarted > 0 ? (
                    <>
                      <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                        <p className="truncate text-xl leading-7 font-semibold tabular-nums sm:text-2xl sm:leading-8">
                          {formatRatePercent(participationFunnel.completionRate)}
                        </p>
                      </div>
                      <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                        {participationFunnel.participationsEnded.toLocaleString()}{" "}
                        /{" "}
                        {participationFunnel.participationsStarted.toLocaleString()}{" "}
                        finished ·{" "}
                        {formatCompactRunDuration(
                          participationFunnel.medianRunMinutes,
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                        <p className="truncate text-xl leading-7 font-semibold tabular-nums sm:text-2xl sm:leading-8">
                          {exposureBundle.distinctVoters.toLocaleString()}{" "}
                          {exposureBundle.distinctVoters === 1
                            ? "voter"
                            : "voters"}
                        </p>
                      </div>
                      <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                        {avgExposuresPerVoter.toLocaleString()}{" "}
                        {exposureBundle.exposureUnitLabel}/voter ·{" "}
                        {mappedCaptionCount.toLocaleString()} captions
                      </p>
                    </>
                  )}
                </article>

                <article className="app-card app-stat-card-sky flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
                  <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                    {studyRateKicker}
                  </p>
                  <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                    <p className="truncate text-xl leading-7 font-semibold tabular-nums sm:text-2xl sm:leading-8">
                      {formatRatePercent(studyRateCi.rate)}
                    </p>
                  </div>
                  <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                    {exposureBundle.totalExposures > 0 &&
                    studyRateCi.low !== null &&
                    studyRateCi.high !== null
                      ? `${exposureBundle.totalPositive.toLocaleString()}/${exposureBundle.totalExposures.toLocaleString()} · CI [${formatRatePercent(studyRateCi.low)}, ${formatRatePercent(studyRateCi.high)}]`
                      : `0 ${exposureBundle.exposureUnitLabel}`}
                  </p>
                </article>

                {isSingleFlavorScoredStudy ? (
                  <>
                    <article className="app-card app-stat-card-amber flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
                      <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                        Prompt Flavor &amp; Model
                      </p>
                      {topFlavor ? (
                        <>
                          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                            <p
                              title={topFlavor.label}
                              className="truncate font-mono text-xs leading-5 font-semibold sm:text-base sm:leading-6 xl:text-sm xl:leading-5"
                            >
                              {topFlavor.label}
                            </p>
                          </div>
                          <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                            {topModel?.label ??
                              topFlavor.dominantModelLabel ??
                              "Unattributed"}{" "}
                            · {topFlavor.captionCount.toLocaleString()}{" "}
                            {topFlavor.captionCount === 1
                              ? "caption"
                              : "captions"}
                            {topFlavor.stepCount
                              ? ` · ${topFlavor.stepCount}-step`
                              : ""}
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                            <p className="truncate text-base leading-6 font-semibold sm:text-lg sm:leading-7">
                              Manual captions
                            </p>
                          </div>
                          <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                            {mappedCaptionCount.toLocaleString()} unlinked study
                            captions
                          </p>
                        </>
                      )}
                    </article>

                    <article className="app-card app-stat-card-rose flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
                      <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                        Pacing &amp; Latency
                      </p>
                      {exposureBundle.medianStudyDwellMs !== null ? (
                        <>
                          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                            <p className="truncate text-xl leading-7 font-semibold tabular-nums sm:text-2xl sm:leading-8">
                              {formatDwellDurationLabel(
                                exposureBundle.medianStudyDwellMs,
                              )}
                            </p>
                          </div>
                          <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                            Median per card
                            {topModel?.medianChainSeconds !== null &&
                            topModel?.medianChainSeconds !== undefined
                              ? ` · ${formatChainSecondsLabel(topModel.medianChainSeconds)} chain`
                              : ` · ${mappedCaptionCount.toLocaleString()}-card deck`}
                          </p>
                        </>
                      ) : topModel?.medianChainSeconds !== null &&
                        topModel?.medianChainSeconds !== undefined ? (
                        <>
                          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                            <p className="truncate text-xl leading-7 font-semibold tabular-nums sm:text-2xl sm:leading-8">
                              {formatChainSecondsLabel(
                                topModel.medianChainSeconds,
                              )}
                            </p>
                          </div>
                          <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                            Median generation ·{" "}
                            {mappedCaptionCount.toLocaleString()}-card deck
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                            <p className="truncate text-xl leading-7 font-semibold tabular-nums sm:text-2xl sm:leading-8">
                              {mappedCaptionCount.toLocaleString()} cards
                            </p>
                          </div>
                          <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                            {exposureBundle.mode === "swipe_navigation"
                              ? "Swipe card deck"
                              : "Rating-scale study deck"}
                          </p>
                        </>
                      )}
                    </article>
                  </>
                ) : (
                  <>
                    <article className="app-card app-stat-card-amber flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
                      <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                        Leading Prompt Flavor
                      </p>
                      {topFlavor ? (
                        <>
                          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                            <p
                              title={topFlavor.label}
                              className="truncate font-mono text-xs leading-5 font-semibold sm:text-base sm:leading-6 xl:text-sm xl:leading-5"
                            >
                              {topFlavor.label}
                            </p>
                          </div>
                          <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                            {formatRatePercent(topFlavor.rate)} ·{" "}
                            {topFlavor.sharedImageCount > 0 &&
                            topFlavor.meanLiftPp !== null
                              ? `${formatSignedLiftPp(topFlavor.meanLiftPp)} lift`
                              : `${topFlavor.exposures.toLocaleString()} ${exposureBundle.exposureUnitLabel}`}
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                            <p className="truncate text-xl leading-7 font-semibold tabular-nums sm:text-2xl sm:leading-8">
                              —
                            </p>
                          </div>
                          <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                            No attributed flavor exposures
                          </p>
                        </>
                      )}
                    </article>

                    <article className="app-card app-stat-card-rose flex min-w-0 flex-col rounded-xl p-3 sm:p-4">
                      <p className="app-kicker text-[11px] leading-4 font-semibold uppercase tracking-wide sm:text-xs">
                        Leading Synthesis Model
                      </p>
                      {topModel ? (
                        <>
                          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                            <p
                              title={topModel.label}
                              className="truncate text-base leading-6 font-semibold sm:text-lg sm:leading-7"
                            >
                              {topModel.label}
                            </p>
                          </div>
                          <p className="app-muted mt-1 text-[11px] leading-4 tabular-nums sm:mt-1.5 sm:text-xs sm:leading-5">
                            {formatRatePercent(topModel.rate)} ·{" "}
                            {topModel.exposures.toLocaleString()}{" "}
                            {exposureBundle.exposureUnitLabel}
                            {topModel.medianChainSeconds !== null
                              ? ` · ${formatChainSecondsLabel(topModel.medianChainSeconds)}`
                              : ""}
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="mt-1.5 flex min-h-7 min-w-0 items-center sm:mt-2 sm:min-h-8">
                            <p className="truncate text-xl leading-7 font-semibold tabular-nums sm:text-2xl sm:leading-8">
                              —
                            </p>
                          </div>
                          <p className="app-muted mt-1 text-[11px] leading-4 sm:mt-1.5 sm:text-xs sm:leading-5">
                            No attributed model exposures
                          </p>
                        </>
                      )}
                    </article>
                  </>
                )}
              </div>

              <StudyAttributionLeaderboard
                key={`${study.id}|${initialGroupByParam ?? ""}|${initialFlavorParam ?? ""}|${initialModelParam ?? ""}`}
                studyId={study.id}
                excludeHighRisk={excludeHighRisk}
                leaderboards={leaderboards}
                funnel={participationFunnel}
                captionRateHistogram={captionRateHistogram}
                studyPositiveRate={studyRateCi.rate}
                totalExposures={exposureBundle.totalExposures}
                totalPositive={exposureBundle.totalPositive}
                exposureUnitLabel={exposureBundle.exposureUnitLabel}
                unattributedCaptionCount={unattributedCaptionCount}
                initialGroupByParam={initialGroupByParam}
                initialFlavorParam={initialFlavorParam}
                initialModelParam={initialModelParam}
              />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
