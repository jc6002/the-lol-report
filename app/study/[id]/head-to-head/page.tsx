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
  getCachedStudyHeadToHeadPageData,
} from "@/utils/study-lineage-loader";

type StudyHeadToHeadPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    excludeHighRisk?: string | string[];
    flavor?: string | string[];
    rival?: string | string[];
    sort?: string | string[];
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
  const initialSortParam = getFirstQueryParam(query.sort) ?? null;
  const { bundle, trajectoriesByFlavorId } =
    await getCachedStudyHeadToHeadPageData(studyId, excludeHighRisk);
  if (!bundle) {
    notFound();
  }

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
      <main className="page-shell flex-1 p-3 text-foreground sm:p-6">
        <section className="app-panel mx-auto w-full max-w-7xl space-y-4 rounded-2xl p-4 sm:space-y-5 sm:p-6">
          <StudySubNav
            study={bundle.study}
            studies={bundle.studies}
            activeTab="head-to-head"
            exposureMode={bundle.exposureBundle.mode}
            isTransitionalLikert={bundle.exposureBundle.isTransitionalLikert}
            excludeHighRisk={bundle.excludeHighRisk}
            highRiskVoterCount={bundle.exposureBundle.highRiskVoterCount}
            actions={<StudyExportToolbar payload={exportPayload} />}
          />

          <SameImageShowdownFeed
            key={`${bundle.study.id}|${initialFlavorParam ?? ""}|${initialRivalParam ?? ""}|${initialSortParam ?? ""}`}
            studyId={bundle.study.id}
            excludeHighRisk={bundle.excludeHighRisk}
            exposureUnitLabel={bundle.exposureBundle.exposureUnitLabel}
            flavorRows={bundle.leaderboards.flavors}
            headToHead={serializedHeadToHead}
            trajectoriesByFlavorId={trajectoriesByFlavorId}
            initialFlavorParam={initialFlavorParam}
            initialRivalParam={initialRivalParam}
            initialSortParam={initialSortParam}
            totalExposures={bundle.exposureBundle.totalExposures}
            studyCaptions={serializedStudyCaptions}
          />
        </section>
      </main>
    </div>
  );
}
