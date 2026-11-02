import { notFound } from "next/navigation";

import { SameImageShowdownFeed } from "@/components/same-image-showdown-feed";
import { StudyExportToolbar } from "@/components/study-export-toolbar";
import { StudySubNav } from "@/components/study-sub-nav";
import { TopNavbar } from "@/components/top-navbar";
import { buildStudyExportPayload } from "@/utils/attribution-export";
import {
  getFirstQueryParam,
  isTruthyFlagParam,
  parsePositiveStudyId,
} from "@/utils/attribution-ui-helpers";
import {
  getCachedFlavorCrossStudyTrajectories,
  getCachedStudyAttributionBundle,
} from "@/utils/study-lineage-loader";

type StudyHeadToHeadPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    excludeHighRisk?: string | string[];
    flavor?: string | string[];
    rival?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

export default async function StudyHeadToHeadPage({
  params,
  searchParams,
}: StudyHeadToHeadPageProps) {
  const { id } = await params;
  const studyId = parsePositiveStudyId(id);
  if (studyId === null) {
    notFound();
  }

  const query = searchParams ? await searchParams : {};
  const excludeHighRisk = isTruthyFlagParam(query.excludeHighRisk);
  const initialFlavorParam = getFirstQueryParam(query.flavor) ?? null;
  const initialRivalParam = getFirstQueryParam(query.rival) ?? null;
  const bundle = await getCachedStudyAttributionBundle(
    studyId,
    excludeHighRisk,
  );
  if (!bundle) {
    notFound();
  }

  const attributedFlavorIds = bundle.leaderboards.flavors
    .map((row) => row.flavorId)
    .filter((flavorId): flavorId is number => flavorId !== null);

  const trajectoriesByFlavorId =
    attributedFlavorIds.length > 0
      ? await getCachedFlavorCrossStudyTrajectories(attributedFlavorIds)
      : {};

  const exportPayload = buildStudyExportPayload(bundle);
  const hasCrossFlavorShowdowns =
    bundle.headToHead.crossFlavorSharedImageCount > 0;
  const serializedHeadToHead = hasCrossFlavorShowdowns
    ? bundle.headToHead
    : { ...bundle.headToHead, groups: [] };
  const serializedStudyCaptions = hasCrossFlavorShowdowns
    ? undefined
    : bundle.captionMetrics;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNavbar />
      <main className="page-shell flex-1 p-4 text-foreground sm:p-6">
        <section className="app-panel mx-auto w-full max-w-7xl space-y-5 rounded-2xl p-5 sm:p-6">
          <StudySubNav
            study={bundle.study}
            studies={bundle.studies}
            activeTab="head-to-head"
            exposureMode={bundle.exposureBundle.mode}
            isTransitionalLikert={bundle.exposureBundle.isTransitionalLikert}
            excludeHighRisk={bundle.excludeHighRisk}
            highRiskVoterCount={bundle.exposureBundle.highRiskVoterCount}
            actions={
              <>
                <div className="hidden sm:block">
                  <StudyExportToolbar payload={exportPayload} />
                </div>
                <details className="sm:hidden open:w-full open:basis-full">
                  <summary className="app-button inline-flex h-9 list-none cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
                    <span>Export ▾</span>
                  </summary>
                  <div className="mt-2 rounded-xl border border-slate-200/90 bg-[#fffaf5] p-2.5 shadow-sm dark:border-cyan-200/18 dark:bg-[#0b1424]">
                    <StudyExportToolbar payload={exportPayload} />
                  </div>
                </details>
              </>
            }
          />

          <SameImageShowdownFeed
            key={`${bundle.study.id}|${initialFlavorParam ?? ""}|${initialRivalParam ?? ""}`}
            studyId={bundle.study.id}
            excludeHighRisk={bundle.excludeHighRisk}
            exposureUnitLabel={bundle.exposureBundle.exposureUnitLabel}
            flavorRows={bundle.leaderboards.flavors}
            headToHead={serializedHeadToHead}
            trajectoriesByFlavorId={trajectoriesByFlavorId}
            initialFlavorParam={initialFlavorParam}
            initialRivalParam={initialRivalParam}
            totalExposures={bundle.exposureBundle.totalExposures}
            studyCaptions={serializedStudyCaptions}
          />
        </section>
      </main>
    </div>
  );
}
