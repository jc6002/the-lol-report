"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";

import { AppSelect, type AppSelectOption } from "@/components/app-select";
import { LoadingOverlay } from "@/components/loading-overlay";
import { LocalStudyWindow } from "@/components/local-study-window";
import {
  buildStudySwitchHref,
  computeSelectMenuPosition,
} from "@/utils/app-select-helpers";
import {
  buildClassicStudyReportOptions,
  buildStudioTabHref,
  classifySearchHttpResponse,
  formatStudyHeaderLabel,
  formatStudySwitcherOption,
  type StudySubNavTab,
  type StudySwitcherSummaryLike,
} from "@/utils/attribution-ui-helpers";
import type { StudyExposureMode } from "@/utils/study-exposure-adapter";

export type { StudySubNavTab };

export type StudySubNavSummary = {
  id: number;
  slug: string | null;
  description: string | null;
  start_datetime_utc: string | null;
  end_datetime_utc: string | null;
  created_datetime_utc: string;
  title?: string;
  formatDisplayLabel?: "Swipe" | "Rating scale";
  flavorCount?: number;
  modelCount?: number;
  voterCount?: number;
  exposureCount?: number;
  positiveRate?: number | null;
  flavorSlugs?: readonly string[];
  modelNames?: readonly string[];
};

export type StudySubNavProps = {
  study: StudySubNavSummary;
  studies: StudySubNavSummary[];
  activeTab: StudySubNavTab;
  exposureMode: StudyExposureMode;
  isTransitionalLikert?: boolean;
  excludeHighRisk: boolean;
  highRiskVoterCount: number;
  actions?: ReactNode;
};

type CatalogFetchPayload = {
  studies?: StudySwitcherSummaryLike[];
};

let clientCatalogCache: Map<number, StudySwitcherSummaryLike> | null = null;
let clientCatalogInFlight: Promise<Map<
  number,
  StudySwitcherSummaryLike
> | null> | null = null;

function fetchClientSwitcherCatalog(): Promise<Map<
  number,
  StudySwitcherSummaryLike
> | null> {
  if (clientCatalogCache) {
    return Promise.resolve(clientCatalogCache);
  }
  if (clientCatalogInFlight) {
    return clientCatalogInFlight;
  }

  clientCatalogInFlight = fetch("/api/study-search?catalog=1", {
    cache: "no-store",
  })
    .then(async (response) => {
      const classification = classifySearchHttpResponse({
        status: response.status,
        ok: response.ok,
        redirected: response.redirected,
        type: response.type,
        url: response.url,
        contentType: response.headers.get("content-type"),
      });
      if (classification !== "ok") {
        return null;
      }
      const payload = (await response.json()) as CatalogFetchPayload;
      if (!Array.isArray(payload.studies)) {
        return null;
      }
      const nextMap = new Map<number, StudySwitcherSummaryLike>();
      for (const item of payload.studies) {
        nextMap.set(item.id, item);
      }
      clientCatalogCache = nextMap;
      return nextMap;
    })
    .catch(() => null)
    .finally(() => {
      clientCatalogInFlight = null;
    });

  return clientCatalogInFlight;
}

const subscribe = () => () => undefined;

