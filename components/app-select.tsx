"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  type AppSelectAlign,
  type AppSelectNavKey,
  type AppSelectOption,
  computeSelectMenuPosition,
  filterSelectOptions,
  findSelectedEnabledIndex,
  findTypeaheadOptionIndex,
  shouldShowSelectSearch,
  stepActiveOptionIndex,
} from "@/utils/app-select-helpers";

export type { AppSelectAlign, AppSelectOption };

export interface AppSelectProps<V extends string = string> {
  readonly options: ReadonlyArray<AppSelectOption<V>>;
  readonly value: V;
  readonly onValueChange: (value: V) => void;
  readonly id?: string;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly align?: AppSelectAlign;
  readonly menuMinWidthPx?: number;
  readonly menuMaxWidthPx?: number;
  readonly searchPlaceholder?: string;
}

const subscribe = () => () => undefined;

const SEARCH_HEADER_ALLOWANCE_PX = 44;
const MIN_LISTBOX_HEIGHT_PX = 72;

const NAV_KEYS: ReadonlySet<string> = new Set<AppSelectNavKey>([
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
]);

const isNavKey = (key: string): key is AppSelectNavKey => NAV_KEYS.has(key);

export function AppSelect<V extends string = string>({
  options,
  value,
  onValueChange,
  id,
  ariaLabel,
  ariaLabelledBy,
  disabled = false,
  className = "",
  align = "start",
  menuMinWidthPx,
  menuMaxWidthPx,
  searchPlaceholder = "Filter options...",
}: AppSelectProps<V>) {
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;
  const isHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const typeaheadBufferRef = useRef("");
  const typeaheadTimeoutRef = useRef<number | null>(null);

  const isSearchable = shouldShowSelectSearch(options.length);

  const filteredOptions = useMemo(
    () => (isSearchable ? filterSelectOptions(options, searchQuery) : [...options]),
    [isSearchable, options, searchQuery],
  );

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0] ?? null,
    [options, value],
  );

  const clearTypeahead = useCallback(() => {
    typeaheadBufferRef.current = "";
    if (typeaheadTimeoutRef.current !== null) {
      window.clearTimeout(typeaheadTimeoutRef.current);
      typeaheadTimeoutRef.current = null;
    }
  }, []);

  const focusMenuControl = useCallback(() => {
    const target = isSearchable ? searchInputRef.current : listboxRef.current;
    target?.focus({ preventScroll: true });
  }, [isSearchable]);

  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      clearTypeahead();
      setIsOpen(false);
      setSearchQuery("");
      if (restoreFocus) {
        requestAnimationFrame(() => {
          triggerRef.current?.focus({ preventScroll: true });
        });
      }
    },
    [clearTypeahead],
  );

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

    // Reset horizontal offset and apply current width bounds before reading
    // offsetWidth so prior right-edge clamping never constrains re-measurement.
    const boundsPass = computeSelectMenuPosition({
      triggerRect: rectSnapshot,
      viewportWidth,
      viewportHeight,
      align,
      minWidthPx: menuMinWidthPx,
      maxWidthPx: menuMaxWidthPx,
    });
    menuEl.style.left = "0px";
    menuEl.style.minWidth = `${boundsPass.minWidth}px`;
    menuEl.style.maxWidth = `${boundsPass.maxWidth}px`;

    const listboxEl = listboxRef.current;
    const intrinsicMenuWidthPx = menuEl.offsetWidth;
    // Derive full unclipped height from listbox scrollHeight so re-measuring on
    // resize/filter changes never clears maxHeight or resets listbox scrollTop.
    const intrinsicMenuHeightPx = listboxEl
      ? menuEl.offsetHeight - listboxEl.offsetHeight + listboxEl.scrollHeight
      : menuEl.scrollHeight;

    const pos = computeSelectMenuPosition({
      triggerRect: rectSnapshot,
      viewportWidth,
      viewportHeight,
      align,
      minWidthPx: menuMinWidthPx,
      maxWidthPx: menuMaxWidthPx,
      intrinsicMenuWidthPx,
      intrinsicMenuHeightPx,
    });

    menuEl.style.left = `${pos.left}px`;
    menuEl.style.top = pos.top !== null ? `${pos.top}px` : "";
    menuEl.style.bottom = pos.bottom !== null ? `${pos.bottom}px` : "";
    menuEl.style.maxHeight = `${pos.maxHeight}px`;

    if (listboxEl) {
      const allowance = isSearchable ? SEARCH_HEADER_ALLOWANCE_PX : 0;
      const listMaxHeight = Math.max(
        MIN_LISTBOX_HEIGHT_PX,
        pos.maxHeight - allowance,
      );
      listboxEl.style.maxHeight = `${listMaxHeight}px`;
    }

    return true;
  }, [align, isSearchable, menuMaxWidthPx, menuMinWidthPx]);

  const openMenu = useCallback(
    (initialMode: "selected" | "first" | "last") => {
      if (disabled || options.length === 0) {
        return;
      }
      setSearchQuery("");
      if (initialMode === "first") {
        setActiveIndex(stepActiveOptionIndex(options, -1, "Home"));
      } else if (initialMode === "last") {
        setActiveIndex(stepActiveOptionIndex(options, -1, "End"));
      } else {
        setActiveIndex(findSelectedEnabledIndex(options, value));
      }
      setIsOpen(true);
    },
    [disabled, options, value],
  );

  const commitOption = useCallback(
    (option: AppSelectOption<V> | undefined) => {
      if (!option || option.disabled) {
        return;
      }
      const nextValue = option.value;
      closeMenu(true);
      if (nextValue !== value) {
        onValueChange(nextValue);
      }
    },
    [closeMenu, onValueChange, value],
  );

  useLayoutEffect(() => {
    if (!isOpen || !isHydrated) {
      return;
    }
    syncMenuDomPosition();
  }, [isOpen, isHydrated, filteredOptions.length, syncMenuDomPosition]);

  useEffect(() => {
    if (!isOpen || !isHydrated) {
      return;
    }
    focusMenuControl();
  }, [isOpen, isHydrated, focusMenuControl]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) {
      return;
    }
    const listboxEl = listboxRef.current;
    if (!listboxEl) {
      return;
    }
    const activeOptionEl = listboxEl.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    );
    activeOptionEl?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeIndex, filteredOptions.length]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const isInsideSelect = (target: EventTarget | null): boolean => {
      if (!(target instanceof Node)) {
        return false;
      }
      return Boolean(
        triggerRef.current?.contains(target) || menuRef.current?.contains(target),
      );
    };

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!isInsideSelect(event.target)) {
        closeMenu(false);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isInsideSelect(event.target)) {
        closeMenu(false);
      }
    };

    const handleViewportChange = () => {
      if (!syncMenuDomPosition()) {
        closeMenu(false);
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

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    document.addEventListener("focusin", handleFocusIn);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleViewportChange, { passive: true });

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [isOpen, closeMenu, syncMenuDomPosition]);

  useEffect(() => () => clearTypeahead(), [clearTypeahead]);

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (disabled) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (isOpen) {
        setActiveIndex((prev) =>
          stepActiveOptionIndex(filteredOptions, prev, "ArrowDown"),
        );
      } else {
        openMenu("selected");
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (isOpen) {
        setActiveIndex((prev) =>
          stepActiveOptionIndex(filteredOptions, prev, "ArrowUp"),
        );
      } else {
        openMenu("last");
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen) {
        commitOption(filteredOptions[activeIndex]);
      } else {
        openMenu("selected");
      }
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closeMenu(true);
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const key = event.key;
    if (isNavKey(key)) {
      event.preventDefault();
      setActiveIndex((prev) =>
        stepActiveOptionIndex(filteredOptions, prev, key),
      );
      return;
    }

    if (key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0) {
        commitOption(filteredOptions[activeIndex]);
      }
      return;
    }

    if (key === " " && !isSearchable) {
      event.preventDefault();
      if (activeIndex >= 0) {
        commitOption(filteredOptions[activeIndex]);
      }
      return;
    }

    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }

    if (key === "Tab") {
      // Return activeElement to the in-flow trigger synchronously during keydown
      // without preventDefault so native Tab / Shift+Tab steps to the adjacent
      // toolbar control rather than jumping from document.body.lastElementChild.
      triggerRef.current?.focus({ preventScroll: true });
      closeMenu(false);
      return;
    }

    if (
      !isSearchable &&
      key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const nextBuffer = `${typeaheadBufferRef.current}${key}`;
      typeaheadBufferRef.current = nextBuffer;
      if (typeaheadTimeoutRef.current !== null) {
        window.clearTimeout(typeaheadTimeoutRef.current);
      }
      typeaheadTimeoutRef.current = window.setTimeout(() => {
        typeaheadBufferRef.current = "";
        typeaheadTimeoutRef.current = null;
      }, 500);

      const searchFrom = nextBuffer.length > 1 ? activeIndex - 1 : activeIndex;
      const matched = findTypeaheadOptionIndex(
        filteredOptions,
        searchFrom,
        nextBuffer,
      );
      if (matched >= 0) {
        setActiveIndex(matched);
      } else if (nextBuffer.length > 1) {
        typeaheadBufferRef.current = key;
        const singleMatch = findTypeaheadOptionIndex(
          filteredOptions,
          activeIndex,
          key,
        );
        if (singleMatch >= 0) {
          setActiveIndex(singleMatch);
        }
      }
    }
  };

  const handleMenuMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isSearchable && event.target === searchInputRef.current) {
      return;
    }

    const listboxEl = listboxRef.current;
    if (listboxEl && event.target === listboxEl) {
      const rect = listboxEl.getBoundingClientRect();
      const clickedNativeScrollbar =
        event.clientX >= rect.left + listboxEl.clientLeft + listboxEl.clientWidth ||
        event.clientY >= rect.top + listboxEl.clientTop + listboxEl.clientHeight;
      if (clickedNativeScrollbar) {
        return;
      }
    }

    event.preventDefault();
    focusMenuControl();
  };

  const safeActiveIndex =
    activeIndex >= 0 && activeIndex < filteredOptions.length ? activeIndex : -1;
  const activeOptionId =
    safeActiveIndex >= 0 ? `${listboxId}-opt-${safeActiveIndex}` : undefined;

  const portalMenu =
    isOpen && isHydrated
      ? createPortal(
          <div
            ref={menuRef}
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
            onMouseDown={handleMenuMouseDown}
            onMouseUp={() => {
              if (
                isSearchable &&
                document.activeElement !== searchInputRef.current
              ) {
                searchInputRef.current?.focus({ preventScroll: true });
              }
            }}
            className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-slate-200/95 bg-[#fffaf5] text-foreground shadow-2xl outline-none dark:border-cyan-200/20 dark:bg-[#0b1424]"
          >
            {isSearchable ? (
              <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/75 px-3 py-2 dark:border-slate-700/75">
                <Search
                  aria-hidden="true"
                  className="app-muted h-3.5 w-3.5 shrink-0"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded="true"
                  aria-controls={listboxId}
                  aria-activedescendant={activeOptionId}
                  aria-label={ariaLabel ? `${ariaLabel} filter` : searchPlaceholder}
                  value={searchQuery}
                  placeholder={searchPlaceholder}
                  onChange={(event) => {
                    const nextQuery = event.target.value;
                    const nextFiltered = filterSelectOptions(options, nextQuery);
                    setSearchQuery(nextQuery);
                    setActiveIndex(
                      findSelectedEnabledIndex(nextFiltered, value),
                    );
                  }}
                  className="h-6 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-[color:var(--muted)] sm:text-sm"
                />
              </div>
            ) : null}

            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              aria-labelledby={ariaLabel ? undefined : ariaLabelledBy}
              aria-activedescendant={isSearchable ? undefined : activeOptionId}
              className="overflow-y-auto p-1.5 outline-none"
            >
              {filteredOptions.length === 0 ? (
                <p
                  role="status"
                  className="app-muted px-2.5 py-3 text-center text-xs"
                >
                  No matching options.
                </p>
              ) : (
                filteredOptions.map((option, index) => {
                  const isSelected = option.value === value;
                  const isActive = index === safeActiveIndex;
                  const isOptionDisabled = Boolean(option.disabled);

                  return (
                    <div
                      key={option.value}
                      id={`${listboxId}-opt-${index}`}
                      data-option-index={index}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={isOptionDisabled || undefined}
                      onMouseEnter={() => {
                        if (!isOptionDisabled) {
                          setActiveIndex(index);
                        }
                      }}
                      onClick={() => {
                        commitOption(option);
                      }}
                      className={`flex min-h-8 items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition sm:text-sm ${
                        isOptionDisabled
                          ? "cursor-not-allowed opacity-45"
                          : "cursor-pointer"
                      } ${
                        isActive
                          ? "bg-sky-500/14 text-foreground dark:bg-cyan-300/16 dark:text-cyan-50"
                          : isSelected
                            ? "bg-slate-900/[0.04] text-foreground dark:bg-white/[0.05]"
                            : "text-foreground hover:bg-slate-900/5 dark:hover:bg-white/6"
                      }`}
                    >
                      <span
                        className={`min-w-0 flex-1 break-words line-clamp-2 leading-snug ${
                          isSelected ? "font-semibold" : "font-normal"
                        }`}
                      >
                        {option.label}
                      </span>
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {isSelected ? (
                          <Check
                            aria-hidden="true"
                            className="h-3.5 w-3.5 text-teal-700 dark:text-cyan-300"
                          />
                        ) : null}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        data-state={isOpen ? "open" : "closed"}
        onClick={() => {
          if (isOpen) {
            closeMenu(true);
          } else {
            openMenu("selected");
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        className={`app-input inline-flex h-9 cursor-pointer items-center justify-between gap-2.5 pl-3 pr-2.5 text-left font-normal text-foreground outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${className}`.trim()}
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedOption?.label ?? ""}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`app-muted h-4 w-4 shrink-0 transition-transform duration-150 ${
            isOpen ? "rotate-180 text-foreground" : ""
          }`}
        />
      </button>
      {portalMenu}
    </>
  );
}
