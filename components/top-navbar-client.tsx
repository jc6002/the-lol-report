"use client";

import type { User } from "@supabase/supabase-js";
import { BarChart3, ChevronDown, LogOut, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";

import { signOutAction } from "@/app/actions/auth";
import { AppSwitcher } from "@/components/app-switcher";
import { LoadingOverlay } from "@/components/loading-overlay";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  classifySearchHttpResponse,
  flattenSearchResponse,
  resolveSearchModalState,
  type RichStudySearchResponse,
} from "@/utils/attribution-ui-helpers";

type TopNavbarClientProps = {
  user: User | null;
  siteTitle: string;
  studyCount?: number | null;
  initialSearch?: RichStudySearchResponse | null;
};

const EMPTY_SEARCH_PLACEHOLDER: RichStudySearchResponse = {
  query: "",
  studies: [],
  flavors: [],
  models: [],
  reports: [],
};

const CLASSIC_GLOBAL_REPORTS: ReadonlyArray<{
  label: string;
  subtitle: string;
  href: string;
}> = [
  {
    label: "Compare Studies",
    subtitle: "Classic side-by-side summary",
    href: "/reports/study-comparison",
  },
  {
    label: "Weekly Trends",
    subtitle: "Classic multi-study window",
    href: "/reports/weekly-study-summary",
  },
];

let cachedDefaultSearchEntry: {
  userKey: string;
  response: RichStudySearchResponse;
} | null = null;

const subscribe = () => () => undefined;