function ClassicReportsMenu({
  options,
  disabled,
  onSelectReport,
}: {
  options: readonly AppSelectOption<string>[];
  disabled: boolean;
  onSelectReport: (href: string) => void;
}) {
  const menuId = `${useId()}-classic-reports`;
  const isHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const syncMenuDomPosition = useCallback((): boolean => {
    const triggerEl = triggerRef.current;
    const menuEl = menuRef.current;
    if (!triggerEl || !menuEl) {
      return true;
    }

    const triggerRect = triggerEl.getBoundingClientRect();
    const isOffscreen =
      triggerRect.bottom < 0 ||
      triggerRect.top > window.innerHeight ||
      triggerRect.right < 0 ||
      triggerRect.left > window.innerWidth;
    if (isOffscreen) {
      return false;
    }

    const rectSnapshot = {
      top: triggerRect.top,
      bottom: triggerRect.bottom,
      left: triggerRect.left,
      right: triggerRect.right,
      width: triggerRect.width,
      height: triggerRect.height,
    };
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const exactTriggerWidthPx = Math.max(176, Math.round(rectSnapshot.width));

    const boundsPass = computeSelectMenuPosition({
      triggerRect: rectSnapshot,
      viewportWidth,
      viewportHeight,
      align: "start",
      minWidthPx: exactTriggerWidthPx,
      maxWidthPx: exactTriggerWidthPx,
    });
    menuEl.style.left = "0px";
    menuEl.style.minWidth = `${boundsPass.minWidth}px`;
    menuEl.style.maxWidth = `${boundsPass.maxWidth}px`;

    const intrinsicMenuWidthPx = menuEl.offsetWidth;
    const intrinsicMenuHeightPx = menuEl.scrollHeight;

    const pos = computeSelectMenuPosition({
      triggerRect: rectSnapshot,
      viewportWidth,
      viewportHeight,
      align: "start",
      minWidthPx: exactTriggerWidthPx,
      maxWidthPx: exactTriggerWidthPx,
      intrinsicMenuWidthPx,
      intrinsicMenuHeightPx,
    });

    menuEl.style.left = `${pos.left}px`;
    menuEl.style.top = pos.top !== null ? `${pos.top}px` : "";
    menuEl.style.bottom = pos.bottom !== null ? `${pos.bottom}px` : "";
    menuEl.style.maxHeight = `${pos.maxHeight}px`;
    return true;
  }, []);

  const focusMenuItemAt = useCallback((targetIndex: number) => {
    const items =
      menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]');
    if (!items || items.length === 0) {
      return;
    }
    const clamped =
      ((targetIndex % items.length) + items.length) % items.length;
    items[clamped]?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !isHydrated) {
      return;
    }
    syncMenuDomPosition();
  }, [isOpen, isHydrated, options.length, syncMenuDomPosition]);

  useEffect(() => {
    if (!isOpen || !isHydrated) {
      return;
    }
    focusMenuItemAt(0);
  }, [isOpen, isHydrated, focusMenuItemAt]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const isInside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      Boolean(
        triggerRef.current?.contains(target) || menuRef.current?.contains(target),
      );

    const handleOutside = (event: MouseEvent | TouchEvent | FocusEvent) => {
      if (!isInside(event.target)) {
        setIsOpen(false);
      }
    };

    const handleViewportChange = () => {
      if (!syncMenuDomPosition()) {
        setIsOpen(false);
      }
    };

    const handleScroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      handleViewportChange();
    };

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    document.addEventListener("focusin", handleOutside);
    document.addEventListener("keydown", handleDocumentKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleViewportChange, { passive: true });

    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("focusin", handleOutside);
      document.removeEventListener("keydown", handleDocumentKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [isOpen, syncMenuDomPosition]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ??
        [],
    );
    const currentIdx = items.indexOf(
      document.activeElement as HTMLAnchorElement,
    );

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Tab") {
      triggerRef.current?.focus({ preventScroll: true });
      setIsOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItemAt(currentIdx < 0 ? 0 : currentIdx + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItemAt(currentIdx <= 0 ? items.length - 1 : currentIdx - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusMenuItemAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusMenuItemAt(items.length - 1);
    }
  };

  const portalMenu =
    isOpen && isHydrated
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="Legacy Views"
            onKeyDown={handleMenuKeyDown}
            className="fixed z-[70] flex flex-col overflow-y-auto rounded-xl border border-slate-200/95 bg-[#fffaf5] p-1.5 text-foreground shadow-2xl outline-none dark:border-cyan-200/20 dark:bg-[#0b1424]"
          >
            {options.map((option) => (
              <Link
                key={option.value}
                href={option.value}
                role="menuitem"
                onClick={(event) => {
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey ||
                    event.button !== 0
                  ) {
                    setIsOpen(false);
                    return;
                  }
                  event.preventDefault();
                  setIsOpen(false);
                  onSelectReport(option.value);
                }}
                className="flex min-h-8 items-center whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground outline-none transition hover:bg-slate-900/5 focus:bg-sky-500/14 dark:hover:bg-white/6 dark:focus:bg-cyan-300/16 dark:focus:text-cyan-50"
              >
                {option.label}
              </Link>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label="Open legacy study views"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        data-state={isOpen ? "open" : "closed"}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (disabled) {
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setIsOpen(true);
          } else if (event.key === "Escape" && isOpen) {
            event.preventDefault();
            setIsOpen(false);
          }
        }}
        className="app-button inline-flex h-9 w-auto cursor-pointer items-center justify-between gap-1.5 rounded-lg px-2.5 text-left text-xs font-medium text-foreground outline-none transition disabled:cursor-not-allowed disabled:opacity-60 sm:px-3"
      >
        <span className="truncate">Legacy Views</span>
        <ChevronDown
          aria-hidden="true"
          className={`app-muted h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
            isOpen ? "rotate-180 text-foreground" : ""
          }`}
        />
      </button>
      {portalMenu}
    </>
  );
}

