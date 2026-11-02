import { notFound } from "next/navigation";

import { StudyAttributionLeaderboard } from "@/components/study-attribution-leaderboard";
import { StudySubNav } from "@/components/study-sub-nav";
import { TopNavbar } from "@/components/top-navbar";
import {
  formatChainSecondsLabel,
  formatDwellDurationLabel,
  formatRatePercent,
  formatSignedLiftPp,
  getFirstQueryParam,
  isTruthyFlagParam,
  parsePositiveStudyId,
} from "@/utils/attribution-ui-helpers";
import { formatDurationFromMinutes } from "@/utils/format-duration";
import { getCachedStudyAttributionBundle } from "@/utils/study-lineage-loader";

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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNavbar />
      <main className="page-shell flex-1 p-4 text-foreground sm:p-6">
        <section className="app-panel mx-auto w-full max-w-7xl space-y-5 rounded-2xl p-5 sm:p-6">
          <StudySubNav
            study={study}
            studies={studies}
            activeTab="attribution"
            exposureMode={exposureBundle.mode}
            isTransitionalLikert={exposureBundle.isTransitionalLikert}
            excludeHighRisk={excludeHighRisk}
            highRiskVoterCount={exposureBundle.highRiskVoterCount}
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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <article className="app-card app-stat-card-teal flex min-w-0 flex-col rounded-xl p-4">
                  <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                    Participants &amp; Completion
                  </p>
                  {participationFunnel.participationsStarted > 0 ? (
                    <>
                      <div className="mt-2 flex min-h-8 min-w-0 items-center">
                        <p className="truncate text-2xl leading-8 font-semibold tabular-nums">
                          {formatRatePercent(participationFunnel.completionRate)}
                        </p>
                      </div>
                      <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
                        {participationFunnel.participationsEnded.toLocaleString()}{" "}
                        /{" "}
                        {participationFunnel.participationsStarted.toLocaleString()}{" "}
                        finished · median{" "}
                        {formatDurationFromMinutes(
                          participationFunnel.medianRunMinutes,
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="mt-2 flex min-h-8 min-w-0 items-center">
                        <p className="truncate text-2xl leading-8 font-semibold tabular-nums">
                          {exposureBundle.distinctVoters.toLocaleString()}{" "}
                          {exposureBundle.distinctVoters === 1
                            ? "voter"
                            : "voters"}
                        </p>
                      </div>
                      <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
                        {avgExposuresPerVoter.toLocaleString()}{" "}
                        {exposureBundle.exposureUnitLabel}/voter across{" "}
                        {mappedCaptionCount.toLocaleString()} captions
                      </p>
                    </>
                  )}
                </article>

                <article className="app-card app-stat-card-sky flex min-w-0 flex-col rounded-xl p-4">
                  <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                    {studyRateKicker}
                  </p>
                  <div className="mt-2 flex min-h-8 min-w-0 items-center">
                    <p className="truncate text-2xl leading-8 font-semibold tabular-nums">
                      {formatRatePercent(studyRateCi.rate)}
                    </p>
                  </div>
                  <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
                    {exposureBundle.totalExposures > 0 &&
                    studyRateCi.low !== null &&
                    studyRateCi.high !== null
                      ? `${exposureBundle.totalPositive.toLocaleString()} / ${exposureBundle.totalExposures.toLocaleString()} ${exposureBundle.exposureUnitLabel} · 95% CI [${formatRatePercent(studyRateCi.low)}, ${formatRatePercent(studyRateCi.high)}]`
                      : `0 ${exposureBundle.exposureUnitLabel}`}
                  </p>
                </article>

                {isSingleFlavorScoredStudy ? (
                  <>
                    <article className="app-card app-stat-card-amber flex min-w-0 flex-col rounded-xl p-4">
                      <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                        Prompt Flavor &amp; Model
                      </p>
                      {topFlavor ? (
                        <>
                          <div className="mt-2 flex min-h-8 min-w-0 items-center">
                            <p
                              title={topFlavor.label}
                              className="truncate font-mono text-sm leading-5 font-semibold sm:text-base sm:leading-6 xl:text-sm xl:leading-5"
                            >
                              {topFlavor.label}
                            </p>
                          </div>
                          <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
                            {topModel?.label ??
                              topFlavor.dominantModelLabel ??
                              "Unattributed"}{" "}
                            · {topFlavor.captionCount.toLocaleString()}{" "}
                            {topFlavor.captionCount === 1
                              ? "caption"
                              : "captions"}
                            {topFlavor.stepCount
                              ? ` · ${topFlavor.stepCount}-step chain`
                              : ""}
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="mt-2 flex min-h-8 min-w-0 items-center">
                            <p className="truncate text-lg leading-7 font-semibold">
                              Manual captions
                            </p>
                          </div>
                          <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
                            {mappedCaptionCount.toLocaleString()} unlinked study
                            captions
                          </p>
                        </>
                      )}
                    </article>

                    <article className="app-card app-stat-card-rose flex min-w-0 flex-col rounded-xl p-4">
                      <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                        Pacing &amp; Latency
                      </p>
                      {exposureBundle.medianStudyDwellMs !== null ? (
                        <>
                          <div className="mt-2 flex min-h-8 min-w-0 items-center">
                            <p className="truncate text-2xl leading-8 font-semibold tabular-nums">
                              {formatDwellDurationLabel(
                                exposureBundle.medianStudyDwellMs,
                              )}
                            </p>
                          </div>
                          <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
                            Median time per card
                            {topModel?.medianChainSeconds !== null &&
                            topModel?.medianChainSeconds !== undefined
                              ? ` · ${formatChainSecondsLabel(topModel.medianChainSeconds)} generation chain`
                              : ` · ${mappedCaptionCount.toLocaleString()}-card deck`}
                          </p>
                        </>
                      ) : topModel?.medianChainSeconds !== null &&
                        topModel?.medianChainSeconds !== undefined ? (
                        <>
                          <div className="mt-2 flex min-h-8 min-w-0 items-center">
                            <p className="truncate text-2xl leading-8 font-semibold tabular-nums">
                              {formatChainSecondsLabel(
                                topModel.medianChainSeconds,
                              )}
                            </p>
                          </div>
                          <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
                            Median prompt-chain generation ·{" "}
                            {mappedCaptionCount.toLocaleString()}-card deck
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="mt-2 flex min-h-8 min-w-0 items-center">
                            <p className="truncate text-2xl leading-8 font-semibold tabular-nums">
                              {mappedCaptionCount.toLocaleString()} cards
                            </p>
                          </div>
                          <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
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
                    <article className="app-card app-stat-card-amber flex min-w-0 flex-col rounded-xl p-4">
                      <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                        Leading Prompt Flavor
                      </p>
                      {topFlavor ? (
                        <>
                          <div className="mt-2 flex min-h-8 min-w-0 items-center">
                            <p
                              title={topFlavor.label}
                              className="truncate font-mono text-sm leading-5 font-semibold sm:text-base sm:leading-6 xl:text-sm xl:leading-5"
                            >
                              {topFlavor.label}
                            </p>
                          </div>
                          <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
                            {formatRatePercent(topFlavor.rate)} (CI low{" "}
                            {formatRatePercent(topFlavor.ciLow)}) ·{" "}
                            {topFlavor.sharedImageCount > 0 &&
                            topFlavor.meanLiftPp !== null
                              ? `${formatSignedLiftPp(topFlavor.meanLiftPp)} lift`
                              : `${topFlavor.exposures.toLocaleString()} ${exposureBundle.exposureUnitLabel}`}
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="mt-2 flex min-h-8 min-w-0 items-center">
                            <p className="truncate text-2xl leading-8 font-semibold tabular-nums">
                              —
                            </p>
                          </div>
                          <p className="app-muted mt-1.5 text-xs leading-5">
                            No attributed flavor exposures
                          </p>
                        </>
                      )}
                    </article>

                    <article className="app-card app-stat-card-rose flex min-w-0 flex-col rounded-xl p-4">
                      <p className="app-kicker text-xs leading-4 font-semibold uppercase tracking-wide">
                        Leading Synthesis Model
                      </p>
                      {topModel ? (
                        <>
                          <div className="mt-2 flex min-h-8 min-w-0 items-center">
                            <p
                              title={topModel.label}
                              className="truncate text-lg leading-7 font-semibold"
                            >
                              {topModel.label}
                            </p>
                          </div>
                          <p className="app-muted mt-1.5 text-xs leading-5 tabular-nums">
                            {formatRatePercent(topModel.rate)} across{" "}
                            {topModel.exposures.toLocaleString()}{" "}
                            {exposureBundle.exposureUnitLabel}
                            {topModel.medianChainSeconds !== null
                              ? ` · ${formatChainSecondsLabel(topModel.medianChainSeconds)} chain`
                              : ""}
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="mt-2 flex min-h-8 min-w-0 items-center">
                            <p className="truncate text-2xl leading-8 font-semibold tabular-nums">
                              —
                            </p>
                          </div>
                          <p className="app-muted mt-1.5 text-xs leading-5">
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