export function TopNavbarClient({
  user,
  siteTitle,
  studyCount = null,
  initialSearch = null,
}: TopNavbarClientProps) {
  const router = useRouter();
  const isHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [isNavigating, startRouteTransition] = useTransition();

  const currentUserKey = user?.id ?? "anon";

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const [defaultSearchByUser, setDefaultSearchByUser] = useState<{
    userKey: string;
    response: RichStudySearchResponse;
  } | null>(() =>
    cachedDefaultSearchEntry?.userKey === currentUserKey
      ? cachedDefaultSearchEntry
      : null,
  );
  const [remoteResults, setRemoteResults] = useState<{
    query: string;
    response: RichStudySearchResponse;
  } | null>(null);
  const [searchError, setSearchError] = useState<
    "offline" | "unauthorized" | null
  >(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [appSwitcherEpoch, setAppSwitcherEpoch] = useState(0);

  const searchDialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const reportsContainerRef = useRef<HTMLDivElement>(null);
  const reportsTriggerRef = useRef<HTMLButtonElement>(null);
  const appSwitcherWrapRef = useRef<HTMLDivElement>(null);
  const restoreAppSwitcherFocusRef = useRef(false);

  const effectiveDefaultSearch =
    initialSearch ??
    (defaultSearchByUser?.userKey === currentUserKey
      ? defaultSearchByUser.response
      : null);

  const closeAppSwitcherIfOpen = useCallback((restoreFocus: boolean): boolean => {
    const wrap = appSwitcherWrapRef.current;
    if (!wrap) {
      return false;
    }
    const isMenuMounted = wrap.querySelector("a[href]") !== null;
    if (!isMenuMounted) {
      return false;
    }
    restoreAppSwitcherFocusRef.current = restoreFocus;
    setAppSwitcherEpoch((prev) => prev + 1);
    return true;
  }, []);

  useEffect(() => {
    if (!user) {
      cachedDefaultSearchEntry = null;
    }
  }, [user]);

  useLayoutEffect(() => {
    if (!restoreAppSwitcherFocusRef.current) {
      return;
    }
    restoreAppSwitcherFocusRef.current = false;
    appSwitcherWrapRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-label="App Switcher"]')
      ?.focus({ preventScroll: true });
  }, [appSwitcherEpoch]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setRemoteResults(null);
    setSearchError(null);
    setSelectedIndex(0);
    const returnTarget = previousFocusRef.current;
    previousFocusRef.current = null;
    requestAnimationFrame(() => {
      if (returnTarget && document.contains(returnTarget)) {
        returnTarget.focus();
        return;
      }
      searchTriggerRef.current?.focus();
    });
  }, []);

  const openSearch = useCallback(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setReportsOpen(false);
    closeAppSwitcherIfOpen(false);
    setSearchError(null);
    if (
      cachedDefaultSearchEntry &&
      cachedDefaultSearchEntry.userKey === currentUserKey &&
      defaultSearchByUser?.userKey !== currentUserKey
    ) {
      setDefaultSearchByUser(cachedDefaultSearchEntry);
    }
    setSearchOpen(true);
  }, [closeAppSwitcherIfOpen, currentUserKey, defaultSearchByUser?.userKey]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (searchOpen) {
          closeSearch();
        } else {
          openSearch();
        }
        return;
      }

      if (event.key === "Escape" && !searchOpen) {
        let handled = false;
        if (reportsOpen) {
          setReportsOpen(false);
          handled = true;
          reportsTriggerRef.current?.focus({ preventScroll: true });
        }
        if (closeAppSwitcherIfOpen(!handled)) {
          handled = true;
        }
        if (handled) {
          event.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    searchOpen,
    reportsOpen,
    closeSearch,
    openSearch,
    closeAppSwitcherIfOpen,
  ]);

  useEffect(() => {
    if (!reportsOpen) {
      return;
    }
    const isInsideReports = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      Boolean(reportsContainerRef.current?.contains(target));

    const handleOutside = (event: MouseEvent | TouchEvent | FocusEvent) => {
      if (!isInsideReports(event.target)) {
        setReportsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    document.addEventListener("focusin", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("focusin", handleOutside);
    };
  }, [reportsOpen]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    const trimmed = deferredQuery.trim();
    if (trimmed.length === 0 && effectiveDefaultSearch !== null) {
      return;
    }

    const controller = new AbortController();
    const requestUrl =
      trimmed.length === 0
        ? "/api/study-search?q="
        : `/api/study-search?q=${encodeURIComponent(trimmed)}`;

    fetch(requestUrl, {
      signal: controller.signal,
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
        if (classification === "unauthorized") {
          cachedDefaultSearchEntry = null;
          setDefaultSearchByUser(null);
          setRemoteResults(null);
          setSearchError("unauthorized");
          return;
        }
        if (classification === "offline") {
          setRemoteResults(null);
          setSearchError("offline");
          return;
        }
        const payload = (await response.json()) as RichStudySearchResponse;
        if (trimmed.length === 0) {
          const entry = { userKey: currentUserKey, response: payload };
          cachedDefaultSearchEntry = entry;
          setDefaultSearchByUser(entry);
        } else {
          setRemoteResults({ query: trimmed, response: payload });
        }
        setSearchError(null);
        setSelectedIndex(0);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setRemoteResults(null);
        setSearchError("offline");
      });

    return () => {
      controller.abort();
    };
  }, [deferredQuery, searchOpen, effectiveDefaultSearch, currentUserKey]);

  const modalState = useMemo(
    () =>
      resolveSearchModalState({
        searchQuery,
        remoteResults,
        searchError,
        initialSearch: effectiveDefaultSearch ?? EMPTY_SEARCH_PLACEHOLDER,
      }),
    [searchQuery, remoteResults, searchError, effectiveDefaultSearch],
  );

  const isLoadingDefaultSearch =
    modalState.isEmptyQuery &&
    effectiveDefaultSearch === null &&
    searchError === null;
  const isModalPending = modalState.isPendingQuery || isLoadingDefaultSearch;
  const allowEnterSelection =
    modalState.allowEnterSelection && !isLoadingDefaultSearch;

  const groupedSections = useMemo(
    () =>
      !isLoadingDefaultSearch && modalState.activePayload
        ? flattenSearchResponse(
            modalState.activePayload,
            modalState.isEmptyQuery,
          )
        : [],
    [isLoadingDefaultSearch, modalState.activePayload, modalState.isEmptyQuery],
  );

  const showZeroMatchState =
    !modalState.isEmptyQuery &&
    !isModalPending &&
    searchError === null &&
    groupedSections.length === 0;

  const navigableItems = useMemo(
    () =>
      groupedSections.flatMap((group) =>
        group.items.filter((item) => item.href !== null),
      ),
    [groupedSections],
  );

  const safeSelectedIndex =
    navigableItems.length === 0
      ? -1
      : Math.min(selectedIndex, navigableItems.length - 1);
  const selectedKey =
    allowEnterSelection && safeSelectedIndex >= 0
      ? navigableItems[safeSelectedIndex]?.key ?? null
      : null;

  const navigateWithTransition = useCallback(
    (href: string) => {
      if (typeof window !== "undefined") {
        const currentFull = `${window.location.pathname}${window.location.search}`;
        if (currentFull === href) {
          return;
        }
      }
      startRouteTransition(() => {
        router.push(href);
      });
    },
    [router],
  );

  const handleSelectHref = (href: string | null) => {
    if (!href) {
      return;
    }
    previousFocusRef.current = null;
    setSearchOpen(false);
    setSearchQuery("");
    setRemoteResults(null);
    setSearchError(null);
    setSelectedIndex(0);
    navigateWithTransition(href);
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key === "Tab" && searchDialogRef.current) {
      const focusable = Array.from(
        searchDialogRef.current.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !searchDialogRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !searchDialogRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!allowEnterSelection || navigableItems.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) =>
        prev < navigableItems.length - 1 ? prev + 1 : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : navigableItems.length - 1,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = navigableItems[safeSelectedIndex];
      if (target?.href) {
        handleSelectHref(target.href);
      }
    }
  };

  const modalContent =
    searchOpen && isHydrated
      ? createPortal(
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 px-4 pt-[12vh] backdrop-blur-sm">
            <div
              className="fixed inset-0"
              aria-hidden="true"
              onClick={closeSearch}
            />
            <div
              ref={searchDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Search studies, prompt flavors, and models"
              onKeyDown={handleDialogKeyDown}
              className="relative z-50 flex max-h-[68vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-[#fffaf5]/98 text-foreground shadow-2xl backdrop-blur-xl dark:border-cyan-200/18 dark:bg-[#0b1424]/98"
            >
              <div className="flex items-center gap-2 border-b border-slate-200/70 px-3.5 dark:border-slate-700/70">
                <Search
                  className="app-muted h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    const nextVal = event.target.value;
                    setSearchQuery(nextVal);
                    setSelectedIndex(0);
                    if (nextVal.trim().length === 0) {
                      setRemoteResults(null);
                      setSearchError(null);
                    }
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search studies, prompt flavors, or models..."
                  aria-label="Search studies, prompt flavors, or models"
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-[color:var(--muted)]"
                  autoFocus
                />
                {isModalPending ? (
                  <span className="app-muted inline-flex shrink-0 items-center gap-1.5 text-xs">
                    <span
                      aria-hidden="true"
                      className="app-loading-spinner !h-3.5 !w-3.5 !border-[1.5px]"
                    />
                    {isLoadingDefaultSearch ? "Loading..." : "Searching..."}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={closeSearch}
                  className="app-button inline-flex h-7 shrink-0 items-center rounded-md px-2 font-mono text-xs"
                >
                  Esc
                </button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {searchError === "unauthorized" ? (
                  <div className="rounded-xl bg-amber-500/18 p-3 text-xs text-amber-900 ring-1 ring-amber-500/35 dark:text-amber-100">
                    Your session expired.{" "}
                    <Link
                      href="/login"
                      onClick={() => handleSelectHref("/login")}
                      className="font-semibold underline"
                    >
                      Sign in
                    </Link>{" "}
                    again to search.
                  </div>
                ) : searchError === "offline" ? (
                  <div className="rounded-xl bg-rose-500/15 p-3 text-xs text-rose-800 ring-1 ring-rose-500/30 dark:text-rose-100">
                    Unable to reach search right now. Check your connection and
                    try again.
                  </div>
                ) : isModalPending ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="app-muted flex items-center justify-center gap-2 py-8 text-xs"
                  >
                    <span
                      aria-hidden="true"
                      className="app-loading-spinner !h-4 !w-4"
                    />
                    <span>
                      {isLoadingDefaultSearch ? (
                        "Loading studies, prompt flavors, and models..."
                      ) : (
                        <>
                          Matching &ldquo;{modalState.trimmedQuery}&rdquo; across{" "}
                          {studyCount && studyCount > 0
                            ? `${studyCount} studies, flavors, and models...`
                            : "studies, flavors, and models..."}
                        </>
                      )}
                    </span>
                  </div>
                ) : showZeroMatchState ? (
                  <div className="app-muted py-8 text-center text-xs">
                    No studies, prompt flavors, or models match &ldquo;
                    {modalState.trimmedQuery}
                    &rdquo;.
                  </div>
                ) : (
                  groupedSections.map((group) => {
                    const isUntestedGroup =
                      group.section === "flavors_untested" ||
                      group.section === "models_untested";
                    return (
                      <div
                        key={group.section}
                        className={
                          isUntestedGroup
                            ? "space-y-1 border-t border-slate-200/70 pt-2.5 dark:border-slate-700/70"
                            : "space-y-1"
                        }
                      >
                        <p className="app-muted px-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {group.heading}
                        </p>
                        <div className="space-y-1">
                          {group.items.map((item) => {
                            const isSelected = item.key === selectedKey;
                            const isActionable = item.href !== null;

                            if (!isActionable) {
                              return (
                                <div
                                  key={item.key}
                                  className="flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-xs opacity-60"
                                >
                                  <span className="min-w-0 truncate">
                                    <span
                                      className={
                                        item.section === "flavors_untested"
                                          ? "font-mono text-xs font-medium text-foreground"
                                          : "font-medium text-foreground"
                                      }
                                    >
                                      {item.primaryLabel}
                                    </span>
                                    {item.secondaryLabel ? (
                                      <span className="app-muted ml-2 text-xs">
                                        {item.secondaryLabel}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="app-muted shrink-0 text-xs">
                                    {item.rightMeta}
                                  </span>
                                </div>
                              );
                            }

                            return (
                              <button
                                key={item.key}
                                type="button"
                                onClick={() => handleSelectHref(item.href)}
                                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition ${
                                  isSelected
                                    ? "bg-sky-500/16 text-foreground ring-1 ring-sky-500/35 dark:bg-cyan-300/18 dark:text-cyan-50 dark:ring-cyan-300/35"
                                    : "text-foreground hover:bg-slate-900/5 dark:hover:bg-white/6"
                                }`}
                              >
                                <span className="min-w-0 truncate">
                                  {item.codeBadge ? (
                                    <span className="app-muted mr-2 font-mono text-xs">
                                      {item.codeBadge}
                                    </span>
                                  ) : null}
                                  <span
                                    className={
                                      item.section === "flavors"
                                        ? "font-mono text-xs font-medium"
                                        : "font-medium"
                                    }
                                  >
                                    {item.primaryLabel}
                                  </span>
                                  {item.secondaryLabel ? (
                                    <span
                                      className={
                                        item.section === "studies"
                                          ? "ml-2 inline-flex rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800 dark:text-cyan-200"
                                          : `app-muted ml-2 text-xs ${
                                              item.section === "models"
                                                ? "font-mono"
                                                : ""
                                            }`
                                      }
                                    >
                                      {item.secondaryLabel}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="app-muted shrink-0 text-xs tabular-nums">
                                  {item.rightMeta}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2.5 backdrop-blur-md select-none sm:px-6">
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-2 sm:gap-3">
          <Link
            href="/"
            aria-label={siteTitle}
            className="inline-flex shrink-0 items-center gap-2.5 rounded-lg py-0.5 transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:gap-3"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#c2410c] text-sm font-bold text-white shadow">
              LR
            </span>
            <span className="hidden text-xs font-semibold uppercase tracking-[0.24em] text-foreground sm:inline sm:text-sm">
              {siteTitle}
            </span>
          </Link>

          <button
            ref={searchTriggerRef}
            type="button"
            onClick={openSearch}
            className="app-input mx-2 hidden h-9 w-full max-w-md items-center justify-between rounded-lg px-3 text-xs transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:flex"
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search
                className="app-muted h-4 w-4 shrink-0"
                aria-hidden="true"
              />
              <span className="app-muted truncate">
                {studyCount && studyCount > 0
                  ? `Search ${studyCount} studies, flavors, models...`
                  : "Search studies, flavors, models..."}
              </span>
            </span>
            <kbd className="app-muted rounded border border-slate-300/70 px-1.5 py-0.5 font-mono text-[11px] dark:border-slate-700">
              ⌘K
            </kbd>
          </button>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={openSearch}
              aria-label="Search studies, prompt flavors, and models"
              className="app-button grid h-9 w-9 place-items-center rounded-lg transition md:hidden"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>

            <ThemeToggle />

            <span
              aria-hidden="true"
              className="hidden h-6 w-px bg-slate-200/70 sm:block dark:bg-slate-700/70"
            />

            <div className="relative" ref={reportsContainerRef}>
              <button
                ref={reportsTriggerRef}
                type="button"
                onClick={() => {
                  closeAppSwitcherIfOpen(false);
                  setReportsOpen((prev) => !prev);
                }}
                aria-label="Classic Reports"
                aria-haspopup="menu"
                aria-expanded={reportsOpen}
                className="app-button inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Classic Reports</span>
                <ChevronDown
                  aria-hidden="true"
                  className={`app-muted h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
                    reportsOpen ? "rotate-180 text-foreground" : ""
                  }`}
                />
              </button>

              {reportsOpen ? (
                <div
                  role="menu"
                  aria-label="Classic Reports"
                  className="absolute right-0 top-full z-50 mt-2 w-60 origin-top-right overflow-hidden rounded-xl border border-slate-200/95 bg-[#fffaf5] p-1.5 shadow-2xl dark:border-cyan-200/18 dark:bg-[#0b1424]"
                >
                  {CLASSIC_GLOBAL_REPORTS.map((report) => (
                    <Link
                      key={report.href}
                      href={report.href}
                      role="menuitem"
                      onClick={(event) => {
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey ||
                          event.button !== 0
                        ) {
                          setReportsOpen(false);
                          return;
                        }
                        event.preventDefault();
                        setReportsOpen(false);
                        navigateWithTransition(report.href);
                      }}
                      className="block rounded-lg px-3 py-2 text-xs transition hover:bg-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] dark:hover:bg-white/6"
                    >
                      <span className="block font-semibold text-foreground">
                        {report.label}
                      </span>
                      <span className="app-muted mt-0.5 block text-[11px]">
                        {report.subtitle}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            <div
              ref={appSwitcherWrapRef}
              onPointerDownCapture={() => setReportsOpen(false)}
              onClickCapture={() => setReportsOpen(false)}
            >
              <AppSwitcher key={appSwitcherEpoch} />
            </div>

            {user ? (
              <>
                <span
                  aria-hidden="true"
                  className="hidden h-6 w-px bg-slate-200/70 sm:block dark:bg-slate-700/70"
                />
                {user.email ? (
                  <span
                    title={user.email}
                    className="app-muted hidden max-w-44 truncate text-xs xl:inline"
                  >
                    {user.email}
                  </span>
                ) : null}
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="app-button inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-lg px-0 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:w-auto sm:px-3"
                    title={user.email ? `Sign out (${user.email})` : "Sign out"}
                    aria-label="Sign out"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {modalContent}
      {isNavigating ? <LoadingOverlay label="Opening view..." /> : null}
    </>
  );
}
