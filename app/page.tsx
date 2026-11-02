import Link from "next/link";

import { HomeAttributionWorkspace } from "@/components/study-directory-table";
import { TopNavbar } from "@/components/top-navbar";
import {
  getFirstQueryParam,
  resolveHubWorkspaceTab,
} from "@/utils/attribution-ui-helpers";
import {
  getCachedFastStudyHubCatalog,
  getCachedGlobalAttributionDataset,
} from "@/utils/global-attribution-loader";

type HomePageProps = {
  searchParams?: Promise<{
    tab?: string | string[];
    q?: string | string[];
    flavor?: string | string[];
    model?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const resolvedParams = searchParams ? await searchParams : {};
  const initialQuery =
    getFirstQueryParam(resolvedParams.q)?.slice(0, 80) ?? "";
  const initialFlavorParam = getFirstQueryParam(resolvedParams.flavor);
  const initialModelParam = getFirstQueryParam(resolvedParams.model);
  const initialTab = resolveHubWorkspaceTab(
    getFirstQueryParam(resolvedParams.tab),
    initialFlavorParam,
    initialModelParam,
  );

  const isLeaderboardTab = initialTab === "flavors" || initialTab === "models";
  const dataset = isLeaderboardTab
    ? await getCachedGlobalAttributionDataset()
    : await getCachedFastStudyHubCatalog();
  const { featuredBenchmarkStudy, latestScoredStudy } = dataset;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNavbar />
      <main className="page-shell flex-1 p-3 text-foreground sm:p-6">
        <section className="app-panel mx-auto w-full max-w-7xl space-y-4 rounded-2xl p-4 sm:space-y-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="app-kicker text-xs font-semibold uppercase tracking-[0.24em]">
                The LOL Report
              </p>
              <h1 className="mt-0.5 text-xl font-semibold sm:mt-1 sm:text-3xl">
                Attribution Studio
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {featuredBenchmarkStudy ? (
                <Link
                  href={`/study/${featuredBenchmarkStudy.id}/attribution`}
                  className="app-button app-button-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition"
                >
                  Featured Benchmark (#{featuredBenchmarkStudy.id} ·{" "}
                  {featuredBenchmarkStudy.flavorCount} flavors) →
                </Link>
              ) : null}

              {latestScoredStudy &&
              latestScoredStudy.id !== featuredBenchmarkStudy?.id ? (
                <Link
                  href={`/study/${latestScoredStudy.id}/attribution`}
                  className="app-button inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition"
                >
                  Latest Scored Study (#{latestScoredStudy.id}) →
                </Link>
              ) : null}
            </div>
          </div>

          <HomeAttributionWorkspace
            key={`${initialTab}|${initialQuery}|${initialFlavorParam ?? ""}|${initialModelParam ?? ""}`}
            dataset={dataset}
            initialTab={initialTab}
            initialQuery={initialQuery}
            initialFlavorParam={initialFlavorParam}
            initialModelParam={initialModelParam}
          />
        </section>
      </main>
    </div>
  );
}