const STUDIO_TABS: ReadonlyArray<{ id: StudySubNavTab; label: string }> = [
  { id: "attribution", label: "Attribution" },
  { id: "demographics", label: "Demographics" },
  { id: "head-to-head", label: "Head-to-Head" },
];

export function StudySubNav({
  study,
  studies,
  activeTab,
  exposureMode,
  excludeHighRisk,
  highRiskVoterCount,
  actions,
}: StudySubNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isFilterPending, startFilterTransition] = useTransition();
  const [isSwitchingStudy, startStudySwitchTransition] = useTransition();
  const [isTabPending, startTabTransition] = useTransition();
  const [optimisticTab, setOptimisticTab] = useState<StudySubNavTab | null>(
    null,
  );
  const [hydratedCatalog, setHydratedCatalog] = useState<Map<
    number,
    StudySwitcherSummaryLike
  > | null>(() => clientCatalogCache);

  const hasServerEnrichment = useMemo(
    () => studies.some((candidate) => candidate.exposureCount !== undefined),
    [studies],
  );

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const ensureSwitcherCatalogHydrated = useCallback(() => {
    if (hasServerEnrichment || hydratedCatalog !== null) {
      return;
    }
    if (clientCatalogCache) {
      setHydratedCatalog(clientCatalogCache);
      return;
    }
    void fetchClientSwitcherCatalog().then((map) => {
      if (isMountedRef.current && map) {
        setHydratedCatalog(map);
      }
    });
  }, [hasServerEnrichment, hydratedCatalog]);

  const studyOptions = useMemo<AppSelectOption[]>(
    () =>
      studies.map((candidate) => {
        const hydrated = hydratedCatalog?.get(candidate.id);
        return formatStudySwitcherOption({
          id: candidate.id,
          slug: candidate.slug,
          description: candidate.description,
          title: candidate.title ?? hydrated?.title,
          formatDisplayLabel:
            candidate.formatDisplayLabel ?? hydrated?.formatDisplayLabel,
          flavorCount: candidate.flavorCount ?? hydrated?.flavorCount,
          modelCount: candidate.modelCount ?? hydrated?.modelCount,
          voterCount: candidate.voterCount ?? hydrated?.voterCount,
          exposureCount: candidate.exposureCount ?? hydrated?.exposureCount,
          positiveRate: candidate.positiveRate ?? hydrated?.positiveRate,
          flavorSlugs: candidate.flavorSlugs ?? hydrated?.flavorSlugs,
          modelNames: candidate.modelNames ?? hydrated?.modelNames,
        });
      }),
    [studies, hydratedCatalog],
  );

  const classicReportOptions = useMemo(
    () =>
      buildClassicStudyReportOptions({
        studyId: study.id,
        exposureMode,
      }),
    [study.id, exposureMode],
  );

  const handleSwitchStudy = (nextStudyId: string) => {
    const nextHref = buildStudySwitchHref({
      currentStudyId: study.id,
      targetStudyId: nextStudyId,
      activeTab,
      currentSearch: searchParams.toString(),
    });
    if (nextHref === null) {
      return;
    }
    startStudySwitchTransition(() => {
      router.push(nextHref);
    });
  };

  const handleSelectClassicReport = (reportHref: string) => {
    if (!reportHref) {
      return;
    }
    startStudySwitchTransition(() => {
      router.push(reportHref);
    });
  };

  const toggleExcludeHighRisk = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (excludeHighRisk) {
      nextParams.delete("excludeHighRisk");
    } else {
      nextParams.set("excludeHighRisk", "1");
    }
    const query = nextParams.toString();
    const nextHref = query ? `${pathname}?${query}` : pathname;
    startFilterTransition(() => {
      router.replace(nextHref, { scroll: false });
    });
  };

  const displayedTab =
    isTabPending && optimisticTab !== null ? optimisticTab : activeTab;

  const countSuffix =
    highRiskVoterCount > 0 ? `(${highRiskVoterCount})` : "(0 flagged)";

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <Link
            href="/"
            className="app-kicker inline-flex items-center gap-1 py-1 text-xs font-semibold hover:underline"
          >
            ← Study Hub
          </Link>

          <h1 className="mt-0.5 min-w-0 break-words text-xl font-semibold tracking-tight sm:text-2xl">
            {formatStudyHeaderLabel(study)}
          </h1>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
            {exposureMode === "swipe_navigation" ? (
              <span className="inline-flex items-center rounded-md bg-sky-500/14 px-2 py-0.5 text-xs font-medium text-slate-900 dark:text-sky-100">
                Swipe cards · % liked per seen card
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-amber-500/16 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-100">
                Rating scale · % rated funny / very funny
              </span>
            )}
            <span className="app-muted inline-flex items-center tabular-nums">
              <LocalStudyWindow
                start={study.start_datetime_utc ?? study.created_datetime_utc}
                end={study.end_datetime_utc}
              />
            </span>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 lg:w-auto">
          <div
            className="w-full sm:w-auto"
            onPointerEnter={ensureSwitcherCatalogHydrated}
            onFocus={ensureSwitcherCatalogHydrated}
            onClick={ensureSwitcherCatalogHydrated}
          >
            <AppSelect
              ariaLabel="Switch study"
              options={studyOptions}
              value={String(study.id)}
              onValueChange={handleSwitchStudy}
              disabled={isSwitchingStudy || studyOptions.length === 0}
              menuMinWidthPx={310}
              menuMaxWidthPx={440}
              searchPlaceholder="Search studies by #, title, or flavor..."
              className="w-full rounded-lg text-xs sm:w-72 sm:text-sm"
            />
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={excludeHighRisk}
            disabled={isFilterPending}
            onClick={toggleExcludeHighRisk}
            className={
              excludeHighRisk
                ? "inline-flex h-9 items-center gap-2 rounded-lg bg-amber-500/18 px-3 text-xs font-semibold text-amber-950 ring-1 ring-amber-500/40 transition disabled:opacity-65 dark:text-amber-100"
                : "app-button inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium transition disabled:opacity-65"
            }
          >
            {isFilterPending ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="app-loading-spinner !h-3 !w-3 !border-[1.5px]"
                />
                Updating...
              </span>
            ) : (
              <span>Exclude rushed raters {countSuffix}</span>
            )}
            <span
              aria-hidden="true"
              className={`inline-flex h-4 w-7 items-center rounded-full p-0.5 transition ${
                excludeHighRisk
                  ? "bg-amber-600 dark:bg-amber-400"
                  : "bg-slate-300/90 dark:bg-slate-700"
              }`}
            >
              <span
                className={`h-3 w-3 rounded-full bg-white shadow transition-transform dark:bg-slate-950 ${
                  excludeHighRisk ? "translate-x-3" : "translate-x-0"
                }`}
              />
            </span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav
          aria-label="Attribution Studio views"
          className="app-input inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-xl p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {STUDIO_TABS.map((tab) => {
            const isSelected = tab.id === displayedTab;
            const isLoadingThisTab =
              isTabPending && optimisticTab === tab.id && tab.id !== activeTab;
            const activeFlavorParam = searchParams.get("flavor");
            const href = buildStudioTabHref(
              study.id,
              tab.id,
              excludeHighRisk,
              activeFlavorParam,
            );

            return (
              <Link
                key={tab.id}
                href={href}
                aria-current={tab.id === activeTab ? "page" : undefined}
                onClick={(event) => {
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey ||
                    event.button !== 0 ||
                    tab.id === activeTab
                  ) {
                    return;
                  }
                  event.preventDefault();
                  const liveFlavor =
                    typeof window !== "undefined"
                      ? new URLSearchParams(window.location.search).get("flavor")
                      : activeFlavorParam;
                  const targetHref = buildStudioTabHref(
                    study.id,
                    tab.id,
                    excludeHighRisk,
                    liveFlavor,
                  );
                  setOptimisticTab(tab.id);
                  startTabTransition(() => {
                    router.push(targetHref);
                  });
                }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs transition sm:px-3.5 ${
                  isSelected
                    ? "bg-white font-semibold text-slate-950 shadow-sm dark:bg-cyan-300/20 dark:text-cyan-50"
                    : "app-muted font-medium hover:text-foreground"
                }`}
              >
                <span>{tab.label}</span>
                {isLoadingThisTab ? (
                  <span
                    aria-hidden="true"
                    className="app-loading-spinner !h-3 !w-3 !border-[1.5px]"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {actions}
          <ClassicReportsMenu
            options={classicReportOptions}
            disabled={isSwitchingStudy}
            onSelectReport={handleSelectClassicReport}
          />
        </div>
      </div>

      {isSwitchingStudy ? <LoadingOverlay /> : null}
    </div>
  );
}
